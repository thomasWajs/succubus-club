import { db } from '@/gateway/db.ts'
import { serializeGame } from '@/gateway/serialization.ts'
import { useCoreStore } from '@/store/core.ts'
import { useMultiplayerStore } from '@/store/multiplayer.ts'
import { useGameBusStore } from '@/store/bus.ts'

const MAX_AUTO_SAVED_GAMES = 5
const AUTO_SAVE_INTERVAL = 1000 * 60 * 2 // 1000 miliseconds * 60 seconds * 2 = 2 minutes
const SAVING_FEEDBACK_DISPLAY_TIME = 1500 // 1,5 seconds
const AUTO_SAVING_FEEDBACK_DISPLAY_TIME = 3000 // 3 seconds

export enum SavingState {
    None = 'None',
    AutoSaving = 'AutoSaving',
    Saving = 'Saving',
    Error = 'Error',
    Done = 'Done',
}

export async function saveGame(isAutoSave: boolean) {
    const core = useCoreStore()
    const gameBus = useGameBusStore()
    const multiplayer = useMultiplayerStore()
    const date = new Date()

    // A save is already in progress, do nothing
    if (gameBus.savingState != SavingState.None) {
        return
    }

    // Display "Saving...", Then "Ok" to the user, so he knows what happens
    gameBus.savingState = isAutoSave ? SavingState.AutoSaving : SavingState.Saving
    const displayTime =
        isAutoSave ? AUTO_SAVING_FEEDBACK_DISPLAY_TIME : SAVING_FEEDBACK_DISPLAY_TIME
    let savingSuccess = false
    setTimeout(() => {
        if (savingSuccess) {
            gameBus.savingState = SavingState.Done
            setTimeout(() => {
                gameBus.savingState = SavingState.None
            }, displayTime)
        }
    }, displayTime)

    try {
        const formattedDate = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
        const autoSavePrefix = isAutoSave ? '[AutoSave] ' : ''
        const saveName = `${autoSavePrefix} ${formattedDate}`

        const seating =
            multiplayer.currentGameRoom ? multiplayer.currentGameRoom.seating.slice() : []

        await db.savedGames.add({
            date: new Date(),
            name: saveName,
            // We cannot index boolean in Dexie, so fallback on 0=false / 1=true
            isAutoSave: isAutoSave ? 1 : 0,
            gameType: core.gameType,
            roomName: multiplayer.currentGameRoom?.name ?? '',
            seating,
            game: serializeGame(),
        })
    } catch (err) {
        gameBus.savingState = SavingState.Error
        throw err
    }
    savingSuccess = true
}

async function removeOldAutoSavedGames() {
    // Get all autosaves
    const autosaves = await db.savedGames.where({ isAutoSave: 1 }).toArray()

    // If we have more than 9 autosaves (as we're about to add one more)
    if (autosaves.length > MAX_AUTO_SAVED_GAMES) {
        // Sort by date in ascending order (oldest first)
        const sortedAutosaves = autosaves.sort((a, b) => a.date.getTime() - b.date.getTime())
        // Calculate how many saves to delete
        const deleteCount = autosaves.length - MAX_AUTO_SAVED_GAMES
        // Get the IDs of the oldest saves that need to be deleted
        const idsToDelete = sortedAutosaves.slice(0, deleteCount).map(save => save.id)
        // Delete the oldest saves
        await db.savedGames.bulkDelete(idsToDelete)
    }
}

async function autoSaveGame() {
    await saveGame(true)
    await removeOldAutoSavedGames()
}

export function initAutoSaveGame() {
    setInterval(autoSaveGame, AUTO_SAVE_INTERVAL)
}
