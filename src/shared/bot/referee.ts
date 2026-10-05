import { LibraryCard, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import {
    LEAVE_TORPOR_COST,
    LibraryCardType,
    TurnPhase,
    TurnSequence,
} from '@/shared/const/model.ts'
import { GRID_SIZE } from '@/shared/const/game.ts'
import {
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
    createHuntAction,
    createLeaveTorporAction,
    createRescueFromTorporAction,
} from '@/shared/state/minionActionFactories.ts'
import { payCardCosts } from '@/shared/state/cardCosts.ts'
import {
    canChangeTarget,
    getBlockingDecision,
    getBlockingMinion,
} from '@/shared/state/actionState.ts'
import { getAutoPlayPosition, getPlayRegion } from '@/shared/state/cardPlacement.ts'
import {
    canChooseStrike,
    canManeuver,
    canPress,
    canPreventDamage,
    createHandStrike,
} from '@/shared/state/combatState.ts'
import {
    getActionCardOptions,
    getActionModifierOptions,
    getCombatCardOptions,
    getReactionCardOptions,
    hasPlayedModifierThisAction,
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
    if (gameState.combat) {
        return gameState.combat.impulsePlayer
    }
    if (gameState.action) {
        const impulsePlayer = gameState.action.impulsePlayer
        return impulsePlayer.isOusted ? null : impulsePlayer
    }
    return gameState.activePlayer ?? null
}

/**
 * Decision points
 */

export function getDecisionPoint(gameState: GameState, player: Player): DecisionPoint | null {
    if (getDecidingPlayer(gameState) !== player) {
        return null
    }

    if (gameState.combat) {
        return combatDecision(gameState, gameState.combat, player)
    }

    if (gameState.action) {
        return player == gameState.activePlayer ?
                actionImpulseDecision(gameState, player)
            :   reactionImpulseDecision(gameState, player)
    }

    const cleanupCards = getCleanupCards(player)
    if (cleanupCards.length > 0) {
        return decision(DecisionKind.Cleanup, player, [{ type: 'cleanup', cards: cleanupCards }])
    }

    switch (gameState.turnPhase) {
        case TurnPhase.Unlock:
            return decision(DecisionKind.Unlock, player, unlockPhaseOptions(gameState))
        case TurnPhase.Master:
            return decision(DecisionKind.Master, player, [{ type: 'endPhase' }])
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

function getCleanupCards(player: Player): LibraryCard[] {
    return player.ready.cards.filter(
        (card): card is LibraryCard =>
            card instanceof LibraryCard && !!card.type && ONE_SHOT_TYPES.includes(card.type),
    )
}

// "Unlock as normal" is mandatory and must come first. It cannot be derived from
// the cards (a locked card may be one that does not unlock as normal, e.g. a
// stunned minion), so GameState records that it was done this turn.
function unlockPhaseOptions(gameState: GameState): BotOption[] {
    if (!gameState.turnResources.unlocked) {
        return [{ type: 'unlockAll' }]
    }
    // Once unlocked, the player may use unlock-phase effects. None is supported
    // yet: they will be offered here, before the way out.
    return [{ type: 'endPhase' }]
}

function minionPhaseOptions(player: Player): BotOption[] {
    const candidates: MinionAction[] = []
    const prey = player.prey
    const torpid = player.vampiresInTorpor

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

        // The LEAVE_TORPOR_COST blood of a rescue is shared between the two, any way they like
        for (const rescued of torpid) {
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
    const options: BotOption[] = candidates
        .filter(action => canDeclare(action).isValid)
        .map(action => ({ type: 'declareAction', action }))
    options.push({ type: 'endPhase' })
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

    options.push({ type: 'endPhase' })
    return options
}

function discardPhaseOptions(gameState: GameState, player: Player): BotOption[] {
    const options: BotOption[] = []

    if (gameState.turnResources.dpa > 0) {
        for (const card of player.hand.cards) {
            options.push({ type: 'discard', card })
        }
    }

    options.push({ type: 'endTurn' })
    return options
}

function actionImpulseDecision(gameState: GameState, player: Player): DecisionPoint {
    const options: BotOption[] = []

    if (gameState.action) {
        const actingMinion = gameState.action.minionAction.actingMinion
        for (const card of player.hand.cards) {
            if (hasPlayedModifierThisAction(player, card)) {
                continue
            }
            for (const modifier of getActionModifierOptions(actingMinion, card)) {
                options.push({ type: 'playModifier', modifier })
            }
        }
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
        for (const minion of player.minionsReadyUnlocked) {
            if (!attempted.includes(minion)) {
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
    // declined first), the engine checks the effect
    for (const minion of player.minionsReadyUnlocked) {
        for (const option of getReactionCardOptions(minion)) {
            if (isReactionOptionValid(gameState, option)) {
                options.push(option)
            }
        }
    }

    options.push({ type: 'noReaction' })
    return decision(DecisionKind.ReactionImpulse, player, options)
}

function isReactionOptionValid(gameState: GameState, option: BotOptionOf<'playReaction'>): boolean {
    switch (option.effect.type) {
        case 'changeTarget':
            return canChangeTarget(gameState, option.effect.target).isValid
    }
}

/**
 * Combat
 */

// Does a card option fit the current step? The engine tells.
function isCombatOptionValid(gameState: GameState, option: CombatCardOption): boolean {
    switch (option.type) {
        case 'combatStrike':
            return canChooseStrike(gameState, option.minion).isValid
        case 'combatManeuver':
            return canManeuver(gameState, option.minion, option.strike).isValid
        case 'combatPress':
            return canPress(gameState, option.minion).isValid
        case 'combatPrevent':
            return canPreventDamage(gameState, option.minion, option.amount, option.aggravated)
                .isValid
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

    for (const option of getCombatCardOptions(combatant.minion)) {
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

function drawReplacement(player: Player): void {
    if (!player.library.isEmpty) {
        check(gameMutations.drawLibrary.act(player, { player }), 'drawLibrary')
    }
}

function playCardFromHand(player: Player, card: LibraryCard, byMinion?: Minion): void {
    const toCardRegion = getPlayRegion(player)
    const { x, y } = getAutoPlayPosition(player, card, toCardRegion, byMinion)
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
    // This won't handle the "do not replace until..." card text
    drawReplacement(player)
}

function payCosts(minion: Minion, card: LibraryCard, x?: number): void {
    check(payCardCosts(minion, card, x), 'card cost')
}

// The combat card an option comes with is played before its effect is applied
function playCombatCard(player: Player, minion: Minion, card?: LibraryCard): void {
    if (card) {
        playCardFromHand(player, card, minion)
        payCosts(minion, card)
    }
}

// Cards a bot plays out of its own turn: they are played while someone else's action or
// combat is going on, so the owner's cleanup (own turn only) comes too late.
const OUT_OF_TURN_TYPES = [LibraryCardType.Combat, LibraryCardType.Reaction]

// Once the action and the combat are over, bots put away the combat and reaction cards
// played in them, whoever played them. Humans do it themselves.
function cleanupOutOfTurnCards(gameState: GameState, player: Player): void {
    if (gameState.combat || gameState.action) {
        return
    }
    for (const bot of gameState.orderedPlayers.filter(candidate => candidate.isBot)) {
        const cards = bot.ready.cards.filter(
            card =>
                card instanceof LibraryCard && !!card.type && OUT_OF_TURN_TYPES.includes(card.type),
        )
        for (const card of cards) {
            check(
                gameMutations.moveCardToRegion.act(player, {
                    card,
                    fromCardRegion: card.region,
                    toCardRegion: card.owner.ashHeap,
                    x: 0,
                    y: 0,
                }),
                'out of turn cards cleanup',
            )
        }
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
                        x: 12 * GRID_SIZE * player.ready.length,
                        y: 12 * GRID_SIZE,
                    }),
                    'move vampire to ready',
                )
            }
            break
        }

        case 'discard':
            check(gameMutations.discard.act(player, { card: option.card }), 'discard')
            drawReplacement(player)
            break

        case 'playModifier': {
            const { card, usage } = option.modifier
            const actingMinion = gameState.action?.minionAction.actingMinion
            if (!actingMinion) {
                throw new InvalidBotMove('No action in progress')
            }
            playCardFromHand(player, card, actingMinion)
            payCosts(actingMinion, card, usage.x)

            // The declaration only records the modifier (log, history); its
            // effect is applied by separate mutations so a replay won't apply
            // it twice. It keeps the impulse with the acting player.
            check(
                gameMutations.ACTION_declareActionModifier.act(player, {
                    actionModifier: option.modifier,
                }),
                'declare modifier',
            )
            applyActionModifier(option.modifier, actingMinion)
            break
        }

        case 'noModifier':
            check(
                gameMutations.ACTION_declareActionModifier.act(player, {
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
            // Playing a reaction is an effect: the acting player regains the impulse
            check(
                gameMutations.ACTION_declareReaction.act(player, { reaction: card }),
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
                        gameMutations.ACTION_changeTarget.act(player, { target: effect.target }),
                        'change target',
                    )
                    break
            }
            break
        }

        case 'noReaction':
            check(
                gameMutations.ACTION_declareReaction.act(player, { reaction: NO_REACTION }),
                'noReaction',
            )
            break

        case 'combatPass':
            check(gameMutations.COMBAT_pass.act(player, {}), 'combatPass')
            break

        case 'combatStrike':
            playCombatCard(player, option.minion, option.card)
            check(
                gameMutations.COMBAT_chooseStrike.act(player, {
                    minion: option.minion,
                    strike: option.strike,
                }),
                'combatStrike',
            )
            break

        case 'combatManeuver':
            playCombatCard(player, option.minion, option.card)
            check(
                gameMutations.COMBAT_maneuver.act(player, {
                    minion: option.minion,
                    strike: option.strike,
                }),
                'combatManeuver',
            )
            break

        case 'combatPress':
            playCombatCard(player, option.minion, option.card)
            check(gameMutations.COMBAT_press.act(player, { minion: option.minion }), 'combatPress')
            break

        case 'combatPrevent':
            playCombatCard(player, option.minion, option.card)
            check(
                gameMutations.COMBAT_preventDamage.act(player, {
                    minion: option.minion,
                    amount: option.amount,
                    aggravated: option.aggravated,
                }),
                'combatPrevent',
            )
            break
    }

    cleanupOutOfTurnCards(gameState, player)
}
