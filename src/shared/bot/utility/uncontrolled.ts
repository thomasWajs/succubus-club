import { Card } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { BotOptionOf, DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'
import { Assessment } from '@/shared/bot/utility/assessment.ts'
import { ExplainCandidate } from '@/shared/bot/utility/explain.ts'
import { InfluenceJudgement, plansOf, setupOf, Setup } from '@/shared/bot/utility/influence.ts'
import { MinionProfile, profileCryptId } from '@/shared/bot/utility/minionProfile.ts'
import { AbilitySummary, EffectType, summarizeCard } from '@/shared/bot/utility/summaries.ts'

/**
 * The uncontrolled region as a stock of vampires to bring out: what a draw from the crypt followed by a removal is
 * worth, when the card that does it is used, and which vampire it removes once the card drawn is seen. A region is
 * worth what the best influence plan over its vampires is worth ( influence.ts ), with the transfers that are left.
 * A card that burns for pool is used when the transfers it needs would be wasted otherwise.
 */

// A vampire of the crypt I have not seen, and how many of them are there
type Draw = { vampire: MinionProfile; weight: number }

// The crypt of the deck, less the vampires I have seen leave it: the crypt is hidden, but a Methuselah knows its deck
function unseenCrypt(player: Player, deck: DeckList): Draw[] {
    const seen = new Map<string, number>()
    for (const card of Object.values(player.gameState.cards)) {
        if (card.ownerOid == player.oid && card.isCrypt && card.krcgId) {
            seen.set(card.krcgId, (seen.get(card.krcgId) ?? 0) + 1)
        }
    }
    return Object.entries(deck).flatMap(([id, count]) => {
        const weight = count - (seen.get(id) ?? 0)
        const vampire = weight > 0 ? profileCryptId(id, `crypt:${id}`, player.oid) : null
        return vampire ? [{ vampire, weight }] : []
    })
}

function regionValue(setup: Setup, vampires: MinionProfile[], transfers: number): number {
    const schedule = [transfers, ...setup.schedule.slice(1)]
    const best = plansOf({ ...setup, schedule }, vampires)[0]
    return best ? Math.max(0, best.value) : 0
}

type Removal = { removed: MinionProfile; value: number; alone: number }

// What is left of the region when each vampire goes. Of those that leave the most, the one that is worth the least
// alone is removed, then the smallest
function removalsOf(setup: Setup, vampires: MinionProfile[], transfers: number): Removal[] {
    const scored = vampires.map(removed => ({
        removed,
        value: regionValue(
            setup,
            vampires.filter(vampire => vampire != removed),
            transfers,
        ),
        alone: 0,
    }))
    const top = Math.max(...scored.map(({ value }) => value))
    for (const removal of scored) {
        if (removal.value >= top - 1e-9) {
            removal.alone = regionValue(setup, [removal.removed], transfers)
        }
    }
    return scored.toSorted(
        (a, b) => b.value - a.value || a.alone - b.alone || a.removed.capacity - b.removed.capacity,
    )
}

function abilityOf(option: BotOptionOf<'transferEffect'>): AbilitySummary | undefined {
    return summarizeCard(option.card)?.plays.find(play => play.abilities.length > 0)?.abilities[
        option.ability
    ]
}

const hasEffect = (ability: AbilitySummary | undefined, type: EffectType) =>
    !!ability?.effects.some(effect => effect.type == type)

// What the region is worth after a draw that costs `cost` transfers and a removal, with the vampire drawn as I expect
// it from what is left of the crypt: null when I know nothing of it
function drawGain(
    setup: Setup,
    player: Player,
    deck: DeckList,
    uncontrolled: MinionProfile[],
    transfers: number,
    cost: number,
): number | null {
    const unseen = unseenCrypt(player, deck)
    const total = unseen.reduce((sum, { weight }) => sum + weight, 0)
    if (total == 0) {
        return null
    }
    return unseen.reduce(
        (sum, { vampire, weight }) =>
            sum +
            (weight / total) *
                removalsOf(setup, [...uncontrolled, vampire], transfers - cost)[0].value,
        0,
    )
}

/**
 * What one use of a draw that costs `cost` transfers adds to my uncontrolled region now, in pool: 0 when it adds
 * nothing. For the master phase, which prices the card that does it.
 */
export function drawWorth(
    assessment: Assessment,
    deck: DeckList,
    player: Player,
    cost: number,
): number {
    const { uncontrolled } = assessment.table.me
    const setup = setupOf(assessment, deck)
    const { transfers } = assessment.table.turn
    const gain = drawGain(setup, player, deck, uncontrolled, transfers, cost)
    return gain === null ? 0 : Math.max(0, gain - regionValue(setup, uncontrolled, transfers))
}

// The ability of a card that draws from the crypt, when it has one
export function drawAbilityOf(card: Card): AbilitySummary | undefined {
    return summarizeCard(card)
        ?.plays.flatMap(play => play.abilities)
        .find(ability => hasEffect(ability, 'drawCrypt'))
}

/**
 * The uncontrolled vampire to remove from the game, once the card drawn is in the region: the one whose loss costs
 * the plan the least
 */
export function judgeRemoval(
    decision: DecisionPoint,
    assessment: Assessment,
    deck: DeckList,
): InfluenceJudgement | null {
    const options = optionsOfType(decision.options, 'removeUncontrolled')
    const { uncontrolled } = assessment.table.me
    if (options.length == 0 || uncontrolled.length == 0) {
        return null
    }
    const setup = setupOf(assessment, deck)
    const removals = removalsOf(setup, uncontrolled, assessment.table.turn.transfers)
    const candidates = removals.flatMap((removal): ExplainCandidate[] => {
        const option = options.find(candidate => candidate.removed.oid == removal.removed.oid)
        return option ?
                [
                    {
                        option,
                        score: removal.value,
                        parts: { alone: removal.alone, capacity: removal.removed.capacity },
                    },
                ]
            :   []
    })
    const best = candidates[0]
    return best ?
            {
                option: best.option,
                candidates,
                note: `the region keeps ${best.score.toFixed(1)} without ${best.option.type == 'removeUncontrolled' ? best.option.removed.name : ''}`,
            }
        :   null
}

/**
 * The abilities paid with transfers, in the influence phase. A draw is used when the region it leaves, with the best
 * vampire of the crypt as I expect it, is worth more than the region now by the margin ( the transfer it costs is in
 * the comparison ). The burn for pool is used when the transfers it needs are not used by the plan of the phase.
 */
export function judgeTransfers(
    decision: DecisionPoint,
    assessment: Assessment,
    deck: DeckList,
): InfluenceJudgement | null {
    const options = optionsOfType(decision.options, 'transferEffect')
    if (options.length == 0) {
        return null
    }
    const { margin } = assessment.profile.influence
    const { uncontrolled } = assessment.table.me
    const { transfers } = assessment.table.turn
    const setup = setupOf(assessment, deck)
    const plans = plansOf(setup, uncontrolled)
    const best = plans[0]
    const current = best ? Math.max(0, best.value) : 0
    const candidates: ExplainCandidate[] = []

    for (const option of options) {
        const ability = abilityOf(option)
        if (hasEffect(ability, 'drawCrypt')) {
            const gain = drawGain(
                setup,
                decision.player,
                deck,
                uncontrolled,
                transfers,
                ability?.transfers ?? 0,
            )
            if (gain === null) {
                continue
            }
            candidates.push({ option, score: gain - current, parts: { gain, current } })
        } else if (hasEffect(ability, 'burnSelf')) {
            const planned = best && best.value >= margin ? best.spendNow : 0
            const spare = transfers - planned
            const pool = ability?.effects.reduce(
                (sum, effect) => sum + (effect.type == 'gainPool' ? effect.amount : 0),
                0,
            )
            if (pool && spare >= (ability?.transfers ?? 0)) {
                candidates.push({ option, score: pool, parts: { pool, spare } })
            }
        }
    }

    // The draw comes first: the burn is for when nothing is worth drawing
    const draw = candidates.find(
        ({ option, score }) =>
            option.type == 'transferEffect' &&
            hasEffect(abilityOf(option), 'drawCrypt') &&
            score >= margin,
    )
    const burn = candidates.find(
        ({ option }) => option.type == 'transferEffect' && hasEffect(abilityOf(option), 'burnSelf'),
    )
    const chosen = draw ?? burn
    if (!chosen) {
        return null
    }
    return {
        option: chosen.option,
        candidates,
        note:
            chosen == draw ?
                `a draw is worth ${chosen.score.toFixed(1)} over the ${current.toFixed(1)} of the region`
            :   `${chosen.parts.spare} transfers are not used by the plan: burn for ${chosen.parts.pool} pool`,
    }
}
