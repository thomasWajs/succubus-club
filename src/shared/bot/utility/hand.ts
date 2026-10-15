import { LibraryCard } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { CardOid } from '@/shared/types/model.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { BotOption, DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'
import { Assessment, assessSnapshot } from '@/shared/bot/utility/assessment.ts'
import { exact, resolveAttack } from '@/shared/bot/utility/attack.ts'
import { attackersOf, defenceOf, toAttackers } from '@/shared/bot/utility/defence.ts'
import { ExplainCandidate } from '@/shared/bot/utility/explain.ts'
import { masterWorths } from '@/shared/bot/utility/masterPhase.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import { isRoleLive, readyMinions } from '@/shared/bot/utility/snapshot.ts'
import {
    CardSummary,
    EffectType,
    PlaySummary,
    Role,
    summarizeCard,
    summarizeCardId,
    waysUsableBy,
} from '@/shared/bot/utility/summaries.ts'

/**
 * The hand, judged as a whole. A card is worth what it will be used for, given the other cards of the hand: each
 * kind of use ( stealth, a bleed bonus, a bounce, a block, a fight, an action, a master phase ) has a rate of
 * uses per turn that the table allows, and the cards that serve it count in order of worth: the first ones up to
 * the rate are worth their use, the ones beyond are spare ( a hand jammed with stealth against a prey that never
 * blocks ). What a draw is worth is read the same way on the cards of the deck that are not seen yet. The weakest
 * card is cycled when a draw is worth more than it, and the one that goes when the hand is too big is the weakest.
 */

export type NeedKind =
    | 'stealth'
    | 'bleedBonus'
    | 'bounce'
    // A block of my predator's bleed that is not a bounce: a wake card, an intercept card, an unlock card
    | 'defence'
    | 'combat'
    // An action of a minion that is not a bleed
    | 'action'
    | 'master'
    | 'other'
    // A card the bot knows nothing of: always counted
    | 'unknown'

const NEED_OF_ROLE: Partial<Record<Role, NeedKind>> = {
    stealth: 'stealth',
    bleedBonus: 'bleedBonus',
    bounce: 'bounce',
    wake: 'defence',
    intercept: 'defence',
    unlock: 'defence',
    strike: 'combat',
    dodge: 'combat',
    maneuver: 'combat',
    additionalStrike: 'combat',
    grapple: 'combat',
    strength: 'combat',
    prevention: 'combat',
    soak: 'combat',
    damageOverTime: 'combat',
    combatStarter: 'combat',
    bleed: 'action',
    poolSteal: 'action',
    accelerate: 'action',
    sustain: 'action',
    poolGain: 'action',
    attachment: 'action',
    punishBlock: 'other',
    cycling: 'other',
}

// What the table lets a kind of use do: how many times a turn, and what each use is worth, in pool
type Need = { rate: number; worth: number }

// A use of a card: the kind, and what it is worth if it is the first of its kind
type Use = { need: NeedKind; worth: number }

// How much of what a Methuselah would do is known: one minion is not much, a crew is
function evidenceOf(minions: number, assessment: Assessment): number {
    return Math.min(1, minions / Math.max(1, assessment.profile.influence.crew))
}

// What the table asks of a hand: the needs, and how many bleeds of my predator and fights of my minions to
// expect in a turn
type Table = { needs: Record<NeedKind, Need>; bleeds: number; fights: number }

function needsOf(assessment: Assessment): Table {
    const { table, profile, stakes, densities } = assessment
    const { hand, plan } = profile
    const { me, prey, predator } = table
    // What the others can do to me with none of my cards: the cards I hold are not what makes them worth holding
    const threat =
        me.hand.length > 0 ?
            assessSnapshot({ ...table, me: { ...me, hand: [] } }, profile).threat
        :   assessment.threat
    const bleeders = attackersOf(me, 'nextTurn')
    // A minion acts once a turn: one is always on its way
    const actors = Math.max(1, readyMinions(me).length)

    // My bleeds on my prey on my next turn, with no card of my own: the blocks the minions it keeps home would
    // attempt, and the stealth points that stop each one ( one more than its intercept ). Stealth is worth the
    // bleed that a block would stop
    const weight = prey ? (stakes[prey.oid]?.weight ?? 0) : 0
    const bleed =
        bleeders.length > 0 ?
            bleeders.reduce((sum, minion) => sum + minion.bleed, 0) / bleeders.length
        :   1
    const home = prey ? (assessment.held[prey.oid] ?? []) : []
    const defence =
        prey ?
            defenceOf(
                table,
                prey,
                'bleed',
                densities[prey.oid],
                prey.minions.filter(minion => home.includes(minion.oid)),
            )
        :   null
    const base =
        prey && defence ?
            resolveAttack(toAttackers(bleeders), defence, {
                stealth: exact(0),
                bonus: exact(0),
                standingStealth: 0,
            })
        :   null
    const known = prey ? evidenceOf(readyMinions(prey).length, assessment) : 0
    const blocked = known * (base?.blockedShare ?? 0) + (1 - known) * hand.priorBlock
    const intercept =
        defence && defence.reactors.length > 0 ?
            defence.reactors.reduce((sum, value) => sum + value, 0) / defence.reactors.length
        :   0
    const pointsPerBlock = known * (intercept + 1) + (1 - known)

    // The bleeds of my predator on me, and what each one costs me
    const hostile = predator ? readyMinions(predator).length : 0
    const seen = evidenceOf(hostile, assessment)
    const lost =
        predator ? (threat[predator.oid].bleed + threat[predator.oid].bounced) * plan.caution : 0
    const perBleed =
        predator ? seen * (lost / Math.max(1, hostile)) + (1 - seen) * hand.priorBleed : 0
    const bleeds = predator ? seen * hostile + (1 - seen) * profile.influence.crew : 0

    // The fights of my neighbours' minions with mine: what each could cost me
    let fighting = 0
    let fightLoss = 0
    for (const neighbour of new Set([prey, predator])) {
        if (!neighbour) {
            continue
        }
        const sure = evidenceOf(readyMinions(neighbour).length, assessment)
        const loss =
            sure * (threat[neighbour.oid]?.combat ?? 0) * plan.caution +
            (1 - sure) * hand.priorFight
        if (loss > 0.05) {
            fighting++
            fightLoss += loss
        }
    }
    const fights = fighting * hand.fightsPerTurn

    const needs: Record<NeedKind, Need> = {
        stealth: {
            rate: actors * blocked * pointsPerBlock,
            worth: (weight * bleed) / pointsPerBlock,
        },
        bleedBonus: { rate: actors, worth: profile.opponentPrior.bonusPerCard * weight },
        bounce: {
            rate: bleeds,
            worth: isRoleLive(table, 'bounce') ? perBleed : 0,
        },
        defence: { rate: bleeds, worth: perBleed * hand.cover },
        combat: {
            rate: fights * hand.cardsPerFight,
            worth:
                fights > 0 ?
                    (fightLoss * hand.fightsPerTurn * hand.cover) / (fights * hand.cardsPerFight)
                :   0,
        },
        action: { rate: actors, worth: plan.cardAction },
        master: { rate: 1, worth: hand.master },
        other: { rate: 1, worth: hand.other },
        unknown: { rate: Infinity, worth: hand.unknown },
    }
    return { needs, bleeds, fights }
}

// How much of a play a card of the hand can make with the vampires I have: all, what a vampire of the
// uncontrolled region could make, or nothing
function playableShare(assessment: Assessment, play: PlaySummary): number {
    const { me } = assessment.table
    const usable = (minion: MinionProfile) => waysUsableBy(play.ways, minion.disciplines).length > 0
    if (readyMinions(me).some(usable)) {
        return 1
    }
    return me.uncontrolled.some(usable) ? assessment.profile.hand.future : 0
}

// The effects of a master play that the master phase prices ( masterPhase.ts ): a card that has one is worth
// holding until it pays
const PRICED_PLAY: EffectType[] = ['gainBlood', 'bloodToPool', 'handSize']
const PRICED_ABILITY: EffectType[] = ['gainBlood', 'stealth', 'intercept', 'discardFromHand']

function standsForSomething(play: PlaySummary): boolean {
    return (
        play.effects.some(effect => PRICED_PLAY.includes(effect.type)) ||
        play.attached.length > 0 ||
        play.abilities.some(ability =>
            ability.effects.some(effect => PRICED_ABILITY.includes(effect.type)),
        )
    )
}

function usesOf(
    summary: CardSummary | undefined,
    assessment: Assessment,
    needs: Record<NeedKind, Need>,
    master?: number,
): Use[] {
    const { hand } = assessment.profile
    if (!summary || !summary.catalogued || summary.plays.length == 0) {
        return [{ need: 'unknown', worth: hand.unknown }]
    }
    const uses: Use[] = []
    for (const play of summary.plays) {
        if (play.kind == 'master') {
            const floor = standsForSomething(play) ? hand.hold * hand.master : 0
            uses.push({ need: 'master', worth: Math.max(master ?? hand.master, floor) })
            continue
        }
        const share = playableShare(assessment, play)
        const kinds = new Set(play.roles.flatMap(role => NEED_OF_ROLE[role] ?? []))
        for (const need of kinds.size > 0 ? kinds : new Set<NeedKind>(['other'])) {
            uses.push({ need, worth: needs[need].worth * share })
        }
    }
    return uses
}

type Entry = { oid: CardOid; uses: Use[] }

// What a use is worth as the `rank`-th of its kind: whole while the rate leaves room for it, less as it fills
function marginalOf(need: Need, horizon: number, rank: number, worth: number): number {
    return worth * Math.min(1, Math.max(0, need.rate * horizon - rank))
}

// The best use of each card of kind `need`, from the most worth to the least
function rankedOf(entries: Entry[], need: NeedKind): { oid: CardOid; worth: number }[] {
    return entries
        .flatMap(entry => {
            const worth = Math.max(
                -1,
                ...entry.uses.filter(use => use.need == need).map(use => use.worth),
            )
            return worth >= 0 ? [{ oid: entry.oid, worth }] : []
        })
        .toSorted((a, b) => b.worth - a.worth)
}

type Library = { uses: Use[]; count: number }

export class HandEvaluator {
    readonly needs: Record<NeedKind, Need>
    // The bleeds of my predator, and the fights of my minions, to expect in a turn
    readonly bleeds: number
    readonly fights: number
    private readonly entries: Entry[]
    private library: Library[] | undefined
    // What keeping each card of the hand is worth, given the others
    readonly keeps: Map<CardOid, number>

    constructor(
        private readonly assessment: Assessment,
        private readonly deck: DeckList,
        private readonly player: Player,
    ) {
        const table = needsOf(assessment)
        this.needs = table.needs
        this.bleeds = table.bleeds
        this.fights = table.fights
        const worths =
            (
                player.hand.cards.some(card =>
                    summarizeCard(card)?.plays.some(play => play.kind == 'master'),
                )
            ) ?
                masterWorths(assessment, player)
            :   new Map<CardOid, number>()
        this.entries = player.hand.cards.flatMap(card =>
            card instanceof LibraryCard ?
                [
                    {
                        oid: card.oid,
                        uses: usesOf(
                            summarizeCard(card),
                            assessment,
                            this.needs,
                            worths.get(card.oid) ?? 0,
                        ),
                    },
                ]
            :   [],
        )
        this.keeps = this.keepsOf(this.entries)
    }

    private keepsOf(entries: Entry[]): Map<CardOid, number> {
        const { horizon } = this.assessment.profile.hand
        const keeps = new Map<CardOid, number>(entries.map(entry => [entry.oid, 0]))
        for (const kind of Object.keys(this.needs) as NeedKind[]) {
            rankedOf(entries, kind).forEach(({ oid, worth }, rank) => {
                const value = marginalOf(this.needs[kind], horizon, rank, worth)
                keeps.set(oid, Math.max(keeps.get(oid) ?? 0, value))
            })
        }
        return keeps
    }

    // The cards of the deck that are not seen yet, with what each does
    private libraryOf(): Library[] {
        if (this.library) {
            return this.library
        }
        const { player, assessment } = this
        const left = new Map<string, number>(Object.entries(this.deck))
        const seen = [...player.hand.cards, ...player.ashHeap.cards, ...player.controlledReadyCards]
        for (const card of seen) {
            if (card instanceof LibraryCard && card.krcgId && left.has(card.krcgId)) {
                left.set(card.krcgId, (left.get(card.krcgId) ?? 0) - 1)
            }
        }
        this.library = [...left].flatMap(([id, count]) => {
            const summary = summarizeCardId(id)
            if (count <= 0 || summary?.isCrypt) {
                return []
            }
            const master = summary?.plays.some(
                play => play.kind == 'master' && standsForSomething(play),
            )
            return [
                {
                    uses: usesOf(summary, assessment, this.needs, master ? undefined : 0),
                    count,
                },
            ]
        })
        return this.library
    }

    // What the card drawn in the place of one that goes is worth to the hand that is left: the mean over the
    // cards of the deck not seen yet, each counted for what it would add
    draw(without: CardOid): number {
        const library = this.libraryOf()
        const total = library.reduce((sum, card) => sum + card.count, 0)
        if (total == 0) {
            return 0
        }
        const rest = this.entries.filter(entry => entry.oid != without)
        const { horizon } = this.assessment.profile.hand
        const ranked = new Map<NeedKind, number[]>(
            (Object.keys(this.needs) as NeedKind[]).map(kind => [
                kind,
                rankedOf(rest, kind).map(({ worth }) => worth),
            ]),
        )
        let sum = 0
        for (const card of library) {
            let value = 0
            for (const use of card.uses) {
                const above = (ranked.get(use.need) ?? []).filter(
                    worth => worth >= use.worth,
                ).length
                value = Math.max(value, marginalOf(this.needs[use.need], horizon, above, use.worth))
            }
            sum += card.count * value
        }
        return sum / total
    }

    // What the card drawn in the place of one that goes is worth to a window that asks for `kinds` right now ( a
    // bleed against me, a fight ): a card that serves it counts for its whole worth when no card of the hand
    // serves it already, otherwise the draw is the plain one
    drawFor(without: CardOid, kinds: NeedKind[]): number {
        const plain = this.draw(without)
        const served = (entry: Entry) =>
            entry.uses.some(use => kinds.includes(use.need) && use.worth > 0)
        if (this.entries.some(entry => entry.oid != without && served(entry))) {
            return plain
        }
        const library = this.libraryOf()
        const total = library.reduce((sum, card) => sum + card.count, 0)
        let serving = 0
        let stake = 0
        for (const card of library) {
            const worth = Math.max(
                0,
                ...card.uses.filter(use => kinds.includes(use.need)).map(use => use.worth),
            )
            if (worth > 0) {
                serving += card.count
                stake += card.count * worth
            }
        }
        if (total == 0 || serving == 0) {
            return plain
        }
        const share = serving / total
        return Math.max(plain, share * (stake / serving) + (1 - share) * plain)
    }

    // The card of the hand that is worth least to keep, among the cards that can go
    weakest(cards: LibraryCard[]): { card: LibraryCard; keep: number } | null {
        let weakest: { card: LibraryCard; keep: number } | null = null
        for (const card of cards) {
            const keep = this.keeps.get(card.oid) ?? 0
            if (!weakest || keep < weakest.keep) {
                weakest = { card, keep }
            }
        }
        return weakest
    }

    // What playing a card of the hand gives the flow of the hand: the draw that takes its place against what it
    // was worth to keep. Nothing for a card that is worth more than a draw
    flowOf(card: LibraryCard): number {
        return Math.max(0, this.draw(card.oid) - (this.keeps.get(card.oid) ?? 0))
    }
}

export type HandJudgement = {
    option: BotOption
    candidates: ExplainCandidate[]
    note: string
}

// The cards that can go, weakest first, each with the option that sends it away
function candidatesOf(
    evaluator: HandEvaluator,
    routes: { card: LibraryCard; option: BotOption }[],
): ExplainCandidate[] {
    return routes
        .map(({ card, option }) => ({
            option,
            score: -(evaluator.keeps.get(card.oid) ?? 0),
            parts: { keep: evaluator.keeps.get(card.oid) ?? 0 },
        }))
        .toSorted((a, b) => b.score - a.score)
}

// Does the card in play let its controller throw a card of the hand away
export function discards(card: LibraryCard): boolean {
    return (summarizeCard(card)?.plays ?? []).some(play =>
        play.abilities.some(ability =>
            ability.effects.some(effect => effect.type == 'discardFromHand'),
        ),
    )
}

/**
 * The discard phase: the weakest card of the hand goes by the free discard of the turn, when a draw is worth more
 * than it. Otherwise the turn ends. A card in play that lets a card go is judged apart ( cycle.ts ).
 */
export function judgeDiscard(
    decision: DecisionPoint,
    assessment: Assessment,
    deck: DeckList,
): HandJudgement {
    const endTurn = findOption(decision.options, 'endTurn')
    const routes = optionsOfType(decision.options, 'discard').map(option => ({
        card: option.card,
        option,
    }))
    const cards = [...new Set(routes.map(route => route.card))]
    const evaluator = new HandEvaluator(assessment, deck, decision.player)
    const weakest = evaluator.weakest(cards)
    const candidates = candidatesOf(
        evaluator,
        cards.flatMap(card => routes.find(route => route.card == card) ?? []),
    )
    if (!weakest) {
        return { option: endTurn, candidates, note: 'nothing to discard' }
    }
    const draw = evaluator.draw(weakest.card.oid)
    const margin = assessment.profile.hand.margin
    if (weakest.keep + margin >= draw) {
        return {
            option: endTurn,
            candidates,
            note: `${weakest.card.name} is worth ${weakest.keep.toFixed(2)}, a draw ${draw.toFixed(2)}`,
        }
    }
    return {
        option: routes.find(route => route.card == weakest.card)?.option ?? endTurn,
        candidates,
        note: `${weakest.card.name} is worth ${weakest.keep.toFixed(2)}, a draw ${draw.toFixed(2)}`,
    }
}

/**
 * The hand is over its size: the card that is worth least to keep goes.
 */
export function judgeDiscardExcess(
    decision: DecisionPoint,
    assessment: Assessment,
    deck: DeckList,
): HandJudgement {
    const options = optionsOfType(decision.options, 'discardExcess')
    const evaluator = new HandEvaluator(assessment, deck, decision.player)
    const weakest = evaluator.weakest(options.map(option => option.card))
    const option = options.find(candidate => candidate.card == weakest?.card) ?? options[0]
    return {
        option,
        candidates: candidatesOf(
            evaluator,
            options.map(candidate => ({ card: candidate.card, option: candidate })),
        ),
        note: `${option.card.name} is worth ${(weakest?.keep ?? 0).toFixed(2)} to keep`,
    }
}
