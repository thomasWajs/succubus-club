export enum PhaserDataKey {
    CardOid = 'card',
    CardAttrs = 'cardAttrs',
    CardRegionOid = 'cardRegion',
    Player = 'player',
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
