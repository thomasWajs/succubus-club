import { DisciplineCode, DisciplineLevel } from '@/shared/const/model.ts'
import { DisciplineUse } from '@/shared/types/state.ts'

/**
 * Parsing a card's discipline usage options out of its text.
 *
 * Action cards state the discipline(s) they need as bracket codes : lowercase
 * for inferior, uppercase for superior ( [pot] = inferior Potence, [POT] =
 * superior Potence ). A card may offer several ways to be played :
 * - a single option ( "[pot]" ) ;
 * - inferior or superior of one discipline ( "[pot]" ... "[POT]" ) ;
 * - one of two disciplines ( "[pot] or [pre]" ) ;
 * - both disciplines together ( "[pot][pre]" ) ;
 * - several separate options across the text.
 *
 * The player normally picks a single option. A rare few cards let several be
 * used at once ; those spell it out with an explicit sentence, which is the only
 * reliable signal ( the tokens alone can't distinguish it ).
 */

// A selectable usage option : one or more discipline uses declared together.
// Directly-consecutive tokens ( "[pot][pre]" ) form a single option using both.
export type UsageOption = DisciplineUse[]

export type ParsedCardUsage = {
    options: UsageOption[]
    // When true, several options may be selected at once ; otherwise the player
    // picks a single option.
    multiple: boolean
}

// The exact wording cards use to allow combining several disciplines.
const MULTI_DISCIPLINE_SENTENCE = 'More than one Discipline can be used to play this card'

// A 3-letter discipline code in brackets, e.g. [pot] or [POT]. Card text also
// contains non-discipline bracket icons ( clans, flight, merge... ) which are
// filtered out by checking the code against DisciplineCode.
const DISCIPLINE_TOKEN = /\[([A-Za-z]{3})\]/g

function tokenLevel(token: string): DisciplineLevel {
    return token === token.toUpperCase() ? DisciplineLevel.SUPERIOR : DisciplineLevel.INFERIOR
}

function optionKey(option: UsageOption): string {
    return option
        .map(use => `${use.discipline}:${use.level}`)
        .sort()
        .join('|')
}

// Drop options that repeat the same set of discipline uses ( the same variant
// can gate several effect paragraphs in the text ).
function dedupeOptions(options: UsageOption[]): UsageOption[] {
    const seen = new Set<string>()
    const result: UsageOption[] = []
    for (const option of options) {
        const key = optionKey(option)
        if (!seen.has(key)) {
            seen.add(key)
            result.push(option)
        }
    }
    return result
}

export function parseCardUsage(text: string): ParsedCardUsage {
    const multiple = text.includes(MULTI_DISCIPLINE_SENTENCE)

    const options: UsageOption[] = []
    let previousEnd = -1

    for (const match of text.matchAll(DISCIPLINE_TOKEN)) {
        const token = match[1]
        const discipline = DisciplineCode[token.toLowerCase()]
        const start = match.index ?? 0

        // A non-discipline bracket icon breaks any adjacency between the
        // surrounding discipline tokens, so reset the run.
        if (!discipline) {
            previousEnd = -1
            continue
        }

        const use: DisciplineUse = { discipline, level: tokenLevel(token) }

        // Directly-consecutive tokens ( only whitespace between them, e.g.
        // "[pot][pre]" ) are grouped into a single option, used together. Any
        // other separation ( "or", effect text, a line break ) starts a new one.
        const gap = previousEnd >= 0 ? text.slice(previousEnd, start) : ''
        const grouped = previousEnd >= 0 && gap.trim() === ''

        if (grouped) {
            options[options.length - 1].push(use)
        } else {
            options.push([use])
        }
        previousEnd = start + match[0].length
    }

    return { options: dedupeOptions(options), multiple }
}
