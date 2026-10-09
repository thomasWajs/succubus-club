import { LibraryCard, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import {
    LEAVE_TORPOR_COST,
    LibraryCardType,
    TurnPhase,
    TurnSequence,
} from '@/shared/const/model.ts'
import {
    ActionProperty,
    CombatState,
    CombatStep,
    MinionAction,
    MinionActionType,
    NO_ACTION_MODIFIER,
    NO_BLOCK,
    NO_REACTION,
    Validity,
} from '@/shared/types/state.ts'
import { canDeclare, applyActionModifier } from '@/shared/state/minionActions.ts'
import {
    createBleedAction,
    createEnterCombatAction,
    createHuntAction,
    createLeaveTorporAction,
    createRescueFromTorporAction,
} from '@/shared/state/minionActionFactories.ts'
import { payCardCosts, payMasterCardCosts } from '@/shared/state/cardCosts.ts'
import {
    canChangeTarget,
    getBlockingDecision,
    getBlockingMinion,
    isAvailableToReact,
    isAwake,
} from '@/shared/state/actionState.ts'
import {
    getAutoPlayPosition,
    getInfluencedVampirePosition,
    getPermanentMasterPosition,
    getPlayRegion,
} from '@/shared/state/cardPlacement.ts'
import { isAttached } from '@/shared/state/attachments.ts'
import { canUseTrigger, getCardTriggers } from '@/shared/state/triggers.ts'
import {
    canChooseStrike,
    canManeuver,
    canPress,
    canAddStrikes,
    canGainBlood,
    canGrapple,
    canPreventDamage,
    canAddEnvironmentalDamage,
    canSetStrength,
    canTakeStrengthBonus,
    createHandStrike,
} from '@/shared/state/combatState.ts'
import {
    getCryptImplementation,
    getImplementation,
    getMasterImplementation,
    REACTION_CARD_IMPLEMENTATIONS,
} from '@/shared/cardImpl/index.ts'
import {
    getActionCardOptions,
    getActionModifierOptions,
    getAttachedCombatOptions,
    getCombatCardOptions,
    getLockEffectOptions,
    getLockForActionOptions,
    getMasterCardOptions,
    getMoveBloodOptions,
    getReactionCardOptions,
    getTransferEffectOptions,
    getUnlockEffectOptions,
    isMasterDiscardedAfterUse,
} from '@/shared/bot/cardOptions.ts'
import {
    BotOption,
    BotOptionOf,
    CombatCardOption,
    DecisionKind,
    DecisionPoint,
    InvalidBotMove,
} from '@/shared/bot/types.ts'

/**
 * The referee: a move generator, not a rules enforcer.
 *
 * It lists what a bot can do at a decision point, limited to what the supported
 * bot decks need, and it applies the automatic consequences of each option. A
 * rule it does not model is simply never offered. Human games are unaffected:
 * nothing here validates what a human does.
 *
 * Everything is synchronous and store-free: it reads the GameState and emits
 * mutations through the registered mutation trigger.
 */

// Cards that go to the ash heap once the action they were played in is over
const ONE_SHOT_TYPES = [
    LibraryCardType.Action,
    LibraryCardType.PoliticalAction,
    LibraryCardType.ActionModifier,
    LibraryCardType.Reaction,
    LibraryCardType.Combat,
]

// Cards that stay in play attached to a minion when the action that played them succeeds
const ATTACHABLE_TYPES = [LibraryCardType.Equipment, LibraryCardType.Retainer]

/**
 * Who has to decide
 */

// The player who has the decision right now, or null when nobody has one
// (game over, or a state the referee does not model: referendum).
export function getDecidingPlayer(gameState: GameState): Player | null {
    if (gameState.competingPlayers.length <= 1) {
        return null
    }
    if (gameState.referendum) {
        return null
    }
    // A bot above its hand size discards first, whatever is going on. Humans do it by hand.
    const excess = gameState.competingPlayers.find(player => hasExcessCards(player))
    if (excess) {
        return excess
    }
    // An optional trigger waits for its controller, before the action or the combat goes on
    const pending = gameState.pendingTriggers.find(trigger => !trigger.source.controller.isOusted)
    if (pending) {
        return pending.source.controller
    }
    if (gameState.combat) {
        return gameState.combat.impulsePlayer
    }
    // The window after a block, the action being still open: the blocker's controller decides
    if (gameState.action?.blockResolved) {
        const blocker = gameState.action.blockResolved.controller
        return blocker.isOusted ? null : blocker
    }
    if (gameState.action) {
        const impulsePlayer = gameState.action.impulsePlayer
        return impulsePlayer.isOusted ? null : impulsePlayer
    }
    // Once the action is over, a bot puts away the cards it played in it, even when it is not the
    // active player and even when a human ended the action: no bot decision would follow otherwise
    const cleaning = gameState.competingPlayers.find(
        player => player.isBot && getCleanupCards(gameState, player).length > 0,
    )
    return cleaning ?? gameState.activePlayer ?? null
}

function hasExcessCards(player: Player): boolean {
    return player.isBot && player.hand.length > player.handSize
}

/**
 * Decision points
 */

export function getDecisionPoint(gameState: GameState, player: Player): DecisionPoint | null {
    if (getDecidingPlayer(gameState) !== player) {
        return null
    }

    if (hasExcessCards(player)) {
        return decision(
            DecisionKind.DiscardExcess,
            player,
            player.hand.cards.map(card => ({ type: 'discardExcess', card })),
        )
    }

    const pending = gameState.pendingTriggers.find(trigger => trigger.source.controller == player)
    if (pending) {
        return decision(DecisionKind.Trigger, player, [
            ...(canUseTrigger(gameState, pending.source, pending.index) ?
                [{ type: 'useTrigger' as const, pending }]
            :   []),
            { type: 'skipTrigger', pending },
        ])
    }

    if (gameState.combat) {
        return combatDecision(gameState, gameState.combat, player)
    }

    if (gameState.action?.blockResolved) {
        return postBlockDecision(gameState, gameState.action.blockResolved, player)
    }

    if (gameState.action) {
        return player == gameState.activePlayer ?
                actionImpulseDecision(gameState, player)
            :   reactionImpulseDecision(gameState, player)
    }

    const cleanupCards = getCleanupCards(gameState, player)
    if (cleanupCards.length > 0) {
        return decision(DecisionKind.Cleanup, player, [{ type: 'cleanup', cards: cleanupCards }])
    }

    switch (gameState.turnPhase) {
        case TurnPhase.Unlock:
            return decision(DecisionKind.Unlock, player, unlockPhaseOptions(gameState, player))
        case TurnPhase.Master:
            return decision(DecisionKind.Master, player, masterPhaseOptions(gameState, player))
        case TurnPhase.Minion:
            return decision(DecisionKind.Minion, player, minionPhaseOptions(player))
        case TurnPhase.Influence:
            return decision(
                DecisionKind.Influence,
                player,
                influencePhaseOptions(gameState, player),
            )
        case TurnPhase.Discard:
            return decision(DecisionKind.Discard, player, discardPhaseOptions(gameState, player))
    }
}

function decision(kind: DecisionKind, player: Player, options: BotOption[]): DecisionPoint {
    return { kind, player, options }
}

// Cards a bot plays out of its own turn, while someone else's action or combat is going on
const OUT_OF_TURN_TYPES = [LibraryCardType.Combat, LibraryCardType.Reaction]

// A card attached to a minion is kept, whatever its type ( an action card put on a vampire ).
// Out of its own turn a player only has the cards of the reactions and combats it took part in.
function getCleanupCards(gameState: GameState, player: Player): LibraryCard[] {
    const ownTurn = player == gameState.activePlayer
    return player.ready.cards.filter(
        (card): card is LibraryCard =>
            card instanceof LibraryCard &&
            !isAttached(card) &&
            (ownTurn ?
                ONE_SHOT_TYPES.some(type => card.hasType(type)) ||
                isMasterDiscardedAfterUse(card) ||
                isEquipmentOrRetainer(card)
            :   OUT_OF_TURN_TYPES.some(type => card.hasType(type))),
    )
}

// An equipment or a retainer is only kept when the action that played it succeeded ( attached )
function isEquipmentOrRetainer(card: LibraryCard): boolean {
    return ATTACHABLE_TYPES.some(type => card.hasType(type))
}

// A master card needs the master phase action of the turn, on top of its own cost
function masterPhaseOptions(gameState: GameState, player: Player): BotOption[] {
    const options: BotOption[] = gameState.turnResources.mpa > 0 ? getMasterCardOptions(player) : []
    options.push(...getLockEffectOptions(player), ...getMoveBloodOptions(player, 'master'), {
        type: 'endPhase',
    })
    return options
}

// "Unlock as normal" is mandatory and must come first. It cannot be derived from
// the cards (a locked card may be one that does not unlock as normal, e.g. a
// stunned minion), so GameState records that it was done this turn.
function unlockPhaseOptions(gameState: GameState, player: Player): BotOption[] {
    if (!gameState.turnResources.unlocked) {
        return [{ type: 'unlockAll' }]
    }
    // Once unlocked, the player may use the unlock-phase effects of the cards in play
    return [
        ...getUnlockEffectOptions(player),
        ...getMoveBloodOptions(player, 'unlock'),
        { type: 'endPhase' },
    ]
}

function minionPhaseOptions(player: Player): BotOption[] {
    const candidates: MinionAction[] = []
    const prey = player.prey
    const torpid = player.vampiresInTorpor
    // A rescue helps any Methuselah's vampire, not only mine: a table of helpers saves each other's vampires
    const rescuable = player.gameState.competingPlayers.flatMap(other => other.vampiresInTorpor)

    for (const minion of player.minionsReadyUnlocked) {
        if (minion.isVampire()) {
            candidates.push(createHuntAction(minion))
        }
        if (prey) {
            candidates.push(createBleedAction(minion, prey))
        }
        for (const card of player.hand.cards) {
            candidates.push(...getActionCardOptions(minion, card))
        }
        if (getCryptImplementation(minion)?.canEnterCombat) {
            for (const other of player.gameState.competingPlayers) {
                for (const target of other == player ? [] : other.minionsReady) {
                    candidates.push(createEnterCombatAction(minion, target))
                }
            }
        }

        // The LEAVE_TORPOR_COST blood of a rescue is shared between the two, any way they like
        for (const rescued of rescuable) {
            for (let fromRescuer = 0; fromRescuer <= LEAVE_TORPOR_COST; fromRescuer++) {
                candidates.push(
                    createRescueFromTorporAction(
                        minion,
                        rescued,
                        fromRescuer,
                        LEAVE_TORPOR_COST - fromRescuer,
                    ),
                )
            }
        }
    }

    for (const vampire of torpid) {
        candidates.push(createLeaveTorporAction(vampire))
    }

    // The engine's own validation decides what can be declared
    const valid = candidates.filter(action => canDeclare(action).isValid)

    // Rulebook: a ready unlocked vampire without blood MUST hunt, before any other action
    const mandatoryHunts = valid.filter(
        action => action.type == MinionActionType.Hunt && action.actingMinion.blood == 0,
    )
    // A vampire that must bleed while its Methuselah controls a locked minion ( Elen Kamjian ):
    // it has no other action, as long as a bleed is possible
    const mustBleed = (action: MinionAction) =>
        getCryptImplementation(action.actingMinion)?.mustBleedWhileMinionLocked &&
        player.minionsReady.some(minion => minion.isLocked)
    const mandatoryBleeds = valid.filter(
        action => action.type == MinionActionType.Bleed && mustBleed(action),
    )
    const mandatoryBleeders = new Set(mandatoryBleeds.map(action => action.actingMinion))
    const free = valid.filter(
        action =>
            !mandatoryBleeders.has(action.actingMinion) || action.type == MinionActionType.Bleed,
    )
    const declarable = mandatoryHunts.length > 0 ? mandatoryHunts : free

    const options: BotOption[] = declarable.map(action => ({ type: 'declareAction', action }))
    if (mandatoryHunts.length == 0 && mandatoryBleeds.length == 0) {
        options.push({ type: 'endPhase' })
    }
    return options
}

function influencePhaseOptions(gameState: GameState, player: Player): BotOption[] {
    const options: BotOption[] = []

    for (const vampire of player.vampiresInUncontrolled) {
        const maxAmount = Math.min(
            gameState.turnResources.transfers,
            vampire.minionAttrs.capacity - vampire.blood,
            player.pool,
        )
        for (let amount = 1; amount <= maxAmount; amount++) {
            options.push({ type: 'influence', vampire, amount })
        }
    }

    options.push(...getTransferEffectOptions(player), { type: 'endPhase' })
    return options
}

function discardPhaseOptions(gameState: GameState, player: Player): BotOption[] {
    const options: BotOption[] = []

    if (gameState.turnResources.dpa > 0) {
        for (const card of player.hand.cards) {
            options.push({ type: 'discard', card })
        }
    }

    options.push(...getLockEffectOptions(player), { type: 'endTurn' })
    return options
}

function actionImpulseDecision(gameState: GameState, player: Player): DecisionPoint {
    const options: BotOption[] = []

    if (gameState.action) {
        const actingMinion = gameState.action.minionAction.actingMinion
        for (const card of player.hand.cards) {
            for (const modifier of getActionModifierOptions(actingMinion, card)) {
                options.push({ type: 'playModifier', modifier })
            }
        }
        options.push(...getLockForActionOptions(player, actingMinion))
    }

    options.push({ type: 'noModifier' })
    return decision(DecisionKind.ActionImpulse, player, options)
}

function reactionImpulseDecision(gameState: GameState, player: Player): DecisionPoint {
    const options: BotOption[] = []

    // The impulse reaches a player only if they may react (target, prey or
    // predator), see passImpulse(). A player who already has a block attempt
    // standing can only pass.
    const standing = getBlockingDecision(gameState, player)

    // Only one block attempt stands at a time. With 3+ players the impulse
    // reaches the predator after the prey: while the prey's attempt stands, the
    // window is closed for everyone else (it reopens if the attempt fails).
    const blockStands = getBlockingMinion(gameState) !== null
    const windowClosed = blockStands && (!standing || standing.block === NO_BLOCK)

    if (!blockStands) {
        // A minion tries to block at most once per action (the rules allow
        // retrying, but it is pointless and would let a bot loop forever)
        const attempted = gameState.action?.blockAttempters ?? []
        for (const minion of player.minionsReady) {
            if (!attempted.includes(minion) && isAvailableToReact(gameState, minion)) {
                options.push({ type: 'block', minion })
            }
        }
    }

    // "No block" gives the impulse back to the acting player (who may then play
    // modifiers), unlike "no reaction" which passes it on. Pointless when
    // "no block" is already declared, or when the window is closed.
    if (!windowClosed && (!standing || standing.block !== NO_BLOCK)) {
        options.push({ type: 'noBlock' })
    }

    // Reaction cards: each card checks its own conditions (a bounce needs the block to be
    // declined first), the engine checks the effect. A locked minion is left to the cards that
    // work for it ( cardOptions.ts ).
    for (const minion of player.minionsReady) {
        for (const option of getReactionCardOptions(minion)) {
            if (isReactionOptionValid(gameState, option)) {
                options.push(option)
            }
        }
    }

    options.push({ type: 'noReaction' })
    return decision(DecisionKind.ReactionImpulse, player, options)
}

// After a block: only the blocker plays, with the cards made for this window ( each card checks it )
function postBlockDecision(gameState: GameState, blocker: Minion, player: Player): DecisionPoint {
    const options: BotOption[] = getReactionCardOptions(blocker).filter(option =>
        isReactionOptionValid(gameState, option),
    )
    options.push({ type: 'noReaction' })
    return decision(DecisionKind.PostBlock, player, options)
}

function isReactionOptionValid(gameState: GameState, option: BotOptionOf<'playReaction'>): boolean {
    switch (option.effect.type) {
        case 'changeTarget':
            return canChangeTarget(gameState, option.effect.target).isValid
        case 'intercept':
            return true
        case 'wake':
            return !isAwake(gameState, option.minion)
        case 'unlockBlock':
            return option.effect.target.isLocked
        case 'unlock':
            return option.minion.isLocked
    }
}

/**
 * Combat
 */

// Does a card option fit the current step? The engine tells.
function isCombatOptionValid(gameState: GameState, option: CombatCardOption): boolean {
    switch (option.type) {
        case 'combatStrike':
            return canChooseStrike(gameState, option.minion, option.strike, option.additional)
                .isValid
        case 'combatAdditionalStrike':
            return canAddStrikes(gameState, option.minion, { limited: option.limited }).isValid
        case 'combatGrapple':
            return canGrapple(gameState, option.minion).isValid
        case 'combatGainBlood':
            return canGainBlood(gameState, option.minion).isValid
        case 'combatStrengthBonus':
            return canTakeStrengthBonus(gameState, option.minion).isValid
        case 'combatManeuver':
            return canManeuver(gameState, option.minion, option.strike, option.weapon, option.free)
                .isValid
        case 'combatPress':
            return canPress(gameState, option.minion, option.granted).isValid
        case 'combatStrength':
            return canSetStrength(gameState, option.minion).isValid
        case 'combatEnvironmentalDamage':
            return canAddEnvironmentalDamage(gameState, option.minion).isValid
        case 'combatPrevent':
            return canPreventDamage(
                gameState,
                option.minion,
                option.amount,
                option.aggravated,
                option.source,
            ).isValid
    }
}

function combatDecision(gameState: GameState, combat: CombatState, player: Player): DecisionPoint {
    const combatant = [combat.acting, combat.defending].find(
        candidate => candidate.minion.controller == player,
    )
    if (!combatant) {
        throw new InvalidBotMove(`${player.name} has the combat impulse but no minion in it`)
    }

    const options: BotOption[] = []

    // Everyone can strike with their hands. Offered even at long range, where it
    // is the way to strike at nothing.
    if (combat.step == CombatStep.Strike) {
        options.push({
            type: 'combatStrike',
            minion: combatant.minion,
            strike: createHandStrike(combatant),
        })
    }

    // What earlier plays of the round gave: a press, a strength bonus
    const given: CombatCardOption[] = [
        { type: 'combatPress', minion: combatant.minion, granted: true },
        { type: 'combatStrengthBonus', minion: combatant.minion },
    ]
    for (const option of [
        ...given,
        ...getCombatCardOptions(combatant.minion),
        ...getAttachedCombatOptions(combatant.minion),
    ]) {
        if (isCombatOptionValid(gameState, option)) {
            options.push(option)
        }
    }

    // The strike step is the only one where something has to be chosen
    if (combat.step != CombatStep.Strike) {
        options.push({ type: 'combatPass' })
    }
    return decision(DecisionKind.Combat, player, options)
}

/**
 * Applying an option
 */

function check(validity: Validity, what: string): void {
    if (!validity.isValid) {
        throw new InvalidBotMove(`${what}: ${validity.reason}`)
    }
}

// The hand is always kept full: a player draws back up to their hand size. The number of draws
// is computed once: in the browser the mutations of a bot are queued, so the hand does not
// grow while this runs ( looping on the hand length would never end ).
function drawToHandSize(player: Player): void {
    const missing = Math.min(player.handSize - player.hand.length, player.library.length)
    for (let i = 0; i < missing; i++) {
        check(gameMutations.drawLibrary.act(player, { player }), 'drawLibrary')
    }
}

function playCardFromHand(player: Player, card: LibraryCard, byMinion?: Minion): void {
    const toCardRegion = getPlayRegion(player)
    const staysInPlay =
        card.type == LibraryCardType.Master &&
        getMasterImplementation(card, player)?.staysInPlay === true
    const { x, y } =
        staysInPlay ?
            getPermanentMasterPosition(player, card, toCardRegion)
        :   getAutoPlayPosition(player, card, toCardRegion, byMinion)
    check(
        gameMutations.moveCardToRegion.act(player, {
            card,
            fromCardRegion: card.region,
            toCardRegion,
            x,
            y,
            byMinion,
        }),
        'play card',
    )
}

function payCosts(minion: Minion, card: LibraryCard, x?: number): void {
    check(payCardCosts(minion, card, x), 'card cost')
}

// The combat card an option comes with is played before its effect is applied
function playCombatCard(player: Player, minion: Minion, card?: LibraryCard): void {
    if (card) {
        playCardFromHand(player, card, minion)
        payCosts(minion, card)
        check(botMutations.COMBAT_markPlayed.act(player, { minion, card }), 'remember the play')
    }
}

function goToNextPhase(gameState: GameState, player: Player): void {
    check(
        gameMutations.goToTurnPhase.act(player, { index: gameState.turnPhaseIndex + 1 }),
        'goToTurnPhase',
    )
}

export function applyOption(decisionPoint: DecisionPoint, option: BotOption): void {
    if (!decisionPoint.options.includes(option)) {
        throw new InvalidBotMove(`Option '${option.type}' is not offered at ${decisionPoint.kind}`)
    }

    const player = decisionPoint.player
    const gameState = player.gameState

    switch (option.type) {
        case 'unlockAll':
            check(gameMutations.unlockAll.act(player, { player }), 'unlockAll')
            break

        case 'unlockEffect': {
            const implementation = getMasterImplementation(option.card, player)
            if (!implementation) {
                throw new InvalidBotMove(`${option.card.name} has no unlock effect`)
            }
            check(botMutations.markCardUsed.act(player, { player, card: option.card }), 'use card')
            check(implementation.applyUnlockEffect(option.vampire), 'unlock effect')
            break
        }

        case 'transferEffect': {
            const implementation = getMasterImplementation(option.card, player)
            if (!implementation) {
                throw new InvalidBotMove(`${option.card.name} has no ability paid with transfers`)
            }
            check(
                implementation.applyTransferEffect(option.ability, option.removed),
                'transfer effect',
            )
            break
        }

        case 'moveBlood': {
            const { card, vampire, amount, toPool } = option
            const sign = toPool ? 1 : -1
            check(botMutations.markCardUsed.act(player, { player, card }), 'use card')
            check(
                gameMutations.changeBlood.act(player, { card: vampire, amount: -sign * amount }),
                'blood of the vampire',
            )
            check(gameMutations.changePool.act(player, { player, amount: sign * amount }), 'pool')
            break
        }

        case 'lockEffect': {
            const implementation = getMasterImplementation(option.card, player)
            if (!implementation) {
                throw new InvalidBotMove(`${option.card.name} has no lock ability`)
            }
            check(implementation.applyLockEffect(option.discard), 'lock effect')
            break
        }

        case 'lockForAction': {
            const actingMinion = gameState.action?.minionAction.actingMinion
            const implementation = getMasterImplementation(option.card, player)
            if (!actingMinion || !implementation) {
                throw new InvalidBotMove(`${option.card.name} cannot be locked for an action`)
            }
            check(
                botMutations.ACTION_declareLockForAction.act(player, { card: option.card }),
                'declare lock for action',
            )
            check(implementation.applyLockForAction(actingMinion), 'lock for action')
            break
        }

        case 'endPhase':
            if (gameState.turnPhaseIndex >= TurnSequence.length - 1) {
                throw new InvalidBotMove('Cannot end the last phase, end the turn instead')
            }
            goToNextPhase(gameState, player)
            break

        case 'endTurn':
            check(
                gameMutations.goToTurn.act(player, { index: gameState.turnNumber + 1 }),
                'goToTurn',
            )
            break

        case 'cleanup':
            for (const card of option.cards) {
                check(
                    gameMutations.moveCardToRegion.act(player, {
                        card,
                        fromCardRegion: card.region,
                        toCardRegion: card.owner.ashHeap,
                        x: 0,
                        y: 0,
                    }),
                    'cleanup',
                )
            }
            break

        case 'declareAction': {
            const action = option.action
            check(
                gameMutations.ACTION_declareAction.act(player, { minionAction: action }),
                'declare',
            )
            if (action.target) {
                check(
                    gameMutations.UI_addTargetDeclaration.act(player, {
                        origin:
                            action.type == MinionActionType.ActionCardFromHand ?
                                action.card
                            :   action.actingMinion,
                        target: action.target,
                    }),
                    'target declaration',
                )
            }
            if (action.type == MinionActionType.ActionCardFromHand) {
                playCardFromHand(player, action.card, action.actingMinion)
            }
            break
        }

        case 'influence': {
            const { vampire, amount } = option
            const reachesCapacity = vampire.blood + amount >= vampire.minionAttrs.capacity
            check(gameMutations.influence.act(player, { card: vampire, amount }), 'influence')
            if (reachesCapacity) {
                check(
                    gameMutations.moveCardToRegion.act(player, {
                        card: vampire,
                        fromCardRegion: player.uncontrolled,
                        toCardRegion: player.ready,
                        ...getInfluencedVampirePosition(player.ready, vampire),
                    }),
                    'move vampire to ready',
                )
            }
            break
        }

        case 'discard':
            check(gameMutations.discard.act(player, { card: option.card }), 'discard')
            break

        case 'discardExcess':
            check(
                gameMutations.moveCardToRegion.act(player, {
                    card: option.card,
                    fromCardRegion: option.card.region,
                    toCardRegion: player.ashHeap,
                    x: 0,
                    y: 0,
                }),
                'discard excess',
            )
            break

        case 'useTrigger': {
            const { source, index } = option.pending
            const trigger = getCardTriggers(source)[index]
            if (!trigger) {
                throw new InvalidBotMove(`${source.name} has no trigger #${index}`)
            }
            if (trigger.cost) {
                check(
                    gameMutations.changeBlood.act(player, {
                        card: source,
                        amount: -trigger.cost.amount,
                    }),
                    'trigger cost',
                )
            }
            for (const effect of trigger.effects) {
                if (effect.type != 'unlock') {
                    throw new InvalidBotMove(`The ${effect.type} effect is not for a card in play`)
                }
                check(
                    gameMutations.setLock.act(player, { card: source, newValue: false }),
                    'unlock',
                )
            }
            check(
                botMutations.resolvePendingTrigger.act(player, {
                    player,
                    source,
                    index,
                    used: true,
                }),
                'resolve trigger',
            )
            break
        }

        case 'skipTrigger':
            check(
                botMutations.resolvePendingTrigger.act(player, {
                    player,
                    source: option.pending.source,
                    index: option.pending.index,
                    used: false,
                }),
                'skip trigger',
            )
            break

        case 'playMaster':
            playCardFromHand(player, option.card)
            check(payMasterCardCosts(player, option.card), 'card cost')
            check(
                botMutations.spendMasterPhaseAction.act(player, { player }),
                'master phase action',
            )
            if (option.target) {
                const implementation = getMasterImplementation(option.card, player)
                if (!implementation) {
                    throw new InvalidBotMove(`${option.card.name} has no implementation`)
                }
                check(implementation.applyPlayEffect(option.target), 'effect on play')
            }
            break

        case 'playModifier': {
            const { card, usage } = option.modifier
            const actingMinion = gameState.action?.minionAction.actingMinion
            if (!actingMinion) {
                throw new InvalidBotMove('No action in progress')
            }
            const playingMinion = option.modifier.by ?? actingMinion
            playCardFromHand(player, card, playingMinion)
            payCosts(playingMinion, card, usage.x)

            // The declaration only records the modifier (log, history); its
            // effect is applied by separate mutations so a replay won't apply
            // it twice. It keeps the impulse with the acting player.
            check(
                botMutations.ACTION_declareActionModifier.act(player, {
                    actionModifier: option.modifier,
                }),
                'declare modifier',
            )
            applyActionModifier(option.modifier, actingMinion)
            break
        }

        case 'noModifier':
            check(
                botMutations.ACTION_declareActionModifier.act(player, {
                    actionModifier: NO_ACTION_MODIFIER,
                }),
                'noModifier',
            )
            break

        case 'block':
            check(gameMutations.ACTION_declareBlock.act(player, { block: option.minion }), 'block')
            break

        case 'noBlock':
            check(gameMutations.ACTION_declareBlock.act(player, { block: NO_BLOCK }), 'noBlock')
            break

        case 'playReaction': {
            const { minion, card, effect } = option
            playCardFromHand(player, card, minion)
            payCosts(minion, card)
            check(
                botMutations.ACTION_declareReaction.act(player, { reaction: card, minion }),
                'declare reaction',
            )
            switch (effect.type) {
                case 'changeTarget':
                    if (effect.lockMinion) {
                        check(
                            gameMutations.setLock.act(player, { card: minion, newValue: true }),
                            'lock reacting minion',
                        )
                    }
                    check(
                        botMutations.ACTION_changeTarget.act(player, { target: effect.target }),
                        'change target',
                    )
                    break
                case 'intercept':
                    check(
                        gameMutations.ACTION_changeProperty.act(player, {
                            propertyName: ActionProperty.Intercept,
                            amount: effect.amount,
                        }),
                        'intercept',
                    )
                    break
                case 'wake':
                    check(botMutations.ACTION_wake.act(player, { minion }), 'wake')
                    break
                case 'unlock':
                    check(
                        gameMutations.setLock.act(player, { card: minion, newValue: false }),
                        'unlock the reacting minion',
                    )
                    break
                case 'unlockBlock':
                    check(
                        gameMutations.setLock.act(player, {
                            card: effect.target,
                            newValue: false,
                        }),
                        'unlock the blocker',
                    )
                    check(
                        gameMutations.ACTION_declareBlock.act(player, { block: effect.target }),
                        'block attempt',
                    )
                    check(
                        gameMutations.ACTION_changeProperty.act(player, {
                            propertyName: ActionProperty.Intercept,
                            amount: effect.intercept,
                        }),
                        'intercept',
                    )
                    break
            }
            if (effect.blockManeuver) {
                check(
                    botMutations.ACTION_grantBlockManeuver.act(player, { minion }),
                    'maneuver if it blocks',
                )
            }
            if (
                getImplementation(REACTION_CARD_IMPLEMENTATIONS, card, minion, option.usage)
                    ?.oncePerUnlock
            ) {
                check(
                    botMutations.markPlayedSinceUnlock.act(player, { minion, card }),
                    'remember the play',
                )
            }
            break
        }

        case 'noReaction':
            check(
                decisionPoint.kind == DecisionKind.PostBlock ?
                    botMutations.ACTION_closePostBlock.act(player, {})
                :   botMutations.ACTION_declareReaction.act(player, { reaction: NO_REACTION }),
                'noReaction',
            )
            break

        case 'combatPass':
            check(botMutations.COMBAT_pass.act(player, {}), 'combatPass')
            break

        case 'combatStrike':
            playCombatCard(player, option.minion, option.card)
            check(
                botMutations.COMBAT_chooseStrike.act(player, {
                    minion: option.minion,
                    strike: option.strike,
                    additional: option.additional,
                }),
                'combatStrike',
            )
            break

        case 'combatManeuver':
            playCombatCard(player, option.minion, option.card)
            check(
                botMutations.COMBAT_maneuver.act(player, {
                    minion: option.minion,
                    strike: option.strike,
                    weapon: option.weapon,
                    free: option.free,
                }),
                'combatManeuver',
            )
            break

        case 'combatPress':
            playCombatCard(player, option.minion, option.card)
            check(
                botMutations.COMBAT_press.act(player, {
                    minion: option.minion,
                    granted: option.granted,
                }),
                'combatPress',
            )
            break

        case 'combatAdditionalStrike':
            playCombatCard(player, option.minion, option.card)
            check(
                botMutations.COMBAT_addStrikes.act(player, {
                    minion: option.minion,
                    gain: { limited: option.limited },
                }),
                'combatAdditionalStrike',
            )
            break

        case 'combatGrapple':
            playCombatCard(player, option.minion, option.card)
            check(
                botMutations.COMBAT_grapple.act(player, {
                    minion: option.minion,
                    press: option.press,
                    closeNextRound: option.closeNextRound,
                }),
                'combatGrapple',
            )
            break

        case 'combatGainBlood':
            playCombatCard(player, option.minion, option.card)
            check(
                botMutations.COMBAT_gainBlood.act(player, {
                    minion: option.minion,
                    amount: option.amount,
                }),
                'combatGainBlood',
            )
            break

        case 'combatStrengthBonus':
            check(
                botMutations.COMBAT_takeStrengthBonus.act(player, { minion: option.minion }),
                'combatStrengthBonus',
            )
            break

        case 'combatStrength':
            playCombatCard(player, option.minion, option.card)
            check(
                botMutations.COMBAT_setStrength.act(player, {
                    minion: option.minion,
                    strength: option.amount,
                }),
                'combatStrength',
            )
            break

        case 'combatEnvironmentalDamage':
            playCombatCard(player, option.minion, option.card)
            check(
                botMutations.COMBAT_addEnvironmentalDamage.act(player, {
                    minion: option.minion,
                    amount: option.amount,
                }),
                'combatEnvironmentalDamage',
            )
            break

        case 'combatPrevent':
            playCombatCard(player, option.minion, option.card)
            check(
                botMutations.COMBAT_preventDamage.act(player, {
                    minion: option.minion,
                    amount: option.amount,
                    aggravated: option.aggravated,
                    source: option.source,
                }),
                'combatPrevent',
            )
            break
    }

    // The hand is always kept full. The hand size depends on the cards in play: it may have
    // grown during the option ( a location played, a vampire out of torpor ).
    drawToHandSize(player)
}
