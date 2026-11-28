/**
 * Checks the log rows built from hand-written log entries : turn and phase separators, author
 * blocks, grouped counter changes and their texts, what a single Undo takes back, and the reuse
 * of unchanged rows. Run it after any change to the logs :
 *
 *     npm run log:check
 *
 * Prints each failing case with the rows expected and built, exits with 1 on a failure.
 */

import { LogEntry, LogGroup } from '@/shared/types/history.ts'
import { PlayerOid } from '@/shared/types/model.ts'
import { GameMutationId, GameMutationName } from '@/shared/state/gameMutations.ts'
import {
    AMOUNT_LOG_PLACEHOLDER,
    CARD_LOG_PLACEHOLDER,
    COUNT_LOG_PLACEHOLDER,
} from '@/shared/const/game.ts'
import {
    buildLogRows,
    groupLineText,
    groupTotal,
    LogRow,
    reuseLogRows,
} from '@/client/ui/ingame/rightColumn/log/logRows.ts'
import { joinsUndoGroup } from '@/shared/state/history/logEntries.ts'

/**
 * Entries
 */

const UNLOCK = 0
const MASTER = 1
const MINION = 2
const DISCARD = 4

// Where the game is, for the entries written next
const game: {
    turn: number
    phase: number
    author: string
    activePlayer?: PlayerOid
    nextId: number
} = { turn: 1, phase: UNLOCK, author: 'Alice', nextId: 1 }

function entry(
    text: string,
    mutationName: GameMutationName,
    extra: Partial<LogEntry> = {},
): LogEntry {
    return {
        text,
        timestamp: new Date(0),
        authorName: game.author,
        authorColorRgba: 'rgba(0, 0, 0, 1)',
        mutationId: game.nextId++ as GameMutationId,
        mutationName,
        turnNumber: game.turn,
        turnPhaseIndex: game.phase,
        activePlayerOid: game.activePlayer,
        ...extra,
    }
}

function by(author: string): void {
    game.author = author
}

function goToTurn(turn: number): LogEntry {
    const isRewind = turn < game.turn
    game.turn = turn
    game.phase = isRewind ? DISCARD : UNLOCK
    return entry(`${isRewind ? 'Back' : 'Advance'} to turn ${turn}`, 'goToTurn')
}

function goToPhase(phase: number): LogEntry {
    game.phase = phase
    return entry('Go to phase', 'goToTurnPhase')
}

function undo(undone: LogEntry, text: string, extra: Partial<LogEntry> = {}): LogEntry {
    return entry(text, undone.mutationName ?? 'changePool', {
        cancelsMutationId: undone.mutationId,
        ...extra,
    })
}

function counter(key: string, amount: number, text: string): Partial<LogEntry> {
    const group: LogGroup = { key, amount }
    return { group, text }
}

function pool(amount: number): LogEntry {
    return entry('', 'changePool', counter('pool', amount, `${AMOUNT_LOG_PLACEHOLDER} pool`))
}

function influence(amount: number): LogEntry {
    const verb = amount < 0 ? 'Retro' : 'Influence'
    return entry(
        '',
        'influence',
        counter('influence', amount, `${verb} ${COUNT_LOG_PLACEHOLDER} on ${CARD_LOG_PLACEHOLDER}`),
    )
}

function drawLibrary(): LogEntry {
    return entry(
        '',
        'drawLibrary',
        counter('draw', 1, `Draw ${COUNT_LOG_PLACEHOLDER} from library`),
    )
}

function lock(isLocked: boolean): LogEntry {
    return entry(`${isLocked ? 'Lock' : 'Unlock'} ${CARD_LOG_PLACEHOLDER}`, 'setLock', {
        group: { key: 'lock', amount: isLocked ? 1 : -1, isToggle: true },
    })
}

function action(text: string): LogEntry {
    return entry(text, 'moveCardToRegion')
}

function chat(text: string): LogEntry {
    return {
        text,
        timestamp: new Date(0),
        authorName: game.author,
        authorColorRgba: 'rgba(0, 0, 0, 1)',
    }
}

/**
 * Rows, written as text :
 *   "Turn 2", "Turn 1 back", "Turn 3 · bob" ( whose turn it is )
 *   "Master phase" ( "Master phase *" without its phase change entry, "+" when the bar of the
 *   author goes through )
 *   "Alice: +2 pool" ( the author when the line heads a block, "~" when the changes cancel out )
 */

function rowText(row: LogRow): string {
    if (row.kind === 'turn') {
        const player = row.activePlayerOid ? ` · ${row.activePlayerOid}` : ''
        return `Turn ${row.turnNumber}${player}${row.isRewind ? ' back' : ''}`
    }
    if (row.kind === 'phase') {
        return `${row.phaseName} phase${row.entry ? '' : ' *'}${row.joinsBlock ? ' +' : ''}`
    }
    const author = row.showAuthor ? `${row.entries[0].authorName}: ` : ''
    const isNeutral = row.entries.length > 1 && groupTotal(row.entries) === 0
    return `${author}${groupLineText(row.entries)}${isNeutral ? ' ~' : ''}`
}

/**
 * Cases
 */

type Case = { name: string; entries: () => LogEntry[]; expected: string[]; cancelled?: number[] }

function reset(turn = 1, phase = UNLOCK): void {
    game.turn = turn
    game.phase = phase
    game.author = 'Alice'
    game.activePlayer = undefined
}

const cases: Case[] = [
    {
        name: 'a turn separator names whose turn it is',
        entries: () => {
            game.activePlayer = 'alice' as PlayerOid
            const first = action('Unlock')
            game.activePlayer = 'bob' as PlayerOid
            return [first, goToTurn(2), action('Unlock')]
        },
        expected: [
            'Turn 1 · alice',
            'Unlock phase *',
            'Alice: Unlock',
            'Turn 2 · bob',
            'Unlock phase *',
            'Alice: Unlock',
        ],
    },
    {
        name: 'the first turn starts in the unlock phase',
        entries: () => [pool(1), pool(1)],
        expected: ['Turn 1', 'Unlock phase *', 'Alice: +2 pool'],
    },
    {
        name: 'a phase change shows above the lines of its phase',
        entries: () => [pool(1), goToPhase(MASTER), pool(-1)],
        expected: ['Turn 1', 'Unlock phase *', 'Alice: +1 pool', 'Master phase +', '-1 pool'],
    },
    {
        name: 'a phase without lines is dropped',
        entries: () => [goToPhase(MASTER), goToPhase(MINION), action('Move')],
        expected: ['Turn 1', 'Minion phase', 'Alice: Move'],
    },
    {
        name: 'back to the phase of the lines above : no separator, the group goes on',
        entries: () => [goToPhase(MASTER), pool(1), goToPhase(MINION), goToPhase(MASTER), pool(1)],
        expected: ['Turn 1', 'Master phase', 'Alice: +2 pool'],
    },
    {
        name: 'the last phase change shows before any line',
        entries: () => [pool(1), goToPhase(MASTER)],
        expected: ['Turn 1', 'Unlock phase *', 'Alice: +1 pool', 'Master phase'],
    },
    {
        name: 'a new turn starts in the unlock phase',
        entries: () => [goToPhase(DISCARD), action('Discard'), goToTurn(2), action('Unlock')],
        expected: [
            'Turn 1',
            'Discard phase',
            'Alice: Discard',
            'Turn 2',
            'Unlock phase *',
            'Alice: Unlock',
        ],
    },
    {
        name: 'a turn back starts in the discard phase',
        entries: () => [goToTurn(2), action('Unlock'), goToTurn(1), action('Discard')],
        expected: [
            'Turn 2',
            'Unlock phase *',
            'Alice: Unlock',
            'Turn 1 back',
            'Discard phase *',
            'Alice: Discard',
        ],
    },
    {
        name: 'a log starting mid-game knows its phase',
        entries: () => {
            reset(3, MINION)
            return [action('Bleed')]
        },
        expected: ['Turn 3', 'Minion phase *', 'Alice: Bleed'],
    },
    {
        name: 'a phase change undone after lines : back to the phase above',
        entries: () => {
            const entries = [goToPhase(MASTER), action('Move')]
            const minion = goToPhase(MINION)
            entries.push(minion, pool(1))
            game.phase = MASTER
            entries.push(undo(minion, 'Go back'))
            return entries
        },
        cancelled: [3],
        expected: [
            'Turn 1',
            'Master phase',
            'Alice: Move',
            'Minion phase +',
            '+1 pool',
            'Master phase *',
            'Alice: Go back',
        ],
    },
    {
        name: 'chat shows below a phase change',
        entries: () => [goToPhase(MASTER), chat('hi')],
        expected: ['Turn 1', 'Master phase', 'Alice: hi'],
    },
    {
        name: 'another author breaks the block and the group',
        entries: () => {
            const first = pool(1)
            by('Bob')
            return [first, pool(1)]
        },
        expected: ['Turn 1', 'Unlock phase *', 'Alice: +1 pool', 'Bob: +1 pool'],
    },
    {
        name: 'a group cancelling out reads ±0',
        entries: () => [pool(2), pool(-2)],
        expected: ['Turn 1', 'Unlock phase *', 'Alice: ±0 pool ~'],
    },
    {
        name: 'a retro takes from the influences',
        entries: () => [influence(4), influence(-1)],
        expected: ['Turn 1', 'Unlock phase *', 'Alice: Influence 3 on [CARD]'],
    },
    {
        name: 'a retro beyond the influences reads as a retro',
        entries: () => [influence(1), influence(-2)],
        expected: ['Turn 1', 'Unlock phase *', 'Alice: Retro 1 on [CARD]'],
    },
    {
        name: 'a retro alone',
        entries: () => [influence(-1)],
        expected: ['Turn 1', 'Unlock phase *', 'Alice: Retro 1 on [CARD]'],
    },
    {
        name: 'draws in a row',
        entries: () => [drawLibrary(), drawLibrary(), drawLibrary()],
        expected: ['Turn 1', 'Unlock phase *', 'Alice: Draw 3 from library'],
    },
    {
        name: 'lock then unlock',
        entries: () => [lock(true), lock(false)],
        expected: ['Turn 1', 'Unlock phase *', 'Alice: Lock and unlock [CARD] ~'],
    },
    {
        name: 'an undone change and its undo stay apart',
        entries: () => {
            const plus = pool(1)
            return [plus, undo(plus, '', counter('pool', -1, `${AMOUNT_LOG_PLACEHOLDER} pool`))]
        },
        cancelled: [1],
        expected: ['Turn 1', 'Unlock phase *', 'Alice: +1 pool', '-1 pool'],
    },
]

/**
 * Run
 */

function print(line: string): void {
    process.stdout.write(`${line}\n`)
}

let failures = 0
for (const testCase of cases) {
    reset()
    game.nextId = 1
    const entries = testCase.entries()
    const cancelled = new Set((testCase.cancelled ?? []).map(id => id as GameMutationId))
    const rows = buildLogRows(entries, cancelled).map(rowText)
    if (JSON.stringify(rows) !== JSON.stringify(testCase.expected)) {
        failures++
        print(`FAIL ${testCase.name}`)
        print(`  expected ${JSON.stringify(testCase.expected)}`)
        print(`  built    ${JSON.stringify(rows)}`)
    }
}

/**
 * Undo groups : how many entries, from the last one up, a single Undo takes back
 */

function declare(): LogEntry {
    return entry('Declare bleed', 'ACTION_declareAction')
}

function completing(declaration: LogEntry, isSilent = true): LogEntry {
    const into = declaration.mutationId ?? (0 as GameMutationId)
    return entry('Play', 'moveCardToRegion', { fold: { into, isSilent } })
}

function undoGroupSize(entries: LogEntry[]): number {
    let size = 1
    for (let i = entries.length - 1; i > 0 && joinsUndoGroup(entries[i - 1], entries[i]); i--) {
        size++
    }
    return size
}

type UndoCase = { name: string; entries: () => LogEntry[]; expected: number }

const undoCases: UndoCase[] = [
    {
        name: 'undo takes back the counter changes of a group',
        entries: () => [action('Unlock'), pool(-1), pool(-1), pool(-1)],
        expected: 3,
    },
    {
        name: 'undo takes back a declaration with its target and its card',
        entries: () => {
            const declaration = declare()
            return [action('Unlock'), declaration, completing(declaration), completing(declaration)]
        },
        expected: 3,
    },
    {
        name: 'undo of the card of an action leaves a payment made after the declaration',
        entries: () => {
            const declaration = declare()
            return [declaration, pool(-1), completing(declaration)]
        },
        expected: 1,
    },
    {
        name: 'undo of the card of an action leaves a usage change logged before it',
        entries: () => {
            const declaration = declare()
            return [declaration, completing(declaration, false), completing(declaration)]
        },
        expected: 1,
    },
]

for (const testCase of undoCases) {
    reset()
    game.nextId = 1
    const size = undoGroupSize(testCase.entries())
    if (size !== testCase.expected) {
        failures++
        print(`FAIL ${testCase.name}`)
        print(`  expected ${testCase.expected} entries undone, got ${size}`)
    }
}

/**
 * Row reuse : a new entry keeps the row objects of the lines it doesn't change
 */

function checkRowReuse(): boolean {
    reset()
    game.nextId = 1
    const entries = [action('Unlock'), pool(-1)]
    const before = buildLogRows(entries, new Set())
    entries.push(pool(-1), action('Discard'))
    const after = reuseLogRows(before, buildLogRows(entries, new Set()))
    // The turn, the phase and the first line are kept ; the pool line got an entry
    return (
        after[0] === before[0] &&
        after[1] === before[1] &&
        after[2] === before[2] &&
        after[3] !== before[3] &&
        after.length === 5
    )
}

const reuseCases = 1
if (!checkRowReuse()) {
    failures++
    print('FAIL row reuse : unchanged rows keep their objects, changed ones are new')
}

const total = cases.length + undoCases.length + reuseCases
print(`${total - failures} / ${total} cases pass`)
process.exit(failures > 0 ? 1 : 0)
