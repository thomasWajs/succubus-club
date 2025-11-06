/** Game types **/
import { Player, PlayerOid } from '@/model/Player.ts'
import { Card, CardOid } from '@/model/Card.ts'
import { AnyCardRegion, CardRegionOid } from '@/model/CardRegion.ts'
import Phaser from 'phaser'
import Vector2Like = Phaser.Types.Math.Vector2Like

export enum GameType {
    TrainBot = 'TrainBot',
    Multiplayer = 'Multiplayer',
}

/** Mutation validity **/

// A response object that tells if a mutation/action can be applied/declared
export class Validity {
    constructor(
        public isValid: boolean,
        public reason: string,
    ) {}
}

export const VALID = new Validity(true, '')
export const Invalid = (reason: string) => new Validity(false, reason)

/** Card Visibility **/

/**
 * Store which player can or cannot see a given card.
 * Also store a "public" visibility for spectators.
 */
export type PlayerVision = {
    public: boolean
    [key: PlayerOid]: boolean
}

/** Card Revelation **/

export const ALL_PLAYERS = 'all'
export type CardRevelationTarget = Card | AnyCardRegion
export type CardRevelationTargetOid = CardOid | CardRegionOid
export type CardRevelationViewer = typeof ALL_PLAYERS | Player
export type CardRevelation = {
    all: boolean
    [key: PlayerOid]: boolean // One PlayerOid for each Player
}

export function getViewerKey(viewer: CardRevelationViewer) {
    return viewer == ALL_PLAYERS ? ALL_PLAYERS : viewer.oid
}

/** Target Declaration ( Arrow ) **/

export type TargetDeclaration = {
    originOid: CardOid
    targetOid: CardOid | PlayerOid
}

export type Arrow = {
    from: Vector2Like
    to: Vector2Like
}
