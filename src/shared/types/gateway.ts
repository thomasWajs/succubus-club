// Some resource json use card id in string format, so we'll use string everywhere instead of the integer
export type KrcgId = string

// A deck list in a simple format {KrcgId: nbOccurence}
export type DeckList = Record<KrcgId, number>

export type Deck = {
    name: string
    cards: DeckList
}

export type AvatarId = string
export type AvatarDoc = {
    imageData: string
}
