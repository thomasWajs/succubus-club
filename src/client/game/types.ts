import { Raw } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Card } from '@/shared/model/Card.ts'
import { AnyCardRegion, CardOid, PlayerOid, Point2D } from '@/shared/types/model.ts'
import Pointer = Phaser.Input.Pointer

type PositionGetter = () => Point2D | null

export enum PhaserDataKey {
    CardOid = 'card',
    CardAttrs = 'cardAttrs',
    CardRegionOid = 'cardRegion',
    RegionCategory = 'regionCategory',
    Player = 'player',

    BringOustedToTop = 'bringOustedToTop',
}

export enum RegionCategory {
    Table = 'Table',
    Hand = 'Hand',
    Stack = 'Stack',
}

export type PlayerInGame = {
    playerOid: PlayerOid
    getWorldPosition: PositionGetter
}

export type CardGroup = Set<CardOid>

export type CardInGame = {
    cardOid: CardOid
    getWorldPosition: PositionGetter
    bringToTop: () => void
    isUnderSelectionArea: () => boolean
    onDragStart: (event: CardDragEvent) => void
    onDrag: (event: CardDragEvent) => void
    onDragEnd: (event: CardDragEvent) => void
    onDrop: (event: CardDragEvent) => void
}

export type CardAttrs = {
    category: RegionCategory
    x: number
    y: number
    offsetX?: number
    offsetY?: number
    rotation: number
    scale: number
}

export type DragAttrs = {
    isDragging: boolean
    x: number // X position of the dragged card, relative to its parent container
    y: number // Y position of the dragged card, relative to its parent container
    localX: number // X position of the dragged card, relative to the target container
    localY: number // Y position of the dragged card, relative to the target container
    deltaX: number // X distance from the dragged card origin
    deltaY: number // Y distance from the dragged card origin
    cardScale: number // scale of the dragged card
    scaleRatio: number // scale ratio of the origin container compared to the target container
}

export type CardDragEvent = {
    originCard: Card
    pointer: Pointer
    dragX?: number
    dragY?: number
    originDragAttrs?: DragAttrs
}

export type DragOver = {
    card: Card // The dragged card model
    cardRegion?: AnyCardRegion // CardRegion dragged over, if any
    regionCategory?: RegionCategory // RegionCategory dragged over, if any

    gameObjects: Raw<{
        cardImage: GameObjects.Image // The dragged card image
        target?: GameObjects.GameObject // Game object dragged over
    }>
}
