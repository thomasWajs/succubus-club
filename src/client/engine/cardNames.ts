/**
 * The cards the engine's lines name ( the log, the cards played during an action, a
 * referendum's terms ) : hovering a card's name shows the card, as SC's own log does.
 *
 * The engine's lines are text : a card is found by its name, among the cards the user has seen
 * in this game ( longest names first ). A card never seen is not matched : its name in a line
 * tells nothing more than the line itself.
 */

import { shallowRef } from 'vue'
import { Card, isCryptId } from '@/shared/model/Card.ts'
import { KrcgId } from '@/shared/types/gateway.ts'
import { gameResources } from '@/shared/registries.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { useGameBusStore } from '@/client/store/bus.ts'

// A piece of a line : text, or a card's name
export type TextSegment = { text: string; krcgId?: KrcgId; isCrypt?: boolean }

// The cards seen in this game, by name ; and the expression that finds them in a line
const seen = new Map<string, KrcgId>()
const matcher = shallowRef<RegExp | null>(null)

function escape(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Learn the cards the user knows now ( after each of the engine's messages )
export function learnCardNames() {
    let changed = false
    for (const krcgId of Object.values(useGameStateStore().knownCards)) {
        const name = gameResources.cardbase[krcgId]?.name
        if (name && !seen.has(name)) {
            seen.set(name, krcgId)
            changed = true
        }
    }
    if (changed) {
        const names = [...seen.keys()].sort((a, b) => b.length - a.length).map(escape)
        matcher.value = new RegExp(`(?<!\\w)(?:${names.join('|')})(?!\\w)`, 'g')
    }
}

export function forgetCardNames() {
    seen.clear()
    matcher.value = null
}

// A line of the engine, cut around the names of the cards it names
export function cardSegments(text: string): TextSegment[] {
    const regexp = matcher.value
    if (!regexp) {
        return [{ text }]
    }
    const segments: TextSegment[] = []
    let last = 0
    for (const match of text.matchAll(regexp)) {
        const krcgId = seen.get(match[0])
        if (!krcgId || match.index === undefined) {
            continue
        }
        if (match.index > last) {
            segments.push({ text: text.slice(last, match.index) })
        }
        segments.push({ text: match[0], krcgId, isCrypt: isCryptId(krcgId) })
        last = match.index + match[0].length
    }
    if (last < text.length) {
        segments.push({ text: text.slice(last) })
    }
    return segments
}

// A card of the table with this identity, to show it
export function cardWithId(krcgId: KrcgId): Card | undefined {
    const gameState = useGameStateStore()
    for (const [oid, known] of Object.entries(gameState.knownCards)) {
        if (known == krcgId && gameState.cards[oid as keyof typeof gameState.cards]) {
            return gameState.cards[oid as keyof typeof gameState.cards]
        }
    }
    return undefined
}

/**
 * Hovering a card outside the table ( a line, a button ) : it is shown as when hovered on the
 * table ( the close-up ) ; null when the pointer leaves it. `canView` : its face is known ( a card
 * a line names ).
 */
export function hoverEngineCard(card: Card | null | undefined, canView?: boolean) {
    const gameBus = useGameBusStore()
    gameBus.hoveredCard = card ?? null
    if (card) {
        gameBus.setCloseUpCard(card, { canView })
    } else {
        gameBus.assignPinnedCloseUpCard()
    }
}

// Clicking a card's name : pinned in the close-up, as SC's log does
export function pinEngineCard(card: Card | undefined) {
    if (card) {
        useGameBusStore().setCloseUpCard(card, { canView: true, pinned: true, flash: true })
    }
}
