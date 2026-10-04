import { GameState } from '@/shared/state/gameState.ts'
import { Player } from '@/shared/model/Player.ts'
import { createMutation } from '@/shared/state/gameMutations.ts'
import { registerGameState, registerMutationTrigger, deleteGameState } from '@/shared/registries.ts'
import { setupPlayArea } from '@/shared/state/setup.ts'
import { generateGameId } from '@/shared/state/ids.ts'
import { ORDERED_PLAYER_COLORS } from '@/shared/const/game.ts'
import { BOT_NAME, BOT_PERM_ID } from '@/shared/const/bot.ts'
import { GameType, MinionActionType, NO_BLOCK } from '@/shared/types/state.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { PlayerOid } from '@/shared/types/model.ts'
import { shuffleArray } from '@/shared/utils.ts'
import { getDecidingPlayer } from '@/shared/bot/referee.ts'
import { BotStep, stepBot } from '@/shared/bot/driver.ts'
import { BotAgent, BotOption } from '@/shared/bot/types.ts'

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
        case 'discard':
            return `discard ${option.card.name}`
        case 'playModifier':
            return `playModifier ${option.modifier.card.name}`
        case 'block':
            return `block with ${option.minion.name}`
        case 'cleanup':
            return `cleanup ${option.cards.map(card => card.name).join(', ')}`
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
        gameState.combat ? 'combat in progress' : '',
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

function checkInvariants(gameState: GameState, tracker: TurnTracker): void {
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
