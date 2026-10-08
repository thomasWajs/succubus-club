import { GameState } from '@/shared/state/gameState.ts'
import { PlayerOid } from '@/shared/types/model.ts'
import { getPlayerLedger, TableLedger } from '@/shared/bot/utility/ledger.ts'
import { DecisionKind } from '@/shared/bot/types.ts'
import { BotStep } from '@/shared/bot/driver.ts'

/**
 * What happened to each seat of a headless game, to compare two brains on the same decks: the win
 * rate says who won, these say how (pool lost, blockers wasted, blocks, torpor).
 */

/**
 * How a Methuselah was ousted, from what its decisions offered during the action that did it. The
 * unlocked minions alone prove nothing: a minion may not block ( stealth, an effect that denies the
 * block ) or the ouster may come from something else than an action.
 * - declinedBlock: a block was offered and the bot did not attempt it: the wasted defender
 * - failedBlock: the bot attempted a block and was ousted anyway
 * - noBlockOffered: no block was ever offered ( bypassed, or nobody to block )
 * - outOfAction: ousted outside of an action
 */
export type OusterKind = 'declinedBlock' | 'failedBlock' | 'noBlockOffered' | 'outOfAction'

export type Ouster = {
    kind: OusterKind
    // Unlocked ready minions at that moment
    unlocked: number
}

export type SeatDiagnostics = {
    name: string
    won: boolean
    poolLostToBleeds: number
    // Null if not ousted
    ouster: Ouster | null
    blocksAttempted: number
    blocksSucceeded: number
    blocksFailed: number
    blocksWithdrawn: number
    blocksDeclined: number
    actionsBlocked: number
    bleedsDeclared: number
    bleedsLanded: number
    bouncesPlayed: number
    torporTaken: number
    // Torpor taken by the opponent of a combat the Methuselah was in
    torporInflicted: number
}

type Snapshot = {
    ousted: boolean
    unlocked: number
    torpor: number
}

export type GameDiagnostics = {
    turns: number
    seats: Record<PlayerOid, SeatDiagnostics>
}

export function createDiagnostics(gameState: GameState) {
    const seats: Record<PlayerOid, SeatDiagnostics> = {}
    for (const player of gameState.orderedPlayers) {
        seats[player.oid] = {
            name: player.name,
            won: false,
            poolLostToBleeds: 0,
            ouster: null,
            blocksAttempted: 0,
            blocksSucceeded: 0,
            blocksFailed: 0,
            blocksWithdrawn: 0,
            blocksDeclined: 0,
            actionsBlocked: 0,
            bleedsDeclared: 0,
            bleedsLanded: 0,
            bouncesPlayed: 0,
            torporTaken: 0,
            torporInflicted: 0,
        }
    }

    // What each player was offered during the action in progress: reset when a new action is declared
    let blockWindows: Record<PlayerOid, { offered: boolean; attempted: boolean }> = {}
    // The kinds of decision of the turn phases: an ouster there does not come from an action
    const phaseKinds = new Set([
        DecisionKind.Unlock,
        DecisionKind.Master,
        DecisionKind.Influence,
        DecisionKind.Discard,
        DecisionKind.Cleanup,
        DecisionKind.DiscardExcess,
    ])
    let before: Record<PlayerOid, Snapshot> = {}
    // The two controllers of the combat in progress, before the step
    let combatants: [PlayerOid, PlayerOid] | null = null

    return {
        // Call before each step: what the table looked like
        before() {
            before = Object.fromEntries(
                gameState.orderedPlayers.map(player => [
                    player.oid,
                    {
                        ousted: player.isOusted,
                        unlocked: player.minionsReadyUnlocked.length,
                        torpor: player.vampiresInTorpor.length,
                    },
                ]),
            )
            const combat = gameState.combat
            combatants =
                combat ?
                    [combat.acting.minion.controller.oid, combat.defending.minion.controller.oid]
                :   null
        },

        // Call after each step: what the step changed
        after(step: BotStep) {
            if (step.option.type == 'declareAction') {
                blockWindows = {}
            }
            const deciding = step.decision.player.oid
            const window = (blockWindows[deciding] ??= { offered: false, attempted: false })
            window.offered ||= step.decision.options.some(option => option.type == 'block')
            window.attempted ||= step.option.type == 'block'
            const outOfAction = phaseKinds.has(step.decision.kind)
            for (const player of gameState.orderedPlayers) {
                const previous = before[player.oid]
                const seat = seats[player.oid]
                if (!previous) {
                    continue
                }
                if (player.isOusted && !previous.ousted) {
                    const seen = blockWindows[player.oid]
                    seat.ouster = {
                        unlocked: previous.unlocked,
                        kind:
                            outOfAction ? 'outOfAction'
                            : seen?.attempted ? 'failedBlock'
                            : seen?.offered ? 'declinedBlock'
                            : 'noBlockOffered',
                    }
                }
                const entered = player.vampiresInTorpor.length - previous.torpor
                if (entered > 0) {
                    seat.torporTaken += entered
                    const opponent = combatants?.find(oid => oid != player.oid)
                    if (opponent) {
                        seats[opponent].torporInflicted += entered
                    }
                }
            }
        },

        finish(ledger: TableLedger, turns: number, winner: string | null): GameDiagnostics {
            for (const [oid, seat] of Object.entries(seats)) {
                const observed = getPlayerLedger(ledger, oid)
                seat.won = seat.name == winner
                seat.poolLostToBleeds = observed.poolLostToBleeds
                seat.blocksAttempted = observed.blocksAttempted
                seat.blocksSucceeded = observed.blocksSucceeded
                seat.blocksFailed = observed.blocksFailed
                seat.blocksWithdrawn = observed.blocksWithdrawn
                seat.blocksDeclined = observed.blocksDeclined
                seat.actionsBlocked = observed.actionsBlocked
                seat.bleedsDeclared = observed.bleedsDeclared
                seat.bleedsLanded = observed.bleedAmounts.length
                seat.bouncesPlayed = observed.bouncesPlayed
            }
            return { turns, seats }
        },
    }
}
