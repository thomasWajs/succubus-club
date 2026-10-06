import { DisciplineCode, DisciplineLevel } from '@/shared/const/model.ts'
import { KrcgId } from '@/shared/types/gateway.ts'
import { EventName } from '@/shared/state/events.ts'
import {
    AdditionalStrikeEffect,
    BleedActionEffect,
    BleedEffect,
    CardDef,
    Condition,
    CryptStatics,
    DiscardFromHandEffect,
    EnterCombatEffect,
    StealPoolEffect,
    StrengthIfBlockedEffect,
    UnlockAndBlockEffect,
    TransferEffect,
    GainBloodEffect,
    GainBloodFromDamageEffect,
    GrappleEffect,
    HandSizeEffect,
    InterceptEffect,
    ArmTriggerEffect,
    EventCondition,
    Trigger,
    TriggerCost,
    TriggerEffect,
    ChangeTargetEffect,
    ManeuverEffect,
    Play,
    ReactionEffect,
    Requirement,
    SetStrengthEffect,
    StealthEffect,
    StrikeEffect,
    VariableBleedEffect,
    WakeEffect,
} from '@/shared/cardImpl/catalog/types.ts'

/**
 * The vocabulary to write cards: small functions returning plain data.
 */

export function defineCard(id: KrcgId, name: string, plays: Play[]): CardDef {
    return { id, name, plays }
}

export function defineCrypt(id: KrcgId, name: string, crypt: CryptStatics): CardDef {
    return { id, name, plays: [], crypt }
}

// Requirements. The code is the one used in the card text: 'dom' for Dominate.
export const none: Requirement = { type: 'none' }

export function discipline(code: string, level: 'inferior' | 'superior'): Requirement {
    const name = DisciplineCode[code]
    if (!name) {
        throw new Error(`Unknown discipline code '${code}'`)
    }
    return {
        type: 'discipline',
        discipline: name,
        level: level == 'superior' ? DisciplineLevel.SUPERIOR : DisciplineLevel.INFERIOR,
    }
}

export function all(...of: Requirement[]): Requirement {
    return { type: 'all', of }
}

export function any(...of: Requirement[]): Requirement {
    return { type: 'any', of }
}

// Conditions
export const duringBleed: Condition = { type: 'during', action: 'bleed' }
export const actionTargetsYou: Condition = { type: 'actionTargets', who: 'you' }
export const afterBlocksDeclined: Condition = { type: 'afterBlocksDeclined' }
export const reactorIsVampire: Condition = { type: 'reactorIs', minion: 'vampire' }

export const yourBlockStands: Condition = { type: 'yourBlockStands' }
export const yourAnarchBlockStands: Condition = { type: 'yourBlockStands', sect: 'Anarch' }
export const usableWhileLocked: Condition = { type: 'usableWhileLocked' }

// An effect that only counts when the conditions hold, on top of those of the play
export function onlyIf<E extends ReactionEffect>(
    effect: E,
    ...when: Condition[]
): E & { when: Condition[] } {
    return { ...effect, when }
}

export function unlockAndBlock(options: { intercept: number }): UnlockAndBlockEffect {
    return { type: 'unlockAndBlock', sect: 'Anarch', ...options }
}

export function strengthIfBlocked(amount: number): StrengthIfBlockedEffect {
    return { type: 'strengthIfBlocked', amount }
}
export const minionLocked: Condition = { type: 'minionLocked' }
export const oncePerUnlock: Condition = { type: 'oncePerUnlock' }

export function targetPoolAtMost(amount: number): Condition {
    return { type: 'targetPoolAtMost', amount }
}

export function combatRound(round: number): Condition {
    return { type: 'combatRound', round }
}

export const beforeRange: Condition = { type: 'combatStep', step: 'beforeRange' }
export const beforeStrikes: Condition = { type: 'combatStep', step: 'beforeStrikes' }
export const endOfRound: Condition = { type: 'combatStep', step: 'endOfRound' }
export const closeRange: Condition = { type: 'closeRange' }
export const oncePerRound: Condition = { type: 'oncePerRound' }
export const opposingIsVampire: Condition = { type: 'opposingIsVampire' }

// Effects
export function stealth(amount: number): StealthEffect {
    return { type: 'stealth', amount }
}

export function bleed(amount: number, options: { limited?: boolean } = {}): BleedEffect {
    return { type: 'bleed', amount, ...options }
}

export function bleedX(options: { limited?: boolean } = {}): VariableBleedEffect {
    return { type: 'bleed', amount: 'X', ...options }
}

export function intercept(amount: number): InterceptEffect {
    return { type: 'intercept', amount }
}

export const bleedAction: BleedActionEffect = { type: 'bleedAction' }

export function stealPool(amount: number): StealPoolEffect {
    return { type: 'stealPool', amount }
}

export const enterCombat: EnterCombatEffect = { type: 'enterCombat' }

export function gainBlood(amount: number): GainBloodEffect {
    return { type: 'gainBlood', amount }
}

export const maneuver: ManeuverEffect = { type: 'maneuver' }
export const maneuverToClose: ManeuverEffect = { type: 'maneuver', toCloseOnly: true }
export const dodge: StrikeEffect = { type: 'strike', preset: 'dodge' }

export function handStrike(
    extraDamage: number,
    options: { undodgeable?: boolean } = {},
): StrikeEffect {
    return { type: 'strike', preset: 'hand', extraDamage, ...options }
}

export function additionalStrike(options: { limited: boolean }): AdditionalStrikeEffect {
    return { type: 'additionalStrike', ...options }
}

export function grapple(options: { press: boolean; closeNextRound: boolean }): GrappleEffect {
    return { type: 'grapple', ...options }
}

export const gainBloodFromDamage: GainBloodFromDamageEffect = { type: 'gainBloodFromDamage' }

export function setStrength(amount: number): SetStrengthEffect {
    return { type: 'setStrength', amount }
}

export function changeTarget(options: { lockReactor: boolean }): ChangeTargetEffect {
    return { type: 'changeTarget', ...options }
}

export function armTrigger(trigger: Trigger): ArmTriggerEffect {
    return { type: 'armTrigger', trigger }
}

export function actorIs(options: {
    other?: boolean
    controller?: 'self'
    sect?: 'Anarch'
}): EventCondition {
    return { type: 'actorIs', ...options }
}

export function burnBlood(amount: number): TriggerCost {
    return { type: 'burnBlood', amount }
}

export const unlockSelf: TriggerEffect = { type: 'unlock', who: 'self' }

// Locks the minion the event is about, when the later event is announced
export function lockAt(at: EventName, who: 'eventBlocker'): TriggerEffect {
    return { type: 'lock', who, at }
}

export const wake: WakeEffect = { type: 'wake' }

export const drawCryptRemoveUncontrolled: TransferEffect = { type: 'drawCryptRemoveUncontrolled' }
export const burnSelf: TransferEffect = { type: 'burnSelf' }

export function gainPool(amount: number): TransferEffect {
    return { type: 'gainPool', amount }
}

export const discardFromHand: DiscardFromHandEffect = { type: 'discardFromHand' }

export function handSize(amount: number): HandSizeEffect {
    return { type: 'handSize', amount }
}
