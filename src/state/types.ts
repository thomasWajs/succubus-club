/** Game types **/
import { Player, PlayerOid } from '@/model/Player.ts'
import { Card, CardOid } from '@/model/Card.ts'
import { AnyCardRegion, CardRegionOid } from '@/model/CardRegion.ts'

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
