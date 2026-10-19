import { DEFAULT_CARD_ATTRS } from '@/shared/const/model.ts'

// What the first line of an ally card says: "Unique mortal with 2 life. 1 strength, 0 bleed."
// The order of the three numbers and the words around them vary, so each one is looked up alone.
export type AllyStats = {
    life: number
    strength: number
    bleed: number
}

function numberBefore(line: string, word: string, fallback: number): number {
    const match = line.match(new RegExp(`(\\d+)\\s+${word}\\b`, 'i'))
    return match ? Number(match[1]) : fallback
}

export function parseAllyStats(text: string): AllyStats {
    const line = text.split('\n')[0]
    return {
        life: numberBefore(line, 'life', 1),
        strength: numberBefore(line, 'strength', DEFAULT_CARD_ATTRS.Strength),
        bleed: numberBefore(line, 'bleed', DEFAULT_CARD_ATTRS.Bleed),
    }
}
