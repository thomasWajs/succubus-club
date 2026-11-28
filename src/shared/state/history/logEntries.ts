import { AnyGameMutation } from '@/shared/state/gameMutations.ts'
import { Player } from '@/shared/model/Player.ts'
import { LogDetail, LogEntry, LogFold } from '@/shared/types/history.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { getPlayerVision } from '@/shared/state/cards/cardVisibility.ts'
import { cardLogRef, LOG_REF_REGEX, REVEALED_CARD_LOG_REF_REGEX } from '@/shared/const/game.ts'
import { getAuthorColorRgba } from '@/shared/colors.ts'

// Helpers building and reading the log entries of the history

// Neutral colour for chat authors that have no game colour yet
// ( e.g. messages sent from the game room, before the game starts ).
export const DEFAULT_CHAT_AUTHOR_COLOR_RGBA = 'rgba(150, 150, 150, 1)'

export const authorFromPlayer = (player: Player) => ({
    authorName: player.name,
    authorColorRgba: getAuthorColorRgba(player.rgbaColor),
})

/**
 * Whether a log entry continues the group of the entry right above it : the same counter,
 * changed by the same author ( either way : a correction joins the group ), however long after.
 * Undos group the same way.
 */
export function continuesLogGroup(previous: LogEntry, entry: LogEntry): boolean {
    const previousGroup = previous.group
    const group = entry.group
    if (!previousGroup || !group) {
        return false
    }
    return (
        previousGroup.key === group.key &&
        previous.authorName === entry.authorName &&
        (previous.cancelsMutationId === undefined) === (entry.cancelsMutationId === undefined) &&
        previous.resolvesConflict === entry.resolvesConflict
    )
}

/**
 * Whether Undo takes back an entry with the entry right above it : a counter change of its
 * group, or a silent entry with the declaration it completes ( or another entry completing it,
 * logged right before it in the same gesture )
 */
export function joinsUndoGroup(previous: LogEntry, entry: LogEntry): boolean {
    const fold = entry.fold
    const completesPrevious =
        fold?.isSilent === true &&
        (previous.mutationId === fold.into ||
            (previous.fold?.isSilent === true && previous.fold.into === fold.into))
    return completesPrevious || continuesLogGroup(previous, entry)
}

/**
 * The card references of a log text get the players who can see each card right after the
 * mutation ( see LOG_REF_REGEX ) : a card hidden then stays hidden in the log, even once the
 * reader gets to know it. A card the text reveals ( REVEALED ) is shown to all.
 */
export function secureLogRefs(text: string, gameState: GameState): string {
    return text
        .replace(LOG_REF_REGEX, (whole, kind: string, oid: string) => {
            if (kind !== 'CARD') {
                return whole
            }
            const card = gameState.cards[oid]
            if (!card) {
                return cardLogRef(oid, [])
            }
            const vision = getPlayerVision(card)
            if (vision.public) {
                return cardLogRef(oid)
            }
            return cardLogRef(
                oid,
                Object.keys(gameState.players).filter(playerOid => vision[playerOid]),
            )
        })
        .replace(REVEALED_CARD_LOG_REF_REGEX, (_whole, oid: string) => cardLogRef(oid))
}

export function secureLogDetails(details: LogDetail[] | null, gameState: GameState) {
    return details?.map(detail => ({ ...detail, value: secureLogRefs(detail.value, gameState) }))
}

/**
 * A mutation completing the action in progress goes in the line of its declaration : the last
 * declaration logged, as the action is still in progress. Not its undo : undoing it just takes
 * it out of the line.
 */
export function getActionLineFold(
    gameMutation: AnyGameMutation,
    logEntries: LogEntry[],
): LogFold | undefined {
    const foldMode = gameMutation.actionLineFold
    if (foldMode === null || gameMutation.cancelsMutationId !== undefined) {
        return undefined
    }
    for (let i = logEntries.length - 1; i >= 0; i--) {
        const entry = logEntries[i]
        if (entry.mutationName === 'ACTION_declareAction' && entry.mutationId !== undefined) {
            return { into: entry.mutationId, isSilent: foldMode === 'silent' }
        }
    }
    return undefined
}
