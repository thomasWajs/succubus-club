import { applyMutationIfValid, AnyGameMutation } from '@/state/gameMutations.ts'
import { BOT_PAUSE_TIME } from '@/bot/conductor.ts'
import { useCoreStore } from '@/store/core.ts'

// This is used only to do a correct ordering with the bot.
// It won't be used in multiplayer

const botMutationQueue: AnyGameMutation[] = []
let processingQueue = false

export function botModeEnqueueMutation(gameMutation: AnyGameMutation) {
    botMutationQueue.push(gameMutation)

    // Only start processing if this was the first element
    if (botMutationQueue.length === 1 && !processingQueue) {
        processingQueue = true
        setTimeout(processNextInBotQueue, 0)
    }
}

function processNextInBotQueue() {
    // Dequeue the next mutation
    const gameMutation = botMutationQueue.shift()

    if (gameMutation) {
        applyMutationIfValid(gameMutation)
    }

    // If there are still items left, schedule the next run
    if (botMutationQueue.length > 0) {
        setTimeout(processNextInBotQueue, BOT_PAUSE_TIME)
    }
    // No more enqueued mutations, we stop processing,
    // but check for the next decision of the bot
    else {
        processingQueue = false
        useCoreStore().conductor?.runDecisionMaking()
    }
}
