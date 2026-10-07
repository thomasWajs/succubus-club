import { GameState } from '@/shared/state/gameState.ts'
import { Player } from '@/shared/model/Player.ts'
import { LibraryCard } from '@/shared/model/Card.ts'
import { createMutation } from '@/shared/state/mutationBase.ts'
import { registerGameState, registerMutationTrigger, deleteGameState } from '@/shared/registries.ts'
import { setupPlayArea } from '@/shared/state/setup.ts'
import { generateGameId } from '@/shared/state/ids.ts'
import { ORDERED_PLAYER_COLORS } from '@/shared/const/game.ts'
import { BOT_NAME, BOT_PERM_ID } from '@/shared/const/bot.ts'
import { CombatStep, GameType, MinionActionType, NO_BLOCK } from '@/shared/types/state.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { PlayerOid } from '@/shared/types/model.ts'
import { shuffleArray } from '@/shared/utils.ts'
import { getDecidingPlayer } from '@/shared/bot/referee.ts'
import { BotStep, stepBot } from '@/shared/bot/driver.ts'
import { BotAgent, BotOption } from '@/shared/bot/types.ts'
import { ReactionCardEffect } from '@/shared/cardImpl/base.ts'
import { isRetainer } from '@/shared/cardImpl/catalog/attached.ts'

/**
 * Headless bot-vs-bot games, synchronous and without any UI or store.
 * Every failure (invalid move, stall, engine exception) is a hard failure.
 */

export class HarnessFailure extends Error {}

// Apply each mutation immediately, in order (the client queue is a UI concern)
export function registerSyncMutationTrigger(): void {
    registerMutationTrigger({
        act(gameMutationClass, author, params) {
            const mutation = createMutation(gameMutationClass, author, params)
            const validity = mutation.canApply()
            if (validity.isValid) {
                mutation.apply()
            }
            return validity
        },
        actSelf() {
            throw new Error('actSelf is not available in headless games')
        },
    })
}

// Like the browser, where the mutations of a bot are queued and applied later: act() only
// checks the validity and returns, the state changes when flush() runs the queue.
export function registerQueuedMutationTrigger(): { flush: () => void; queued: () => number } {
    const queue: (() => void)[] = []
    registerMutationTrigger({
        act(gameMutationClass, author, params) {
            const mutation = createMutation(gameMutationClass, author, params)
            const validity = mutation.canApply()
            if (validity.isValid) {
                queue.push(() => mutation.apply())
            }
            return validity
        },
        actSelf() {
            throw new Error('actSelf is not available in headless games')
        },
    })
    return {
        flush: () => queue.splice(0).forEach(apply => apply()),
        queued: () => queue.length,
    }
}

export function createHeadlessGame(decks: DeckList[]) {
    const gameState = new GameState()
    gameState.gameId = generateGameId()
    gameState.gameType = GameType.TrainBot
    registerGameState(gameState.gameId, gameState)

    const players = decks.map((deck, i) => {
        const player = gameState.createPlayer(
            `${BOT_NAME}${i + 1}`,
            ORDERED_PLAYER_COLORS[i],
            `${BOT_PERM_ID}${i + 1}`,
        )
        setupPlayArea(gameState, player, deck)
        return player
    })

    gameState.turnOrder = shuffleArray(gameState.turnOrder)
    gameState.setNewTurnResources()

    return { gameState, players }
}

const withCard = (card?: LibraryCard) => (card ? ` [${card.name}]` : '')

function describeReactionEffect(effect: ReactionCardEffect): string {
    switch (effect.type) {
        case 'changeTarget':
            return `changeTarget -> ${effect.target.name}`
        case 'intercept':
            return `intercept +${effect.amount}`
        case 'wake':
            return 'wake'
        case 'unlockBlock':
            return `unlockBlock ${effect.target.name} +${effect.intercept}`
        case 'unlock':
            return 'unlock'
    }
}

export function describeOption(option: BotOption): string {
    switch (option.type) {
        case 'declareAction': {
            const action = option.action
            const card =
                action.type == MinionActionType.ActionCardFromHand ? ` ${action.card.name}` : ''
            const target = action.target ? ` -> ${action.target.name}` : ''
            return `declareAction ${action.type}${card} (${action.actingMinion.name})${target}`
        }
        case 'influence':
            return `influence ${option.vampire.name} +${option.amount}`
        case 'unlockEffect':
            return `unlockEffect ${option.card.name} -> ${option.vampire.name}`
        case 'transferEffect':
            return `transferEffect ${option.card.name} #${option.ability}${option.removed ? ` removing ${option.removed.name}` : ''}`
        case 'moveBlood':
            return `moveBlood ${option.card.name} ${option.amount} ${option.toPool ? 'from' : 'to'} ${option.vampire.name}`
        case 'lockEffect':
            return `lockEffect ${option.card.name} -> discard ${option.discard.name}`
        case 'discardExcess':
            return `discardExcess ${option.card.name}`
        case 'useTrigger':
            return `useTrigger ${option.pending.source.name} #${option.pending.index}`
        case 'skipTrigger':
            return `skipTrigger ${option.pending.source.name} #${option.pending.index}`
        case 'discard':
            return `discard ${option.card.name}`
        case 'playMaster':
            return `playMaster ${option.card.name}${option.target ? ` on ${option.target.name}` : ''}`
        case 'playModifier':
            return `playModifier ${option.modifier.card.name}${option.modifier.usage.x !== undefined ? ` X=${option.modifier.usage.x}` : ''}${option.modifier.by ? ` by ${option.modifier.by.name}` : ''}`
        case 'block':
            return `block with ${option.minion.name}`
        case 'playReaction':
            return `playReaction ${option.card.name} (${option.minion.name}) ${describeReactionEffect(option.effect)}`
        case 'cleanup':
            return `cleanup ${option.cards.map(card => card.name).join(', ')}`
        case 'combatStrike':
            return `combatStrike ${option.minion.name}: ${option.strike.name}${option.additional ? ' + additional strike' : ''}${withCard(option.card)}`
        case 'combatManeuver':
            return `combatManeuver ${option.minion.name}${option.strike ? ` (${option.strike.name})` : ''}${withCard(option.card)}${option.weapon ? ` [${option.weapon.name}]` : ''}`
        case 'combatPress':
            return `combatPress ${option.minion.name}${option.granted ? ' (granted)' : ''}${withCard(option.card)}`
        case 'combatAdditionalStrike':
            return `combatAdditionalStrike ${option.minion.name}${option.limited ? ' (limited)' : ''}${withCard(option.card)}`
        case 'combatGrapple':
            return `combatGrapple ${option.minion.name}${withCard(option.card)}`
        case 'combatGainBlood':
            return `combatGainBlood ${option.minion.name} +${option.amount}${withCard(option.card)}`
        case 'combatStrengthBonus':
            return `combatStrengthBonus ${option.minion.name}`
        case 'combatStrength':
            return `combatStrength ${option.minion.name} = ${option.amount}${withCard(option.card)}`
        case 'combatPrevent':
            return `combatPrevent ${option.minion.name} ${option.amount}${option.aggravated ? ' aggravated' : ''}${withCard(option.card)}`
        default:
            return option.type
    }
}

function describeState(gameState: GameState): string {
    const action = gameState.action
    return [
        `turn ${gameState.turnNumber}`,
        `phase ${gameState.turnPhase}`,
        `active ${gameState.activePlayer?.name}`,
        action ?
            `action ${action.minionAction.type} (impulse ${action.impulsePlayer.name})`
        :   'no action',
        gameState.combat ?
            `combat round ${gameState.combat.round} step ${gameState.combat.step} (impulse ${gameState.combat.impulsePlayer.name})`
        :   '',
        gameState.referendum ? 'referendum in progress' : '',
    ]
        .filter(Boolean)
        .join(', ')
}

export type HarnessOptions = {
    maxTurns: number
    maxSteps: number
    onStep?: (step: BotStep) => void
}

export type GameReport = {
    outcome: 'win' | 'turnLimit'
    winner: string | null
    // Position of the winner in the turn order (0 = first player)
    winnerSeat: number | null
    turns: number
    steps: number
    decisionsByKind: Record<string, number>
    players: { name: string; pool: number; victoryPoints: number }[]
}

/**
 * Rules that only get interesting with 3+ players (who plays next once someone
 * is ousted, victory point accounting, one block at a time). Checked after every
 * step, any violation is a hard failure.
 */

type TurnTracker = { turnNumber: number; activeOid: PlayerOid | null }

// The player whose turn follows `oid`'s, skipping ousted players
function getNextCompetingPlayer(gameState: GameState, oid: PlayerOid): Player | null {
    const order = gameState.turnOrder
    const start = order.indexOf(oid)
    for (let i = 1; i <= order.length; i++) {
        const player = gameState.players[order[(start + i) % order.length]]
        if (!player.isOusted) {
            return player
        }
    }
    return null
}

// A combat only goes on while both combatants are ready, someone holds the impulse
// in the strike step only if they still have to choose, and no counter goes negative.
function checkCombat(gameState: GameState): void {
    const combat = gameState.combat
    if (combat) {
        const combatants = [combat.acting, combat.defending]
        if (!combat.isOver && combatants.some(combatant => !combatant.minion.isIn.ready)) {
            throw new HarnessFailure('A combatant is not ready but the combat goes on')
        }
        if (combat.step == CombatStep.Strike) {
            const striker = combatants.find(
                combatant => combatant.minion.controller == combat.impulsePlayer,
            )
            if (!striker || striker.strike) {
                throw new HarnessFailure('The impulse is on a minion that has nothing to choose')
            }
        }
    }

    for (const player of gameState.orderedPlayers) {
        for (const minion of [...player.ready.cards, ...player.torpor.cards]) {
            if (minion.blood < 0) {
                throw new HarnessFailure(`${minion.name} has ${minion.blood} blood`)
            }
        }
    }
}

// Never two copies of a unique library card in play
function checkUniqueCards(gameState: GameState): void {
    const seen = new Set<string>()
    for (const player of gameState.orderedPlayers) {
        for (const card of [...player.ready.cards, ...player.torpor.cards]) {
            if (card instanceof LibraryCard && card.isUnique && card.krcgId) {
                if (seen.has(card.krcgId)) {
                    throw new HarnessFailure(`Two copies of the unique card ${card.name} in play`)
                }
                seen.add(card.krcgId)
            }
        }
    }
}

// An attached card is in the region of its minion, under it, and a minion is never attached
function checkAttachments(gameState: GameState): void {
    for (const [attachedOid, hostOid] of Object.entries(gameState.attachments)) {
        const attached = gameState.cards[attachedOid]
        const host = gameState.cards[hostOid]
        if (!attached || !host?.isMinion()) {
            throw new HarnessFailure(`Attachment ${attachedOid} -> ${hostOid} has a missing card`)
        }
        if (attached.isMinion()) {
            throw new HarnessFailure(`The minion ${attached.name} is attached to ${host.name}`)
        }
        if (!host.isIn.controlled || attached.region.oid != host.region.oid) {
            throw new HarnessFailure(
                `${attached.name} is in ${attached.region.name}, ${host.name} in ${host.region.name}`,
            )
        }
        if (attached.position > host.position) {
            throw new HarnessFailure(`${attached.name} is drawn over ${host.name}`)
        }
        // A retainer with no life left is burned
        if (isRetainer(attached) && attached.blood <= 0) {
            throw new HarnessFailure(`The retainer ${attached.name} has no life but is in play`)
        }
    }
    for (const attachedOid of Object.keys(gameState.attachmentUsages)) {
        if (!gameState.attachments[attachedOid]) {
            throw new HarnessFailure(`Attachment usage of ${attachedOid}, which is not attached`)
        }
    }
}

function checkInvariants(gameState: GameState, tracker: TurnTracker): void {
    checkUniqueCards(gameState)
    checkAttachments(gameState)
    const players = gameState.orderedPlayers
    const nbOusted = players.filter(player => player.isOusted).length

    // Every oust gives its predator 1 VP, the last one 2
    const expectedVp = nbOusted + (nbOusted == players.length - 1 ? 1 : 0)
    const totalVp = players.reduce((total, player) => total + player.victoryPoints, 0)
    if (totalVp != expectedVp) {
        throw new HarnessFailure(
            `Victory points: ${totalVp} given, expected ${expectedVp} after ${nbOusted} oust(s)`,
        )
    }

    const nbStandingBlocks = (gameState.action?.blockingDecisions ?? []).filter(
        decision => decision.block !== NO_BLOCK && decision.block !== null,
    ).length
    if (nbStandingBlocks > 1) {
        throw new HarnessFailure(`${nbStandingBlocks} block attempts stand at the same time`)
    }

    checkCombat(gameState)

    if (gameState.competingPlayers.length <= 1) {
        return
    }
    const active = gameState.activePlayer
    if (!active || active.isOusted) {
        throw new HarnessFailure('The active player is missing or ousted')
    }
    if (tracker.activeOid && gameState.turnNumber != tracker.turnNumber) {
        const expected = getNextCompetingPlayer(gameState, tracker.activeOid)
        if (gameState.turnNumber != tracker.turnNumber + 1 || active != expected) {
            throw new HarnessFailure(
                `Wrong turn order: turn ${tracker.turnNumber} -> ${gameState.turnNumber}, ` +
                    `expected ${expected?.name} to play after the previous active player, got ${active.name}`,
            )
        }
    }
    tracker.turnNumber = gameState.turnNumber
    tracker.activeOid = active.oid
}

export function playHeadlessGame(
    gameState: GameState,
    agents: Map<PlayerOid, BotAgent>,
    options: HarnessOptions,
): GameReport {
    const decisionsByKind: Record<string, number> = {}
    let steps = 0
    const tracker: TurnTracker = {
        turnNumber: gameState.turnNumber,
        activeOid: gameState.activePlayer?.oid ?? null,
    }

    const winner = () =>
        gameState.competingPlayers.length == 1 ? gameState.competingPlayers[0] : null

    const report = (outcome: GameReport['outcome']): GameReport => ({
        outcome,
        winner: outcome == 'win' ? (winner()?.name ?? null) : null,
        winnerSeat:
            outcome == 'win' ? gameState.orderedPlayers.findIndex(p => p == winner()) : null,
        turns: gameState.turnNumber,
        steps,
        decisionsByKind,
        players: gameState.orderedPlayers.map((player: Player) => ({
            name: player.name,
            pool: player.pool,
            victoryPoints: player.victoryPoints,
        })),
    })

    try {
        for (;;) {
            if (gameState.competingPlayers.length <= 1) {
                return report('win')
            }
            if (gameState.turnNumber > options.maxTurns) {
                return report('turnLimit')
            }
            if (steps >= options.maxSteps) {
                throw new HarnessFailure(`Step limit reached (${options.maxSteps})`)
            }

            const player = getDecidingPlayer(gameState)
            if (!player) {
                throw new HarnessFailure('Stall: nobody has a decision to make')
            }
            const agent = agents.get(player.oid)
            if (!agent) {
                throw new HarnessFailure(`No agent for ${player.name}`)
            }

            const step = stepBot(player, agent)
            if (!step) {
                throw new HarnessFailure(`Stall: ${player.name} has no decision point`)
            }
            steps++
            decisionsByKind[step.decision.kind] = (decisionsByKind[step.decision.kind] ?? 0) + 1
            checkInvariants(gameState, tracker)
            options.onStep?.(step)
        }
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new HarnessFailure(`${reason} [${describeState(gameState)}] after ${steps} steps`, {
            cause: error,
        })
    } finally {
        deleteGameState(gameState.gameId)
    }
}
