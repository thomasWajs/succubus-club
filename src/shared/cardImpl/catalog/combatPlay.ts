import { CombatPlay, Condition } from '@/shared/cardImpl/catalog/types.ts'
import { CombatRange, CombatStep } from '@/shared/types/state.ts'
import { newStrike, PlayStrike } from '@/shared/state/combatRules.ts'

/**
 * What a play of a combat card gives to the minion that plays it, from the state of the combat: the
 * conditions of the play and the effects it turns into. Pure, it does not know the game: the interpreter
 * ( the engine ) and the bot's combat model each describe the combat as a CombatPlayContext.
 */

// What a combat card gives to the minion playing it. The card itself is attached by the caller ( the
// strike's source, the cost to pay ).
export type CombatCardEffect =
    // An additional strike can come with the strike card
    | { type: 'strike'; strike: PlayStrike; additional?: { limited: boolean } }
    // A maneuver, with the strike it also chooses when it comes from a strike card
    | { type: 'maneuver'; strike?: PlayStrike }
    | { type: 'press' }
    | { type: 'prevent'; amount: number; aggravated: boolean }
    // The strength of the minion for the rest of the combat
    | { type: 'setStrength'; amount: number }
    // Damage the opposing minion takes each round of the combat
    | { type: 'environmentalDamage'; amount: number }
    // Played in the window after a pair of strikes
    | { type: 'additionalStrike'; limited: boolean }
    | { type: 'grapple'; press: boolean; closeNextRound: boolean }
    | { type: 'gainBlood'; amount: number }

export type CombatPlayContext = {
    round: number
    step: CombatStep
    range: CombatRange
    // The krcg ids of the combat cards the minion played this round, and in the whole combat
    playedThisRound: string[]
    playedThisCombat: string[]
    strength: number
    limitedAdditionalGained: boolean
    // The opposing minion
    opposingBloodLost: number
    opposingIsVampire: boolean
}

const COMBAT_STEPS = {
    beforeRange: CombatStep.BeforeRange,
    beforeStrikes: CombatStep.BeforeStrikes,
    endOfRound: CombatStep.EndOfRound,
}

export type CombatCondition = Extract<
    Condition,
    {
        type:
            | 'combatRound'
            | 'combatStep'
            | 'closeRange'
            | 'oncePerRound'
            | 'oncePerCombat'
            | 'opposingIsVampire'
    }
>

export function isCombatCondition(condition: Condition): condition is CombatCondition {
    switch (condition.type) {
        case 'combatRound':
        case 'combatStep':
        case 'closeRange':
        case 'oncePerRound':
        case 'oncePerCombat':
        case 'opposingIsVampire':
            return true
        default:
            return false
    }
}

// With no combat ( null ) nothing holds, but a card not played yet is not played this round
export function combatConditionHolds(
    condition: CombatCondition,
    cardId: string,
    context: CombatPlayContext | null,
): boolean {
    switch (condition.type) {
        case 'combatRound':
            return context?.round == condition.round
        case 'combatStep':
            return context?.step == COMBAT_STEPS[condition.step]
        case 'closeRange':
            return context?.range == CombatRange.Close
        case 'oncePerRound':
            return !context?.playedThisRound.includes(cardId)
        case 'oncePerCombat':
            return !context?.playedThisCombat.includes(cardId)
        case 'opposingIsVampire':
            return !!context?.opposingIsVampire
    }
}

// Do the conditions of the play that are about the combat hold
export function combatConditionsHold(
    play: CombatPlay,
    cardId: string,
    context: CombatPlayContext,
): boolean {
    return (play.when ?? []).every(
        condition =>
            !isCombatCondition(condition) || combatConditionHolds(condition, cardId, context),
    )
}

// The effects the play could give right now ( its conditions hold ). The step it is played in is
// checked by the rules of the combat, from the kind of effect.
export function combatPlayEffects(
    play: CombatPlay,
    context: CombatPlayContext,
): CombatCardEffect[] {
    const hasStrike = play.effects.some(effect => effect.type == 'strike')
    // The additional strike of a strike card comes with it, unless a limited one was gained
    const additional = play.effects.find(effect => effect.type == 'additionalStrike')
    const additionalWithStrike =
        additional && !(additional.limited && context.limitedAdditionalGained) ?
            { limited: additional.limited }
        :   undefined

    const strikes = play.effects.flatMap((effect): PlayStrike[] => {
        if (effect.type != 'strike') {
            return []
        }
        return [
            effect.preset == 'dodge' ?
                newStrike('Dodge', { dodge: true })
            :   newStrike(`Hand strike +${effect.extraDamage}`, {
                    damage: context.strength + effect.extraDamage,
                    isHand: true,
                    undodgeable: !!effect.undodgeable,
                }),
        ]
    })
    // The maneuver of a card that is also a strike card chooses the strike as well
    const effects = play.effects.flatMap((effect): CombatCardEffect[] => {
        switch (effect.type) {
            case 'maneuver':
                return effect.toCloseOnly && context.range != CombatRange.Long ?
                        []
                    :   [{ type: 'maneuver', strike: strikes[0] }]
            case 'strike':
                return []
            case 'setStrength':
                return effect.amount > context.strength ?
                        [{ type: 'setStrength', amount: effect.amount }]
                    :   []
            case 'additionalStrike':
                return hasStrike || (effect.limited && context.limitedAdditionalGained) ?
                        []
                    :   [{ type: 'additionalStrike', limited: effect.limited }]
            case 'grapple':
                return [
                    {
                        type: 'grapple',
                        press: effect.press,
                        closeNextRound: effect.closeNextRound,
                    },
                ]
            case 'environmentalDamage':
                return [{ type: 'environmentalDamage', amount: effect.amount }]
            case 'gainBloodFromDamage':
                return context.opposingBloodLost > 0 ?
                        [{ type: 'gainBlood', amount: context.opposingBloodLost }]
                    :   []
        }
    })
    return [
        ...strikes.map(
            (strike): CombatCardEffect => ({
                type: 'strike',
                strike,
                additional: additionalWithStrike,
            }),
        ),
        ...effects,
    ]
}
