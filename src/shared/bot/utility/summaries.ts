import { Card } from '@/shared/model/Card.ts'
import { gameResources } from '@/shared/registries.ts'
import { EventName } from '@/shared/state/events.ts'
import { KrcgId } from '@/shared/types/gateway.ts'
import { CryptCardResource, Disciplines, LibraryCardResource } from '@/shared/types/resources.ts'
import { getCardDefById } from '@/shared/cardImpl/catalog/index.ts'
import { expandRequirement, UsageOption } from '@/shared/cardImpl/catalog/requirements.ts'
import {
    ActionEffect,
    ActionTarget,
    AttachedEffect,
    CardKind,
    CombatEffect,
    Condition,
    CryptStatics,
    MasterAbility,
    MasterEffect,
    MasterOnPlay,
    MinionFilter,
    ModifierEffect,
    Play,
    ReactionEffect,
    StaysInPlay,
    Trigger,
    TriggerEffect,
} from '@/shared/cardImpl/catalog/types.ts'

/**
 * What a card does, read from the catalog and never from a card id: the scorer asks a summary what a
 * play is worth ( its effects, the window it is made in, its roles ), so any catalogued card is valued
 * without touching the agent. The referee only offers the plays that are legal, so a summary does not
 * decide legality: its conditions are there for the planners that look ahead.
 */

// What a play is FOR, derived from its effects ( never listed by card ). A card can have several: the
// hand is judged by the mix of roles ( .claude/docs/bot-ai-phase3.md, section 3b point 7 )
export const ROLES = [
    // The action bleeds a Methuselah
    'bleed',
    // Adds to a bleed: a modifier, or a vampire that bleeds harder
    'bleedBonus',
    // Raises the stealth of an action, when played ( a modifier, a standing ability, a vampire )
    'stealth',
    'poolSteal',
    'combatStarter',
    // Brings a younger vampire out of the uncontrolled region
    'recruit',
    // Blood or pool back for me
    'sustain',
    'poolGain',
    'bounce',
    // Brings a locked minion back into the block, with or without intercept on top
    'wake',
    'intercept',
    // Punishes the minion that failed to block
    'punishBlock',
    'unlock',
    'strike',
    'dodge',
    'maneuver',
    'additionalStrike',
    'grapple',
    'strength',
    'damageOverTime',
    'prevention',
    // Life counters of a retainer: damage soaked is blood saved
    'soak',
    // Stays on a minion
    'attachment',
    'master',
    'handSize',
    // Throws cards away to draw new ones, or cycles the crypt
    'cycling',
] as const
export type Role = (typeof ROLES)[number]

// When a play is made
export type PlayWindow =
    // The action of a minion in its controller's minion phase ( action cards )
    | 'minionAction'
    // During an action of mine ( action modifiers ), or only during a bleed
    | 'ownAction'
    | 'ownBleed'
    // A reaction to an action aimed at me, before or while the blocks are decided
    | 'beforeBlock'
    // A reaction that needs a block attempt of mine to stand ( rule N: intercept is only raised when needed )
    | 'blockAttemptStands'
    // The blocks were declined and the action is aimed at me: the bounce window
    | 'afterBlocksDeclined'
    | 'afterYourBlock'
    | 'combat'
    | 'masterPhase'

export type CombatStep = 'beforeRange' | 'beforeStrikes' | 'endOfRound'

type EffectCore =
    | { type: 'stealth'; amount: number }
    // Only for the blocks against bleeds aimed at the controller, when bleedsOnly
    | { type: 'intercept'; amount: number; bleedsOnly: boolean }
    // The action is a bleed of this amount ( the bleed of the card, on top of the minion's own )
    | { type: 'bleedAction'; amount: number }
    // More bleed for a bleed that is happening ( limited: one such bonus per action ); 'X' for a variable cost
    | { type: 'bleedBonus'; amount: number | 'X'; limited: boolean }
    // A vampire that bleeds this much more ( a crypt card )
    | { type: 'ownBleed'; amount: number }
    | { type: 'gainBlood'; amount: number }
    | { type: 'stealPool'; amount: number }
    | { type: 'enterCombat'; targetActs: boolean }
    | { type: 'lockTarget' }
    | { type: 'strengthIfBlocked'; amount: number }
    | { type: 'bounce'; lockReactor: boolean }
    | { type: 'wake' }
    // The reacting minion is unlocked and may then attempt to block
    | { type: 'unlockReactor' }
    // Unlocks a minion which then attempts a block with this much more intercept
    | { type: 'unlockAndBlock'; intercept: number }
    | { type: 'blockManeuver' }
    | { type: 'maneuver'; toCloseOnly: boolean }
    | { type: 'dodge' }
    // damage = the strength of the minion + extraDamage
    | { type: 'handStrike'; extraDamage: number; undodgeable: boolean }
    | {
          type: 'weaponStrike'
          damage: number
          ranged: boolean
          aggravated: boolean
          maneuver: boolean
      }
    | { type: 'setStrength'; amount: number }
    | { type: 'additionalStrike'; limited: boolean }
    | { type: 'grapple'; press: boolean; closeNextRound: boolean }
    | { type: 'gainBloodFromDamage' }
    | { type: 'environmentalDamage'; amount: number }
    | { type: 'strength'; amount: number }
    | { type: 'life'; amount: number }
    | { type: 'preventDamage'; amount: number }
    | { type: 'moveBlood'; amount: number; phase: 'master' | 'unlock' }
    | { type: 'restrictPlay'; names: string[] }
    | { type: 'burnsInTorpor' }
    | { type: 'handSize'; amount: number }
    | { type: 'discardFromHand' }
    | { type: 'drawCrypt' }
    | { type: 'burnSelf' }
    | { type: 'gainPool'; amount: number }
    | { type: 'lockFailedBlocker' }
    | { type: 'unlockSelf' }
    // What happens when an event is announced: armed for the rest of the action by a played card, or
    // standing on a card in play
    | {
          type: 'trigger'
          on: EventName
          armed: boolean
          optional: boolean
          costBlood: number
          oncePerTurn: boolean
          effects: Effect[]
      }
    // Crypt cards
    | { type: 'undirectedStealth'; amount: number }
    | { type: 'directedIntercept'; amount: number }
    | { type: 'canEnterCombat' }
    | { type: 'mustBleedWhileMinionLocked' }

// An effect can hold only under conditions of its own, on top of those of the play
export type Effect = EffectCore & { when?: Condition[] }
export type EffectType = EffectCore['type']

export type AbilityWindow =
    | 'unlockPhase'
    | 'masterPhase'
    | 'discardPhase'
    | 'influencePhase'
    | 'ownAction'

// What a card in play lets its controller do ( "you can lock this card to ..." )
export type AbilitySummary = {
    activate: MasterAbility['activate']
    windows: AbilityWindow[]
    // Locks the card: one use per cycle, until the next unlock phase
    locks: boolean
    // Transfers it costs ( influence phase )
    transfers: number
    // The minions of the controller that can use it, when it is for one of them ( 'lockForAction' )
    minion: MinionFilter | null
    effects: Effect[]
    roles: Role[]
}

export type PlaySummary = {
    kind: CardKind
    // The ways to declare it: each is the list of discipline uses announced together ( [[]]: none required )
    ways: UsageOption[]
    window: PlayWindow
    // The step of the combat the play is restricted to
    combatStep: CombatStep | null
    // The conditions of the play as the catalog states them
    conditions: Condition[]
    // The values of the X of a variable cost
    x: { min: number; max: number } | null
    target: ActionTarget | null
    // What it does when it is played
    effects: Effect[]
    staysInPlay: StaysInPlay
    // The minion it is put on ( 'this': the acting one )
    attachTo: MinionFilter | 'this' | null
    // What it does while it is attached to a minion
    attached: Effect[]
    onePerMinion: boolean
    abilities: AbilitySummary[]
    roles: Role[]
}

export type CardSummary = {
    id: KrcgId
    name: string
    // Described in the catalog: false means the bot knows nothing of what the card does
    catalogued: boolean
    isCrypt: boolean
    // The types of a library card ( "Action Modifier/Combat" ), '' for a crypt card
    type: string
    // The raw cost of a library card, 'X' when variable
    pool: number | 'X'
    blood: number | 'X'
    plays: PlaySummary[]
    // What a crypt card adds to the vampire
    cryptEffects: Effect[]
    // The roles of every play, of what it does attached and of its abilities
    roles: Role[]
}

function unreachable(value: never): never {
    throw new Error(`Unhandled catalog entry ${JSON.stringify(value)}`)
}

function summarizeTriggerEffect(effect: TriggerEffect): Effect {
    switch (effect.type) {
        case 'lock':
            return { type: 'lockFailedBlocker' }
        case 'unlock':
            return { type: 'unlockSelf' }
        default:
            return unreachable(effect)
    }
}

function summarizeTrigger(trigger: Trigger, armed: boolean): Effect {
    return {
        type: 'trigger',
        on: trigger.on,
        armed,
        optional: trigger.mode == 'optional',
        costBlood: trigger.cost?.amount ?? 0,
        oncePerTurn: trigger.limit == 'oncePerTurn',
        effects: trigger.effects.map(summarizeTriggerEffect),
    }
}

function summarizeActionEffects(effects: ActionEffect[]): Effect[] {
    const isBleedAction = effects.some(effect => effect.type == 'bleedAction')
    const result: Effect[] = []
    let bleed = 0
    for (const effect of effects) {
        switch (effect.type) {
            case 'bleedAction':
                break
            case 'bleed':
                // The bleed of a bleed action is part of the action. Without a bleed action it is a bonus
                if (isBleedAction) {
                    bleed += effect.amount
                } else {
                    result.push({
                        type: 'bleedBonus',
                        amount: effect.amount,
                        limited: !!effect.limited,
                    })
                }
                break
            case 'stealth':
                result.push({ type: 'stealth', amount: effect.amount })
                break
            case 'gainBlood':
                result.push({ type: 'gainBlood', amount: effect.amount })
                break
            case 'stealPool':
                result.push({ type: 'stealPool', amount: effect.amount })
                break
            case 'enterCombat':
                result.push({ type: 'enterCombat', targetActs: !!effect.targetActs })
                break
            case 'lockTarget':
                result.push({ type: 'lockTarget' })
                break
            case 'strengthIfBlocked':
                result.push({ type: 'strengthIfBlocked', amount: effect.amount })
                break
            default:
                unreachable(effect)
        }
    }
    return isBleedAction ? [{ type: 'bleedAction', amount: bleed }, ...result] : result
}

function summarizeModifierEffects(effects: ModifierEffect[]): Effect[] {
    return effects.map((effect): Effect => {
        switch (effect.type) {
            case 'stealth':
                return { type: 'stealth', amount: effect.amount }
            case 'bleed':
                return { type: 'bleedBonus', amount: effect.amount, limited: !!effect.limited }
            case 'intercept':
                return { type: 'intercept', amount: effect.amount, bleedsOnly: false }
            case 'armTrigger':
                return summarizeTrigger(effect.trigger, true)
            default:
                return unreachable(effect)
        }
    })
}

function summarizeCombatEffects(effects: CombatEffect[]): Effect[] {
    return effects.map((effect): Effect => {
        switch (effect.type) {
            case 'maneuver':
                return { type: 'maneuver', toCloseOnly: !!effect.toCloseOnly }
            case 'strike':
                return effect.preset == 'dodge' ?
                        { type: 'dodge' }
                    :   {
                            type: 'handStrike',
                            extraDamage: effect.extraDamage,
                            undodgeable: !!effect.undodgeable,
                        }
            case 'setStrength':
                return { type: 'setStrength', amount: effect.amount }
            case 'additionalStrike':
                return { type: 'additionalStrike', limited: effect.limited }
            case 'grapple':
                return {
                    type: 'grapple',
                    press: effect.press,
                    closeNextRound: effect.closeNextRound,
                }
            case 'gainBloodFromDamage':
                return { type: 'gainBloodFromDamage' }
            case 'environmentalDamage':
                return { type: 'environmentalDamage', amount: effect.amount }
            default:
                return unreachable(effect)
        }
    })
}

function summarizeReactionEffects(effects: (ReactionEffect & { when?: Condition[] })[]): Effect[] {
    return effects.map((effect): Effect => {
        const when = effect.when
        const summary = ((): Effect => {
            switch (effect.type) {
                case 'changeTarget':
                    return { type: 'bounce', lockReactor: effect.lockReactor }
                case 'intercept':
                    return { type: 'intercept', amount: effect.amount, bleedsOnly: false }
                case 'wake':
                    return { type: 'wake' }
                case 'unlockAndBlock':
                    return { type: 'unlockAndBlock', intercept: effect.intercept }
                case 'unlock':
                    return { type: 'unlockReactor' }
                case 'blockManeuver':
                    return { type: 'blockManeuver' }
                default:
                    return unreachable(effect)
            }
        })()
        return when ? { ...summary, when } : summary
    })
}

// What a card attached to a minion does while it is attached ( equipment, retainer, a master put on a vampire )
export function summarizeAttached(effects: AttachedEffect[]): Effect[] {
    return effects.map((effect): Effect => {
        switch (effect.type) {
            case 'weaponStrike':
                return {
                    type: 'weaponStrike',
                    damage: effect.damage,
                    ranged: !!effect.ranged,
                    aggravated: !!effect.aggravated,
                    maneuver: !!effect.maneuver,
                }
            case 'life':
                return { type: 'life', amount: effect.amount }
            case 'intercept':
                return { type: 'intercept', amount: effect.amount, bleedsOnly: false }
            case 'bleedIntercept':
                return { type: 'intercept', amount: effect.amount, bleedsOnly: true }
            case 'strength':
                return { type: 'strength', amount: effect.amount }
            case 'moveBlood':
                return { type: 'moveBlood', amount: effect.amount, phase: effect.phase ?? 'master' }
            case 'cannotPlay':
                return { type: 'restrictPlay', names: effect.names }
            case 'environmentalDamage':
                return { type: 'environmentalDamage', amount: effect.amount }
            case 'preventDamage':
                return { type: 'preventDamage', amount: effect.amount }
            case 'burnInTorpor':
                return { type: 'burnsInTorpor' }
            default:
                return unreachable(effect)
        }
    })
}

function summarizeMasterEffects(
    effects: MasterEffect[],
    onPlay: MasterOnPlay | undefined,
): Effect[] {
    return [
        // The hand size is the only master effect for now: a second one makes this a switch
        ...effects.map((effect): Effect => ({ type: 'handSize', amount: effect.amount })),
        ...(onPlay?.effects ?? []).map(
            (effect): Effect => ({ type: 'gainBlood', amount: effect.amount }),
        ),
    ]
}

export function summarizeAbility(ability: MasterAbility): AbilitySummary {
    switch (ability.activate) {
        case 'unlock': {
            const effects = ability.effects.map(
                (effect): Effect => ({ type: 'gainBlood', amount: effect.amount }),
            )
            return abilitySummary(ability.activate, ['unlockPhase'], false, 0, null, effects)
        }
        case 'lock':
            return abilitySummary(
                ability.activate,
                ['masterPhase', 'discardPhase'],
                true,
                0,
                null,
                ability.effects.map((): Effect => ({ type: 'discardFromHand' })),
            )
        case 'transfer':
            return abilitySummary(
                ability.activate,
                ['influencePhase'],
                false,
                ability.transfers,
                null,
                ability.effects.map((effect): Effect => {
                    switch (effect.type) {
                        case 'drawCryptRemoveUncontrolled':
                            return { type: 'drawCrypt' }
                        case 'burnSelf':
                            return { type: 'burnSelf' }
                        case 'gainPool':
                            return { type: 'gainPool', amount: effect.amount }
                        default:
                            return unreachable(effect)
                    }
                }),
            )
        case 'lockForAction':
            return abilitySummary(
                ability.activate,
                ['ownAction'],
                true,
                0,
                ability.minion,
                ability.effects.map(
                    (effect): Effect => ({ type: 'stealth', amount: effect.amount }),
                ),
            )
        default:
            return unreachable(ability)
    }
}

function abilitySummary(
    activate: AbilitySummary['activate'],
    windows: AbilityWindow[],
    locks: boolean,
    transfers: number,
    minion: MinionFilter | null,
    effects: Effect[],
): AbilitySummary {
    return { activate, windows, locks, transfers, minion, effects, roles: deriveRoles(effects) }
}

// What a crypt card adds to its vampire, whatever the text says
export function summarizeCrypt(crypt: CryptStatics): Effect[] {
    const effects: Effect[] = []
    if (crypt.bleed) {
        effects.push({ type: 'ownBleed', amount: crypt.bleed })
    }
    if (crypt.strength) {
        effects.push({ type: 'strength', amount: crypt.strength })
    }
    if (crypt.canEnterCombat) {
        effects.push({ type: 'canEnterCombat' })
    }
    if (crypt.undirectedStealth) {
        effects.push({ type: 'undirectedStealth', amount: crypt.undirectedStealth })
    }
    if (crypt.directedIntercept) {
        effects.push({ type: 'directedIntercept', amount: crypt.directedIntercept })
    }
    if (crypt.mustBleedWhileMinionLocked) {
        effects.push({ type: 'mustBleedWhileMinionLocked' })
    }
    if (crypt.handSize) {
        effects.push({ type: 'handSize', amount: crypt.handSize })
    }
    for (const trigger of crypt.triggers ?? []) {
        effects.push(summarizeTrigger(trigger, false))
    }
    return effects
}

// The effects, with those held by a trigger
function flatten(effects: Effect[]): Effect[] {
    return effects.flatMap(effect =>
        effect.type == 'trigger' ? [effect, ...flatten(effect.effects)] : [effect],
    )
}

// The stealth of an action card is the action's own ( the action is stealthy ): with `ownStealth` it is
// not a role, anywhere else it is a source of stealth. `target` is what the action aims at.
function deriveRoles(
    effects: Effect[],
    options: { target?: ActionTarget; ownStealth?: boolean } = {},
): Role[] {
    const { target, ownStealth } = options
    const roles = new Set<Role>()
    for (const effect of flatten(effects)) {
        switch (effect.type) {
            case 'stealth':
                if (!ownStealth) {
                    roles.add('stealth')
                }
                break
            case 'undirectedStealth':
                if (effect.amount > 0) {
                    roles.add('stealth')
                }
                break
            case 'intercept':
            case 'directedIntercept':
                roles.add('intercept')
                break
            case 'bleedAction':
                roles.add('bleed')
                break
            case 'bleedBonus':
            case 'ownBleed':
                roles.add('bleedBonus')
                break
            case 'gainBlood':
                roles.add(target == 'youngerUncontrolledVampire' ? 'recruit' : 'sustain')
                break
            case 'stealPool':
                roles.add('poolSteal')
                break
            case 'enterCombat':
            case 'canEnterCombat':
                roles.add('combatStarter')
                break
            case 'strengthIfBlocked':
            case 'setStrength':
            case 'strength':
                roles.add('strength')
                break
            case 'bounce':
                roles.add('bounce')
                break
            case 'wake':
            case 'unlockReactor':
                roles.add('wake')
                break
            case 'unlockAndBlock':
                roles.add('wake')
                roles.add('intercept')
                break
            case 'blockManeuver':
            case 'maneuver':
                roles.add('maneuver')
                break
            case 'dodge':
                roles.add('dodge')
                break
            case 'handStrike':
                roles.add('strike')
                break
            case 'weaponStrike':
                roles.add('strike')
                if (effect.maneuver) {
                    roles.add('maneuver')
                }
                break
            case 'additionalStrike':
                roles.add('additionalStrike')
                break
            case 'grapple':
                roles.add('grapple')
                break
            case 'gainBloodFromDamage':
            case 'moveBlood':
                roles.add('sustain')
                break
            case 'environmentalDamage':
                roles.add('damageOverTime')
                break
            case 'life':
                roles.add('soak')
                break
            case 'preventDamage':
                roles.add('prevention')
                break
            case 'handSize':
                roles.add('handSize')
                break
            case 'discardFromHand':
            case 'drawCrypt':
                roles.add('cycling')
                break
            case 'gainPool':
                roles.add('poolGain')
                break
            case 'lockFailedBlocker':
                roles.add('punishBlock')
                break
            case 'unlockSelf':
                roles.add('unlock')
                break
            // Facts the planners read but that do not make a role of their own
            case 'lockTarget':
            case 'restrictPlay':
            case 'burnsInTorpor':
            case 'burnSelf':
            case 'mustBleedWhileMinionLocked':
            case 'trigger':
                break
            default:
                unreachable(effect)
        }
    }
    return ROLES.filter(role => roles.has(role))
}

function hasCondition(conditions: Condition[], type: Condition['type']): boolean {
    return conditions.some(condition => condition.type == type)
}

function combatStepOf(conditions: Condition[]): CombatStep | null {
    for (const condition of conditions) {
        if (condition.type == 'combatStep') {
            return condition.step
        }
    }
    return null
}

function reactionWindow(conditions: Condition[], effects: Effect[]): PlayWindow {
    if (hasCondition(conditions, 'afterBlocksDeclined')) {
        return 'afterBlocksDeclined'
    }
    if (hasCondition(conditions, 'afterYourBlock')) {
        return 'afterYourBlock'
    }
    // An intercept is only raised while a block attempt stands, unless the play starts the attempt itself
    const raisesIntercept = effects.some(effect => effect.type == 'intercept')
    const startsAttempt = effects.some(effect => effect.type == 'unlockAndBlock')
    if (hasCondition(conditions, 'yourBlockStands') || (raisesIntercept && !startsAttempt)) {
        return 'blockAttemptStands'
    }
    return 'beforeBlock'
}

export function summarizePlay(play: Play): PlaySummary {
    const conditions = play.when ?? []
    const base = {
        kind: play.kind,
        ways: expandRequirement(play.requires),
        conditions,
        combatStep: combatStepOf(conditions),
        x: null as { min: number; max: number } | null,
        target: null as ActionTarget | null,
        staysInPlay: 'discard' as StaysInPlay,
        attachTo: null as MinionFilter | 'this' | null,
        attached: [] as Effect[],
        onePerMinion: false,
        abilities: [] as AbilitySummary[],
    }
    const finish = (window: PlayWindow, effects: Effect[]): PlaySummary => {
        const roles = new Set<Role>(
            deriveRoles(effects, {
                target: base.target ?? undefined,
                ownStealth: play.kind == 'action',
            }),
        )
        for (const role of deriveRoles(base.attached)) {
            roles.add(role)
        }
        if (play.kind == 'master') {
            roles.add('master')
        }
        for (const ability of base.abilities) {
            ability.roles.forEach(role => roles.add(role))
        }
        if (base.staysInPlay == 'onMinion') {
            roles.add('attachment')
        }
        return { ...base, window, effects, roles: ROLES.filter(role => roles.has(role)) }
    }

    switch (play.kind) {
        case 'action': {
            base.target = play.target
            base.staysInPlay = play.staysInPlay ?? 'discard'
            base.attachTo = play.attachTo ?? null
            base.attached = summarizeAttached(play.attached ?? [])
            base.onePerMinion = !!play.onePerMinion
            return finish('minionAction', summarizeActionEffects(play.effects))
        }
        case 'modifier': {
            base.x = play.x ?? null
            const window = hasCondition(conditions, 'during') ? 'ownBleed' : 'ownAction'
            return finish(window, summarizeModifierEffects(play.effects))
        }
        case 'combat':
            return finish('combat', summarizeCombatEffects(play.effects))
        case 'reaction': {
            const effects = summarizeReactionEffects(play.effects)
            return finish(reactionWindow(conditions, effects), effects)
        }
        case 'master': {
            base.staysInPlay = play.staysInPlay ?? 'discard'
            base.attachTo = play.attachTo ?? null
            base.attached = summarizeAttached(play.attached ?? [])
            base.onePerMinion = !!play.onePerMinion
            base.abilities = (play.abilities ?? []).map(summarizeAbility)
            return finish('masterPhase', summarizeMasterEffects(play.effects ?? [], play.onPlay))
        }
        default:
            return unreachable(play)
    }
}

const cardSummaries = new Map<KrcgId, CardSummary>()

// What the bot knows of a card from its id, or undefined when the cardbase does not know the card
export function summarizeCardId(id: KrcgId): CardSummary | undefined {
    const known = cardSummaries.get(id)
    if (known) {
        return known
    }
    const resource = gameResources.cardbase[id]
    if (!resource) {
        return undefined
    }
    const isCrypt = 'capacity' in resource
    const library = isCrypt ? undefined : (resource as LibraryCardResource)
    const def = getCardDefById(id)
    const plays = (def?.plays ?? []).map(summarizePlay)
    const cryptEffects = def?.crypt ? summarizeCrypt(def.crypt) : []
    const roles = new Set<Role>(deriveRoles(cryptEffects))
    for (const play of plays) {
        play.roles.forEach(role => roles.add(role))
    }
    const summary: CardSummary = {
        id,
        name: resource.name,
        catalogued: !!def,
        isCrypt,
        type: library?.type ?? '',
        pool: library?.pool ?? 0,
        blood: library?.blood ?? 0,
        plays,
        cryptEffects,
        roles: ROLES.filter(role => roles.has(role)),
    }
    cardSummaries.set(id, summary)
    return summary
}

export function summarizeCard(card: Card): CardSummary | undefined {
    return card.krcgId ? summarizeCardId(card.krcgId) : undefined
}

// The capacity and disciplines of a crypt card: what a vampire can play ( crypt resource, no game needed )
export function getCryptDisciplines(id: KrcgId): Disciplines | undefined {
    const resource = gameResources.cardbase[id]
    return resource && 'capacity' in resource ?
            (resource as CryptCardResource).disciplines
        :   undefined
}

// The ways of the play a vampire with these disciplines can declare ( a way needs every use at its level )
export function waysUsableBy(
    ways: UsageOption[],
    disciplines: Partial<Disciplines>,
): UsageOption[] {
    return ways.filter(way => way.every(use => (disciplines[use.discipline] ?? 0) >= use.level))
}

function describeNumber(amount: number | 'X'): string {
    return (
        amount == 'X' ? 'X'
        : amount >= 0 ? `+${amount}`
        : String(amount)
    )
}

export function describeEffect(effect: Effect): string {
    const text = ((): string => {
        switch (effect.type) {
            case 'stealth':
                return `stealth ${describeNumber(effect.amount)}`
            case 'intercept':
                return `intercept ${describeNumber(effect.amount)}${effect.bleedsOnly ? ' against bleeds' : ''}`
            case 'bleedAction':
                return `bleed action ${effect.amount}`
            case 'bleedBonus':
                return `bleed ${describeNumber(effect.amount)}${effect.limited ? ' ( limited )' : ''}`
            case 'ownBleed':
                return `bleeds ${describeNumber(effect.amount)} more`
            case 'gainBlood':
                return `gain ${effect.amount} blood`
            case 'stealPool':
                return `steal ${effect.amount} pool`
            case 'enterCombat':
                return effect.targetActs ? 'enter combat, the target acts first' : 'enter combat'
            case 'lockTarget':
                return 'lock the target'
            case 'strengthIfBlocked':
                return `strength ${describeNumber(effect.amount)} if blocked`
            case 'bounce':
                return effect.lockReactor ? 'bounce, locks the reactor' : 'bounce'
            case 'wake':
                return 'wake'
            case 'unlockReactor':
                return 'unlock the reactor'
            case 'unlockAndBlock':
                return `unlock and block, intercept ${describeNumber(effect.intercept)}`
            case 'blockManeuver':
                return 'maneuver in the block combat'
            case 'maneuver':
                return effect.toCloseOnly ? 'maneuver to close' : 'maneuver'
            case 'dodge':
                return 'dodge'
            case 'handStrike':
                return `hand strike, damage = strength ${describeNumber(effect.extraDamage)}${effect.undodgeable ? ', undodgeable' : ''}`
            case 'weaponStrike':
                return `weapon strike ${effect.damage}${effect.ranged ? 'R' : ''}${effect.aggravated ? ' aggravated' : ''}${effect.maneuver ? ', maneuver' : ''}`
            case 'setStrength':
                return `strength ${effect.amount} for the combat`
            case 'additionalStrike':
                return `additional strike${effect.limited ? ' ( limited )' : ''}`
            case 'grapple':
                return `grapple${effect.press ? ', press' : ''}${effect.closeNextRound ? ', close next round' : ''}`
            case 'gainBloodFromDamage':
                return 'gain the blood the opponent lost'
            case 'environmentalDamage':
                return `${effect.amount} damage each round`
            case 'strength':
                return `strength ${describeNumber(effect.amount)}`
            case 'life':
                return `${effect.amount} life`
            case 'preventDamage':
                return `prevent ${effect.amount} damage`
            case 'moveBlood':
                return `move ${effect.amount} blood ( ${effect.phase} phase )`
            case 'restrictPlay':
                return `cannot play ${effect.names.join(', ')}`
            case 'burnsInTorpor':
                return 'burned in torpor'
            case 'handSize':
                return `hand size ${describeNumber(effect.amount)}`
            case 'discardFromHand':
                return 'discard a card of the hand'
            case 'drawCrypt':
                return 'draw a crypt card'
            case 'burnSelf':
                return 'burn this card'
            case 'gainPool':
                return `gain ${effect.amount} pool`
            case 'lockFailedBlocker':
                return 'lock the minion that failed to block'
            case 'unlockSelf':
                return 'unlock this minion'
            case 'trigger':
                return `${effect.armed ? 'armed: ' : ''}on ${effect.on}${effect.optional ? ' ( optional' : ' ( automatic'}${effect.costBlood ? `, burn ${effect.costBlood} blood` : ''}${effect.oncePerTurn ? ', once per turn' : ''} ): ${effect.effects.map(describeEffect).join(', ')}`
            case 'undirectedStealth':
                return `stealth ${describeNumber(effect.amount)} on undirected actions`
            case 'directedIntercept':
                return `intercept ${describeNumber(effect.amount)} against directed actions`
            case 'canEnterCombat':
                return 'can enter combat as an action'
            case 'mustBleedWhileMinionLocked':
                return 'must bleed while a minion is locked'
            default:
                return unreachable(effect)
        }
    })()
    return effect.when?.length ?
            `${text} ( if ${effect.when.map(describeCondition).join(', ')} )`
        :   text
}

// The type of the condition, then its values: 'reactorTitled true', 'targetPoolAtMost 9'
export function describeCondition(condition: Condition): string {
    const { type, ...values } = condition
    return [type, ...Object.values(values)].join(' ')
}

export function describePlay(play: PlaySummary): string {
    const ways = play.ways.map(way =>
        way.length == 0 ?
            'no discipline'
        :   way.map(use => `${use.discipline}${use.level == 2 ? ' sup' : ' inf'}`).join(' + '),
    )
    const parts = [
        `${play.kind} [${ways.join(' | ')}] in ${play.window}${play.conditions.length ? ` when ${play.conditions.map(describeCondition).join(', ')}` : ''}${play.x ? `, X from ${play.x.min} to ${play.x.max}` : ''}`,
        ...(play.effects.length ? [play.effects.map(describeEffect).join('; ')] : []),
        ...(play.attached.length ?
            [`attached: ${play.attached.map(describeEffect).join('; ')}`]
        :   []),
        ...play.abilities.map(
            ability =>
                `ability ${ability.activate} ( ${ability.windows.join('/')}${ability.locks ? ', locks' : ''}${ability.transfers ? `, ${ability.transfers} transfers` : ''} ): ${ability.effects.map(describeEffect).join('; ')}`,
        ),
    ]
    return `${parts.join(' - ')} => ${play.roles.join(', ') || 'no role'}`
}
