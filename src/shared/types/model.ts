import { CardRegion } from '@/shared/model/CardRegion.ts'
import { Card, CryptCard, LibraryCard } from '@/shared/model/Card.ts'

// Aliases to specify the expected objects through the codebase
export type GameId = string
export type ObjectId = string
export type CardOid = ObjectId
export type PlayerOid = ObjectId
export type CardRegionOid = ObjectId
export type AnyCardRegion = CardRegion<Card>

export type PlayerCardRegions = {
    // Library contains only library cards
    library: CardRegion<LibraryCard>
    // Crypt contains only library cards
    crypt: CardRegion<CryptCard>
    // Ash Heap contains both type of cards
    ashHeap: CardRegion<Card>
    // Removed contains both type of cards
    removed: CardRegion<Card>

    // Hand contains only library cards
    hand: CardRegion<LibraryCard>
    // Uncontrolled contains both type of cards ( library can end up here, e.g.: a banished embrace  )
    uncontrolled: CardRegion<Card>

    // Torpor contains both type of cards ( library can end up here, e.g.: an embrace wounded )
    torpor: CardRegion<Card>
    // Ready contains both type of cards
    ready: CardRegion<Card>
}

export type Separators = {
    verticalX: number
    horizontalY: number
}

export type Point2D = {
    x: number
    y: number
}
