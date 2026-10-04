import { useGameStateStore } from '@/client/store/gameState.ts'
import { isBotQueueIdle } from '@/client/bot/mutationQueue.ts'
import * as logging from '@/client/logging.ts'
import { BOT_PAUSE_TIME } from '@/shared/const/bot.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { getDecidingPlayer } from '@/shared/bot/referee.ts'
import { BotAgent } from '@/shared/bot/types.ts'
import { PlayerOid } from '@/shared/types/model.ts'

/**
 * Client adapter that lets an agent play a bot player in a TrainBot game.
 *
 * It holds no game state: it wakes up when the game state may have changed,
 * and the referee works out from the state alone whether the bot has a decision
 * to make. All it adds is pacing, so the human can follow what the bot does.
 */
export class BotRunner {
    private scheduled = false

    constructor(
        private playerOid: PlayerOid,
        private agent: BotAgent,
    ) {}

    // Called whenever the game state may have changed ( see mutationQueue.ts )
    runDecisionMaking() {
        const gameState = useGameStateStore()
        if (this.scheduled || getDecidingPlayer(gameState)?.oid !== this.playerOid) {
            return
        }

        this.scheduled = true
        setTimeout(() => {
            this.scheduled = false
            this.decide()
        }, BOT_PAUSE_TIME)
    }

    private decide() {
        // The mutations of the previous decision are not all applied yet : deciding
        // now would read stale state. The queue wakes us up again once it drains.
        if (!isBotQueueIdle()) {
            return
        }

        const player = useGameStateStore().players[this.playerOid]
        try {
            stepBot(player, this.agent)
        } catch (error) {
            logging.captureException(error)
        }
    }
}
