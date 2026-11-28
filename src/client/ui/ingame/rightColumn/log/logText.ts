import { computed } from 'vue'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { logAuthorRgba, playerNameRgba } from '@/client/colors.ts'
import { LogDetailIcon, LogEntry } from '@/shared/types/history.ts'
import { Card, CounterColor } from '@/shared/model/Card.ts'
import {
    CARD_LOG_PLACEHOLDER,
    GREEN_COUNTER_FILL_COLOR,
    LOG_REF_REGEX,
    ORANGE_COUNTER_FILL_COLOR,
    PURPLE_COUNTER_FILL_COLOR,
} from '@/shared/const/game.ts'
import { IconName } from '@/client/resources/icons.ts'
import { CardOid, PlayerOid } from '@/shared/types/model.ts'
import { simpleEscapeHtml } from '@/shared/utils.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { selfIsJudge } from '@/client/state/self.ts'

/**
 * Rendering of the log texts : card and player references become colored names, vampires get
 * a short name.
 */

/** Short vampire names **/

// Leading words that are a title rather than a name, found in the crypt card names : "Dr. Douglas
// Netchurch" is "Douglas", "High Priest Angra Mainyu" is "Angra". Epithets stay ( "Bloody Mary",
// "Honest Abe" ), so do surname particles ( "De Sade", "Le Dinh Tho" ). A trailing "The" ( "Baron,
// The" ) goes with the comma
const TITLE_WORDS = new Set([
    // Nobility and rank
    'lord',
    'lady',
    'sir',
    'dame',
    'count',
    'baron',
    'queen',
    'marchesa',
    'don',
    'general',
    'boss',
    // Clergy and religion
    'reverend',
    'father',
    'sister',
    'frère',
    'hermana',
    'high',
    'priest',
    'babalawo',
    'mambo',
    'maman',
    'papa',
    // Civil
    'dr.',
    'doctor',
    'doc',
    'mr.',
    'mister',
    'mistress',
    'madame',
    'frau',
    'uncle',
    'aunt',
    // Articles : "El Monseñor", "La Viuda Blanca", "O Encourado"
    'el',
    'la',
    'o',
])

// The name words, without the version suffix ( "(ADV)" ) nor the leading titles. A name made
// only of titles keeps its last word
function nameWords(fullName: string): string[] {
    const words = fullName
        .replace(/\s*\([^)]*\)\s*$/, '')
        .split(/\s+/)
        .filter(word => word !== '')
    let start = 0
    while (start < words.length - 1 && TITLE_WORDS.has(words[start].toLowerCase())) {
        start++
    }
    return words.slice(start)
}

function namePrefix(words: string[], length: number): string {
    return words
        .slice(0, length)
        .join(' ')
        .replace(/[,;:]$/, '')
}

// Full name => short name, for every crypt card known in the game. The first name word, or
// more words when another crypt card of the game starts the same way ; the full name when
// nothing tells them apart ( "Lucinde" and "Lucinde (ADV)" )
const cryptShortNames = computed(() => {
    const gameState = useGameStateStore()
    const wordsByName = new Map<string, string[]>()
    for (const cards of [gameState.cards, gameState.staleCards]) {
        for (const card of Object.values(cards)) {
            const name = card.isCrypt ? card.name : ''
            if (name && !wordsByName.has(name)) {
                wordsByName.set(name, nameWords(name))
            }
        }
    }

    const shortNames = new Map<string, string>()
    for (const [name, words] of wordsByName) {
        let shortName = name
        for (let length = 1; length <= words.length; length++) {
            const candidate = namePrefix(words, length)
            const isAmbiguous = [...wordsByName].some(
                ([otherName, otherWords]) =>
                    otherName !== name && namePrefix(otherWords, length) === candidate,
            )
            if (!isAmbiguous) {
                shortName = candidate
                break
            }
        }
        shortNames.set(name, shortName)
    }
    return shortNames
})

export function cardShortName(card: Card): string {
    return card.isCrypt ? (cryptShortNames.value.get(card.name) ?? card.name) : card.name
}

/** Html **/

const HIDDEN_CARD_HTML = `<span class="hidden">hidden card</span>`

// The full name is in the tooltip. `data-card-oid` lets the log line show the hovered card
export function cardNameHtml(card: Card): string {
    if (!card.name) {
        return HIDDEN_CARD_HTML
    }
    const cssClass = card.isCrypt ? 'cryptCard' : 'libCard'
    const fullName = simpleEscapeHtml(card.name)
    return `<span class="${cssClass}" data-card-oid="${card.oid}" title="${fullName}">${simpleEscapeHtml(cardShortName(card))}</span>`
}

// The name of a player, in their seat color
export function logPlayerName(
    playerOid: PlayerOid,
): { name: string; color: string | undefined } | null {
    const player = useGameStateStore().players[playerOid]
    return player ? { name: player.name, color: playerNameRgba(player) } : null
}

function playerNameHtml(playerOid: PlayerOid): string {
    const player = logPlayerName(playerOid)
    if (!player) {
        return '?'
    }
    return `<span class="player-name" style="color: ${player.color}">${simpleEscapeHtml(player.name)}</span>`
}

export function findLogCard(cardOid: CardOid): Card | undefined {
    const gameState = useGameStateStore()
    return gameState.cards[cardOid] ?? gameState.staleCards[cardOid]
}

/**
 * The card of a log reference, when the reader could see it when it was logged : `viewers`
 * lists the players who could, absent when all could ( see LOG_REF_REGEX ). A judge oversees
 * the game : they see every logged card
 */
export function logRefCard(cardOid: CardOid, viewers: string | undefined): Card | null {
    if (viewers !== undefined && !selfIsJudge()) {
        const selfPlayerOid = usePlayersStore().selfPlayerOid
        if (!selfPlayerOid || !viewers.split(',').includes(selfPlayerOid)) {
            return null
        }
    }
    return findLogCard(cardOid) ?? null
}

// The card of an entry, when the reader had vision on it at the time of the entry
export function logEntryCard(entry: LogEntry): Card | null {
    const vision = entry.playerVision
    if (!entry.card || !vision) {
        return null
    }
    // A judge oversees the game : they see every logged card
    if (selfIsJudge()) {
        return entry.card
    }
    const selfPlayerOid = usePlayersStore().selfPlayerOid
    const hasVision = vision.public || (selfPlayerOid && vision[selfPlayerOid])
    return hasVision ? entry.card : null
}

// Cards unlocked by an Unlock All ( or locked by its undo ), in its details, so they can be
// pinged from the log
export function logUnlockedCards(entry: LogEntry): Card[] {
    if (entry.mutationName !== 'unlockAll' && entry.mutationName !== 'unlockAllInverse') {
        return []
    }
    const cards: Card[] = []
    for (const detail of entry.details ?? []) {
        for (const match of detail.value.matchAll(LOG_REF_REGEX)) {
            const card = match[1] === 'CARD' ? logRefCard(match[2] as CardOid, match[3]) : null
            if (card) {
                cards.push(card)
            }
        }
    }
    return cards
}

/**
 * The html of a mutation log text. `entryCard` replaces the placeholder : the card of the
 * entry, or null when the reader had no vision on it.
 */
export function logTextHtml(text: string, entryCard: Card | null): string {
    const entryCardHtml = entryCard ? cardNameHtml(entryCard) : HIDDEN_CARD_HTML
    return text
        .replace(CARD_LOG_PLACEHOLDER, entryCardHtml)
        .replace(
            LOG_REF_REGEX,
            (_whole, kind: string, oid: string, viewers: string | undefined) => {
                if (kind === 'PLAYER') {
                    return playerNameHtml(oid as PlayerOid)
                }
                const card = logRefCard(oid as CardOid, viewers)
                return card ? cardNameHtml(card) : HIDDEN_CARD_HTML
            },
        )
}

/** Details **/

// The colored counters are the counter icon in the color of the counters on the cards
const COUNTER_COLORS: Record<CounterColor, string> = {
    green: GREEN_COUNTER_FILL_COLOR,
    orange: ORANGE_COUNTER_FILL_COLOR,
    purple: PURPLE_COUNTER_FILL_COLOR,
}

export function logDetailIcon(icon: LogDetailIcon): { name: IconName; color?: string } {
    if (icon === 'green' || icon === 'orange' || icon === 'purple') {
        return { name: 'counter', color: COUNTER_COLORS[icon] }
    }
    return { name: icon }
}

/** Author **/

// The seat color of the author, for the bar on the left of their block. Authors without a seat
// ( chat before the game, conflict resolver ) keep the pastel stored in the entry
export function logAuthorBarColor(entry: LogEntry): string {
    return logAuthorRgba(entry.authorColorRgba) ?? entry.authorColorRgba
}

/** Time **/

export function logTime(timestamp: Date): string {
    const hours = timestamp.getHours().toString().padStart(2, '0')
    const minutes = timestamp.getMinutes().toString().padStart(2, '0')
    return `${hours}:${minutes}`
}
