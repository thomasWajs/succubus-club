import Phaser, { GameObjects } from 'phaser'
import { AnyCardRegion } from '@/model/CardRegion.ts'
import { Card, CardOid } from '@/model/Card.ts'
import { PlayerOid } from '@/model/Player.ts'
import Vector2Like = Phaser.Types.Math.Vector2Like
import Pointer = Phaser.Input.Pointer

type PositionGetter = () => Vector2Like | null

export enum PhaserDataKey {
    CardOid = 'card',
    CardAttrs = 'cardAttrs',
    CardRegionOid = 'cardRegion',
    RegionCategory = 'regionCategory',
    Player = 'player',
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
    x: number // X position of the dragged card
    y: number // Y position of the dragged card
    deltaX: number // X distance from the dragged card origin
    deltaY: number // Y distance from the dragged card origin
    scale: number
}

export type CardDragEvent = {
    originCard: Card
    pointer: Pointer
    dragX?: number
    dragY?: number
    originDragAttrs?: DragAttrs
}

export type DragOver = {
    cardImage: GameObjects.Image // The dragged card image
    card: Card // The dragged card model
    target?: GameObjects.GameObject // Game object dragged over
    cardRegion?: AnyCardRegion // CardRegion dragged over, if any
    regionCategory?: RegionCategory // RegionCategory dragged over, if any
}
