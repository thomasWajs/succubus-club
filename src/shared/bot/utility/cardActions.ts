import { Card } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { usageOptionKey } from '@/shared/cardImpl/catalog/requirements.ts'
import { resolveCost } from '@/shared/state/cardCosts.ts'
import { getDefaultStealth } from '@/shared/state/minionActions.ts'
import { getReactingPlayers } from '@/shared/state/actionState.ts'
import { CardOid, ObjectId } from '@/shared/types/model.ts'
import { MinionAction, MinionActionType } from '@/shared/types/state.ts'
import { Assessment, outcomeOfTurn } from '@/shared/bot/utility/assessment.ts'
import { resolveAttack } from '@/shared/bot/utility/attack.ts'
import { bloodChange } from '@/shared/bot/utility/bloat.ts'
import { combatStartGain, combatStartOf } from '@/shared/bot/utility/enterCombat.ts'
import { fightRisk } from '@/shared/bot/utility/combatPosition.ts'
import { attackKitOf, defenceOf, interceptShare } from '@/shared/bot/utility/defence.ts'
import { costOfLunge } from '@/shared/bot/utility/equity.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import { MethuselahSnapshot, readyMinions, unlockedMinions } from '@/shared/bot/utility/snapshot.ts'
import { Effect, PlaySummary, summarizeCard } from '@/shared/bot/utility/summaries.ts'
import { Candidate } from '@/shared/bot/utility/turnPlan.ts'

/**
 * What the action card of the hand is worth when its minion plays it, in pool: what it does if the action
 * goes through ( blood put on a vampire to influence, pool stolen, an equipment or a retainer that serves for
 * a few turns ), less what it costs, less what a block does to it: the card is lost and the minions fight.
 */

// The play of a card of the hand, as the minion declared it
export type CardPlay = {
    card: CardOid
    // The same card with the same target and level reads the same: the copies of a card are one choice
    key: string
    summary: PlaySummary
    // The bleed points the card puts on the bleed of its minion, 0 when it is not a bleed
    bleed: number
    // The Methuselah or the card it is aimed at
    target: ObjectId | undefined
    poolCost: number
    bloodCost: number
}

export function cardPlayOf(action: MinionAction): CardPlay | null {
    if (action.type != MinionActionType.ActionCardFromHand) {
        return null
    }
    const { card, usage } = action
    const declared = usageOptionKey(usage.disciplines ?? [])
    const summary = summarizeCard(card)?.plays.find(
        play => play.kind == 'action' && play.ways.some(way => usageOptionKey(way) == declared),
    )
    if (!summary) {
        return null
    }
    const bleedAction = summary.effects.find(effect => effect.type == 'bleedAction')
    return {
        card: card.oid,
        key: `${card.krcgId}:${declared}:${usage.target?.oid ?? ''}`,
        summary,
        bleed: bleedAction?.type == 'bleedAction' ? bleedAction.amount : 0,
        target: usage.target?.oid,
        poolCost: resolveCost(card.poolCost, usage.x),
        bloodCost: resolveCost(card.bloodCost, usage.x),
    }
}

export type PlayValue = {
    // What the action is worth for my minion's turn, the block counted
    value: number
    // The same if no one blocks it: what a stealth card that beats the block saves
    unblocked: number
}

type BlockRisk = { share: number; fight: number }

export class PlayValues {
    private readonly values = new Map<Candidate, PlayValue>()
    private readonly fights = new Map<string, number>()
    private lungeAsIs: number | undefined

    constructor(private readonly assessment: Assessment) {}

    // The card, the pool and the blood the play spends
    costOf(candidate: Candidate): number {
        const { profile, table, bloat } = this.assessment
        const play = candidate.play
        const actor = table.me.minions.find(minion => minion.oid == candidate.actor)
        if (!play || !actor) {
            return 0
        }
        return (
            profile.plan.spentCard +
            play.poolCost * profile.plan.caution -
            bloodChange(profile, actor, -play.bloodCost, bloat[table.me.oid])
        )
    }

    valueOf(candidate: Candidate): PlayValue {
        const known = this.values.get(candidate)
        if (known) {
            return known
        }
        const value = this.read(candidate)
        this.values.set(candidate, value)
        return value
    }

    private read(candidate: Candidate): PlayValue {
        const { table, profile } = this.assessment
        const actor = table.me.minions.find(minion => minion.oid == candidate.actor)
        if (!actor) {
            return { value: 0, unblocked: 0 }
        }
        const cost = this.costOf(candidate)
        const start = combatStartOf(candidate)
        if (start) {
            const gain = combatStartGain(this.assessment, candidate, start)
            const value = gain >= profile.combat.enterMargin ? gain - cost : 0
            return { value, unblocked: value }
        }
        const play = candidate.play
        if (!play) {
            const value = profile.plan.cardAction - cost
            return { value, unblocked: value }
        }
        if (play.bleed > 0) {
            // Not weighed against the blocks nor the cost: opponents block less than the model expects
            const value = play.bleed * profile.cards.perBleedPoint
            return { value, unblocked: value }
        }
        const worth = this.worthOf(candidate, play, actor)
        const risk = this.blockRisk(candidate, actor)
        return {
            value: worth * (1 - risk.share) - cost - risk.fight,
            unblocked: worth - cost,
        }
    }

    // What the play does when the action goes through
    private worthOf(candidate: Candidate, play: CardPlay, actor: MinionProfile): number {
        const { action } = candidate.option
        if (action.type != MinionActionType.ActionCardFromHand) {
            return 0
        }
        const { table, profile, stakes, bloat } = this.assessment
        const { target } = action.usage
        let worth = 0
        let described = false
        for (const effect of play.summary.effects) {
            switch (effect.type) {
                case 'gainBlood': {
                    described = true
                    if (play.summary.target == 'youngerUncontrolledVampire') {
                        worth += this.uncontrolledBloodWorth(target, effect.amount)
                    } else {
                        worth += bloodChange(profile, actor, effect.amount, bloat[table.me.oid])
                    }
                    break
                }
                case 'stealPool': {
                    described = true
                    const weight = target instanceof Player ? (stakes[target.oid]?.weight ?? 0) : 0
                    worth += effect.amount * (profile.plan.caution + weight)
                    break
                }
                default:
                    break
            }
        }
        const attached = this.attachedWorth(
            play.summary.attached,
            bearerOf(table.me, target, actor),
        )
        if (attached !== null) {
            described = true
            worth += attached
            worth -= this.lockedOut(play.summary.attached) * profile.plan.spentCard
        }
        return described ? worth : profile.plan.cardAction
    }

    // Blood put on a vampire that is not in play yet: it cuts the transfers that bringing it out will take, up to
    // what it can hold, and the more so for the vampire I am the most likely to bring out ( the biggest )
    private uncontrolledBloodWorth(target: Card | Player | undefined, amount: number): number {
        if (!(target instanceof Card) || !target.isMinion()) {
            return 0
        }
        const biggest = Math.max(
            ...target.controller.vampiresInUncontrolled.map(
                vampire => vampire.minionAttrs.capacity,
            ),
        )
        const room = Math.max(0, target.minionAttrs.capacity - target.blood)
        const { cards } = this.assessment.profile
        const crowd = Math.max(
            cards.crowdFloor,
            1 - cards.crowd * (readyMinions(this.assessment.table.me).length - 1),
        )
        return (
            Math.min(amount, room) *
            cards.bloodOnUncontrolled *
            crowd *
            (target.minionAttrs.capacity / biggest)
        )
    }

    // An equipment or a retainer serves for `stay` turns, as long as its bearer is not lost: what its
    // bonuses are worth each turn, and the life counters once. Null when it carries nothing the bot values
    private attachedWorth(attached: Effect[], bearer: MinionProfile): number | null {
        const { cards } = this.assessment.profile
        let perTurn = 0
        let once = 0
        let known = false
        for (const effect of attached) {
            switch (effect.type) {
                case 'strength':
                    perTurn += effect.amount * cards.perStrength
                    known = true
                    break
                case 'intercept':
                    perTurn += this.interceptWorth(bearer, effect.amount, effect.bleedsOnly)
                    known = true
                    break
                case 'environmentalDamage':
                    perTurn += effect.amount * cards.perDamage
                    known = true
                    break
                case 'preventDamage':
                    perTurn += effect.amount * cards.perPrevention
                    known = true
                    break
                case 'weaponStrike':
                    perTurn += effect.damage * cards.perWeaponDamage
                    known = true
                    break
                case 'life':
                    once += effect.amount * cards.perLife
                    known = true
                    break
                default:
                    break
            }
        }
        if (!known) {
            return null
        }
        const survival = Math.min(1, Math.max(0.25, bearer.blood / Math.max(1, bearer.capacity)))
        return cards.stay * survival * perTurn + once
    }

    // What `amount` more intercept on the bearer is worth each turn it is home: the share of the actions that
    // are not bleeds it can stop, and the pool of the lunge of my predator it stops with the table as it is
    private interceptWorth(bearer: MinionProfile, amount: number, bleedsOnly: boolean): number {
        const { table, profile, idle } = this.assessment
        const actors = idle[table.me.oid] ?? []
        const guard =
            bleedsOnly ? 0 : (
                profile.plan.guard *
                (interceptShare(bearer.intercept.general + amount, actors) -
                    interceptShare(bearer.intercept.general, actors))
            )
        const raised: MinionProfile = {
            ...bearer,
            intercept: {
                general: bearer.intercept.general + (bleedsOnly ? 0 : amount),
                directed: bearer.intercept.directed + (bleedsOnly ? 0 : amount),
                againstBleeds: bearer.intercept.againstBleeds + amount,
            },
        }
        const home: Assessment = {
            ...this.assessment,
            table: {
                ...table,
                me: {
                    ...table.me,
                    minions: table.me.minions.map(minion =>
                        minion.oid == bearer.oid ? raised : minion,
                    ),
                },
            },
        }
        this.lungeAsIs ??= lungeCostWithAllHome(this.assessment)
        return guard + Math.max(0, this.lungeAsIs - lungeCostWithAllHome(home))
    }

    // The cards of my hand that the equipment forbids to play: they are dead while it is on the minion
    private lockedOut(attached: Effect[]): number {
        const names = attached.flatMap(effect =>
            effect.type == 'restrictPlay' ? effect.names : [],
        )
        return this.assessment.table.me.hand.filter(({ card }) => names.includes(card.name)).length
    }

    // The chance that the Methuselahs that may react block the action, and the fight that follows. The
    // stealth is the action's own, and the cards I hold that raise it count as if played
    private blockRisk(candidate: Candidate, actor: MinionProfile): BlockRisk {
        const { table, densities, profile } = this.assessment
        const { action } = candidate.option
        const stealth = getDefaultStealth(action)
        const kit = attackKitOf(table.me, [actor], densities[table.me.oid], profile)
        let open = 1
        let fight = 0
        for (const player of getReactingPlayers(action)) {
            const owner = table.others.find(other => other.oid == player.oid)
            if (!owner) {
                continue
            }
            const side = defenceOf(table, owner, 'general', densities[owner.oid])
            const { blockedShare } = resolveAttack([{ bleed: 0, stealth }], side, kit)
            if (blockedShare > 0) {
                fight += open * blockedShare * this.fightAgainst(actor, owner)
            }
            open *= 1 - blockedShare
        }
        return { share: 1 - open, fight }
    }

    // The worst fight a block of `owner` runs the minion into, in pool
    private fightAgainst(actor: MinionProfile, owner: MethuselahSnapshot): number {
        const key = `${actor.oid}:${owner.oid}`
        const known = this.fights.get(key)
        if (known !== undefined) {
            return known
        }
        const { table, profile, densities } = this.assessment
        const risk = Math.max(
            0,
            ...unlockedMinions(owner).map(blocker =>
                fightRisk(table, profile, actor, owner, densities[owner.oid], blocker),
            ),
        )
        this.fights.set(key, risk)
        return risk
    }
}

// What the lunge of my predator costs me when all my minions are home to block it
function lungeCostWithAllHome(assessment: Assessment): number {
    const reserved = readyMinions(assessment.table.me)
    return costOfLunge(assessment, outcomeOfTurn(assessment, { actors: [], reserved })).total
}

// The minion that bears the card: the one it is put on, else the acting one
function bearerOf(
    me: MethuselahSnapshot,
    target: Card | Player | undefined,
    actor: MinionProfile,
): MinionProfile {
    return (target instanceof Card && me.minions.find(minion => minion.oid == target.oid)) || actor
}
