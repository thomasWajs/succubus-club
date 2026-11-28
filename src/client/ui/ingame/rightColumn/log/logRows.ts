import { LogEntry } from '@/shared/types/history.ts'
import { GameMutationId } from '@/shared/state/gameMutations.ts'
import { continuesLogGroup } from '@/shared/state/history/logEntries.ts'
import { TurnSequence } from '@/shared/const/model.ts'
import { PlayerOid } from '@/shared/types/model.ts'
import { AMOUNT_LOG_PLACEHOLDER, COUNT_LOG_PLACEHOLDER } from '@/shared/const/game.ts'

/**
 * The rows of the log : the entries, plus separators for the turns and phases.
 */

export type TurnRow = {
    kind: 'turn'
    key: string
    // Absent when the separator only marks a turn change between two entries
    entry?: LogEntry
    turnNumber: number
    // The player whose turn it is
    activePlayerOid?: PlayerOid
    // The turn goes backward ( "Back to turn", or an undone turn change )
    isRewind: boolean
}

export type PhaseRow = {
    kind: 'phase'
    key: string
    // Absent when the lines below are in another phase without a phase change logged above
    // them : the phase a turn starts in, a phase change undone
    entry?: LogEntry
    phaseName: string
    // The author acted before and after changing the phase : their bar goes through it
    joinsBlock: boolean
}

export type LineRow = {
    kind: 'line'
    key: string
    // Several entries for grouped counter changes ( three "-1 pool" clicks ), oldest first
    entries: LogEntry[]
    // The entries completing an action declaration, in its line ( see LogFold ), oldest first
    folded: LogEntry[]
    // The author ( and time ) heads a block of consecutive lines of the same author
    showAuthor: boolean
}

export type LogRow = TurnRow | PhaseRow | LineRow

export function isChatEntry(entry: LogEntry): boolean {
    return entry.mutationId === undefined
}

export function isCancelEntry(entry: LogEntry): boolean {
    return entry.cancelsMutationId !== undefined
}

export function rowEntries(row: LogRow): LogEntry[] {
    if (row.kind === 'line') {
        return [...row.entries, ...row.folded]
    }
    return row.entry ? [row.entry] : []
}

export function rowMutationIds(row: LogRow): GameMutationId[] {
    return rowEntries(row)
        .map(entry => entry.mutationId)
        .filter(mutationId => mutationId !== undefined)
}

function sameItems<T>(a: T[], b: T[]): boolean {
    return a.length === b.length && a.every((item, index) => item === b[index])
}

function sameRow(previous: LogRow, row: LogRow): boolean {
    if (previous.kind === 'line' && row.kind === 'line') {
        return (
            previous.showAuthor === row.showAuthor &&
            sameItems(previous.entries, row.entries) &&
            sameItems(previous.folded, row.folded)
        )
    }
    if (previous.kind === 'phase' && row.kind === 'phase') {
        return (
            previous.entry === row.entry &&
            previous.phaseName === row.phaseName &&
            previous.joinsBlock === row.joinsBlock
        )
    }
    if (previous.kind === 'turn' && row.kind === 'turn') {
        return (
            previous.entry === row.entry &&
            previous.turnNumber === row.turnNumber &&
            previous.activePlayerOid === row.activePlayerOid &&
            previous.isRewind === row.isRewind
        )
    }
    return false
}

/**
 * The rows of a new build, keeping the previous build's row objects when unchanged : their
 * components get the same props, and don't render again ( only the last lines change when an
 * entry comes in )
 */
export function reuseLogRows(previousRows: LogRow[] | undefined, rows: LogRow[]): LogRow[] {
    if (!previousRows) {
        return rows
    }
    const previousByKey = new Map(previousRows.map(row => [row.key, row]))
    return rows.map(row => {
        const previous = previousByKey.get(row.key)
        return previous && sameRow(previous, row) ? previous : row
    })
}

// The text of the entries of a line ( a single one too ), before its card and refs are rendered
export function groupLineText(entries: LogEntry[]): string {
    const first = entries[0]
    const last = entries[entries.length - 1]
    const total = groupTotal(entries)
    if (last.group?.isToggle) {
        return entries.length > 1 && total === 0 ?
                toggleGroupText(first.text, last.text)
            :   last.text
    }
    return groupText(groupTextEntry(entries).text, total)
}

// The text of a group, its amount filled with the total : signed ( "±0" when the changes cancel
// out ), or its size ( "Retro 2" )
function groupText(text: string, total: number): string {
    const signed =
        total === 0 ? '±0'
        : total > 0 ? `+${total}`
        : `${total}`
    return text
        .replace(AMOUNT_LOG_PLACEHOLDER, signed)
        .replace(COUNT_LOG_PLACEHOLDER, `${Math.abs(total)}`)
}

export function groupTotal(entries: LogEntry[]): number {
    return entries.reduce((total, entry) => total + (entry.group?.amount ?? 0), 0)
}

// The entry a group is written with : the latest one going the way of the total ( "Influence 4"
// then "Retro 1" make "Influence 3", "Influence 1" then "Retro 2" make "Retro 1" ), the first
// one when they cancel out
function groupTextEntry(entries: LogEntry[]): LogEntry {
    const totalSign = Math.sign(groupTotal(entries))
    if (totalSign === 0) {
        return entries[0]
    }
    return (
        entries.findLast(entry => Math.sign(entry.group?.amount ?? 0) === totalSign) ??
        entries[entries.length - 1]
    )
}

// The text of a toggle group back where it started : "Lock and unlock <card>", from the first
// words of its first and last texts. Else the text of the last entry
function toggleGroupText(first: string, last: string): string {
    const [firstVerb, ...firstRest] = first.split(' ')
    const [lastVerb, ...lastRest] = last.split(' ')
    const rest = firstRest.join(' ')
    if (firstVerb === lastVerb || rest !== lastRest.join(' ')) {
        return last
    }
    return `${firstVerb} and ${lastVerb.toLowerCase()} ${rest}`
}

// The text has the place of the amount, to be filled with the total. A toggle needs none
function hasGroupAmount(entry: LogEntry): boolean {
    return (
        entry.group?.isToggle === true ||
        entry.text.includes(AMOUNT_LOG_PLACEHOLDER) ||
        entry.text.includes(COUNT_LOG_PLACEHOLDER)
    )
}

// The turn an entry moves to, or null when it doesn't change the turn
function turnChange(entry: LogEntry): number | null {
    return entry.mutationName === 'goToTurn' && entry.turnNumber !== undefined ?
            entry.turnNumber
        :   null
}

function isPhaseChange(entry: LogEntry): boolean {
    return entry.mutationName === 'goToTurnPhase' && !isCancelEntry(entry)
}

function isCancelled(entry: LogEntry, cancelledMutations: Set<GameMutationId>): boolean {
    return entry.mutationId !== undefined && cancelledMutations.has(entry.mutationId)
}

/**
 * Phases come from the entries ( `LogEntry.turnPhaseIndex` ) : a phase separator goes above
 * the first line of another phase than the lines above it in the turn. With the phase change
 * entry when one leads there, else without ( the phase a turn starts in ). A phase change
 * without any line after it is dropped ( the next phase or turn replaces it ), unless it's the
 * last entry ; going back to the phase of the lines above ( Master, Minion, back to Master )
 * shows no separator, the lines go on.
 */
export function buildLogRows(
    entries: LogEntry[],
    cancelledMutations: Set<GameMutationId>,
): LogRow[] {
    const rows: LogRow[] = []
    let currentTurn: number | undefined
    // The phase of the lines below the last separator, when known
    let currentPhase: number | undefined
    // The last phase change, until a line shows it
    let pendingPhase: { entry: LogEntry; phaseIndex: number; key: string } | undefined
    // The line above, to group counter changes. Reset by separators
    let previousLine: LineRow | undefined
    // The author of the last line, and whether their block goes on below the separators since
    let lastLineAuthor: string | undefined
    let isBlockOpen = false
    // The phase separator the open block goes through, once the next line joins it
    let joinedPhase: PhaseRow | undefined
    // The lines of the action declarations, and the entries folded into them
    const lineByMutationId = new Map<GameMutationId, LineRow>()
    const foldedMutationIds = new Set<GameMutationId>()

    function pushTurn(row: TurnRow) {
        rows.push(row)
        currentTurn = row.turnNumber
        currentPhase = undefined
        pendingPhase = undefined
        previousLine = undefined
        lastLineAuthor = undefined
        isBlockOpen = false
        joinedPhase = undefined
    }

    // The author of the line above changed the phase : their block may go on
    function pushPhase(key: string, phaseIndex: number, entry: LogEntry | undefined) {
        const row: PhaseRow = {
            kind: 'phase',
            key,
            entry,
            phaseName: TurnSequence[phaseIndex] ?? '',
            joinsBlock: false,
        }
        rows.push(row)
        currentPhase = phaseIndex
        previousLine = undefined
        isBlockOpen = entry !== undefined && lastLineAuthor === entry.authorName
        joinedPhase = isBlockOpen ? row : undefined
    }

    // The separator above a line : the pending phase change when the line is in its phase ( or
    // is chat ), else the phase of the line when it isn't the phase of the lines above
    function pushPhaseAbove(entry: LogEntry, index: number) {
        const linePhase = isChatEntry(entry) ? undefined : entry.turnPhaseIndex
        if (pendingPhase) {
            const pending = pendingPhase
            pendingPhase = undefined
            if (
                (linePhase === undefined || linePhase === pending.phaseIndex) &&
                pending.phaseIndex !== currentPhase
            ) {
                pushPhase(pending.key, pending.phaseIndex, pending.entry)
            }
        }
        if (linePhase !== undefined && linePhase !== currentPhase) {
            pushPhase(`phase-of-${index}`, linePhase, undefined)
        }
    }

    entries.forEach((entry, index) => {
        // Completes an action declaration : in its line. Its undo just takes it out of the line
        const foldLine = entry.fold ? lineByMutationId.get(entry.fold.into) : undefined
        if (foldLine && entry.mutationId !== undefined) {
            foldLine.folded.push(entry)
            foldedMutationIds.add(entry.mutationId)
            return
        }
        if (
            entry.cancelsMutationId !== undefined &&
            foldedMutationIds.has(entry.cancelsMutationId)
        ) {
            return
        }

        const newTurn = turnChange(entry)
        if (newTurn !== null) {
            const isRewind = currentTurn !== undefined && newTurn < currentTurn
            pushTurn({
                kind: 'turn',
                key: `turn-${index}`,
                entry,
                turnNumber: newTurn,
                activePlayerOid: entry.activePlayerOid,
                isRewind,
            })
            return
        }

        // A turn change without its own entry ( start of the log, archived entries )
        if (entry.turnNumber !== undefined && entry.turnNumber !== currentTurn) {
            pushTurn({
                kind: 'turn',
                key: `turn-before-${index}`,
                turnNumber: entry.turnNumber,
                activePlayerOid: entry.activePlayerOid,
                isRewind: currentTurn !== undefined && entry.turnNumber < currentTurn,
            })
        }

        if (isPhaseChange(entry)) {
            if (entry.turnPhaseIndex !== undefined) {
                pendingPhase = { entry, phaseIndex: entry.turnPhaseIndex, key: `phase-${index}` }
            }
            return
        }

        pushPhaseAbove(entry, index)

        // Grouped counter change : added to the line above
        const previousEntry = previousLine?.entries[previousLine.entries.length - 1]
        if (
            previousLine &&
            previousEntry &&
            continuesLogGroup(previousEntry, entry) &&
            isCancelled(previousEntry, cancelledMutations) ===
                isCancelled(entry, cancelledMutations) &&
            hasGroupAmount(previousEntry) &&
            hasGroupAmount(entry)
        ) {
            previousLine.entries.push(entry)
            return
        }

        // Actions and chat of an author share one block
        const isSameAuthor = isBlockOpen && lastLineAuthor === entry.authorName
        if (isSameAuthor && joinedPhase) {
            joinedPhase.joinsBlock = true
        }
        const line: LineRow = {
            kind: 'line',
            key: `line-${index}`,
            entries: [entry],
            folded: [],
            showAuthor: !isSameAuthor,
        }
        rows.push(line)
        if (entry.mutationName === 'ACTION_declareAction' && entry.mutationId !== undefined) {
            lineByMutationId.set(entry.mutationId, line)
        }
        previousLine = line
        lastLineAuthor = entry.authorName
        isBlockOpen = true
        joinedPhase = undefined
    })

    // The last phase change, before anything is done in it
    if (pendingPhase && pendingPhase.phaseIndex !== currentPhase) {
        pushPhase(pendingPhase.key, pendingPhase.phaseIndex, pendingPhase.entry)
    }

    return rows
}
