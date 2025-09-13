export enum PhaserDataKey {
    Card = 'card',
    CardAttrs = 'cardAttrs',
    CardRegion = 'cardRegion',
}

export enum CardCategory {
    CardInHand = 'CardInHand',
    CardOnTable = 'CardOnTable',
    CardInStack = 'CardInStack',
}

export type CardAttrs = {
    category: CardCategory
    x: number
    y: number
    rotation: number
    scale: number
}
