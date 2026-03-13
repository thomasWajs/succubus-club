import { BaseModel } from '@/shared/model/BaseModel.ts'
import {
    DEFAULT_CARD_ATTRS,
    Discipline,
    DisciplineLevel,
    LibraryCardType,
    Marker,
} from '@/shared/const/model.ts'
import { CRYPT_CARD_IMPLEMENTATIONS } from '@/shared/cardImpl'
import * as cardVisibility from '@/shared/state/cardVisibility.ts'
import { GRID_SIZE } from '@/shared/const/game.ts'
import { KrcgId } from '@/shared/types/gateway.ts'
import { CardOid, GameId, PlayerOid } from '@/shared/types/model.ts'
import {
    CardResource,
    CryptCardResource,
    Disciplines,
    LibraryCardResource,
} from '@/shared/types/resources.ts'
import { gameResources } from '@/shared/registries.ts'
import { Snap } from '@/shared/utils.ts'

class MinionAttributes {
    capacity = 0 // capacity for vampire, starting life for allies
    disciplines = {} as Disciplines // Some allies can play card as a vampire with a discipline

    bleed = DEFAULT_CARD_ATTRS.Bleed
    stealth = DEFAULT_CARD_ATTRS.Stealth
    intercept = DEFAULT_CARD_ATTRS.Intercept
    strength = DEFAULT_CARD_ATTRS.Strength
    hunt = DEFAULT_CARD_ATTRS.Hunt
}

class VampireAttributes {
    clan = ''
    sect = ''
    title = ''
    vote = DEFAULT_CARD_ATTRS.Vote
    //traits: Trait[]
}

export function isCryptId(krcgId: KrcgId) {
    // Krcg id of crypt card begins by 2, library begins by 1
    return krcgId[0] == '2'
}

export abstract class Card extends BaseModel {
    x = 0 // This is relative to its container, with origin=0
    y = 0 // This is relative to its container, with origin=0
    isLocked = false
    isFlipped = false
    isCrypt: boolean // Used to show the correct backcard when we don't know the krcgId

    blood = 0
    greenCounter = 0

    markers = [] as string[]

    minionAttrs?: MinionAttributes
    vampireAttrs?: VampireAttributes

    protected constructor(
        public gameId: GameId,
        public oid: CardOid,
        public ownerOid: PlayerOid,
    ) {
        super(gameId, oid)
    }

    abstract get resource(): CardResource | undefined

    get krcgId(): KrcgId | undefined {
        return this.gameState.knownCards[this.oid]
    }

    get name() {
        return this.resource?.name ?? ''
    }

    get rulings() {
        return this.resource?.rulings ?? []
    }

    get text() {
        return this.resource?.text ?? ''
    }

    get owner() {
        return this.gameState.players[this.ownerOid]
    }

    // For now, there's no way to take control of another card
    get controllerOid() {
        return this.ownerOid
    }

    get controller() {
        return this.gameState.players[this.controllerOid]
    }

    get region() {
        return this.gameState.cardLocations[this.oid] ?? this.gameState.limboRegion
    }

    // Shortcuts to check this card's region
    get isIn() {
        return this.region.is
    }

    get position() {
        return this.region.indexOf(this)
    }

    isMinion(): this is Minion {
        return !!this.minionAttrs
    }

    isVampire(): this is Vampire {
        return !!this.vampireAttrs
    }

    becomeMinion() {
        if (!this.minionAttrs) {
            this.minionAttrs = new MinionAttributes()
        }
    }

    becomeVampire() {
        this.becomeMinion()
        if (!this.vampireAttrs) {
            this.vampireAttrs = new VampireAttributes()
        }
    }

    getPlayerVision() {
        return cardVisibility.getPlayerVision(this)
    }

    setCoordinates(x: number, y: number) {
        x = Snap.to(x, GRID_SIZE)
        y = Snap.to(y, GRID_SIZE)

        // If we overlap another card
        for (let i = 0; i < this.region.cards.length; i++) {
            const card = this.region.cards[i]
            if (card.x == x && card.y == y && card.oid != this.oid) {
                // In uncontrolled, only slide on the right
                if (this.isIn.uncontrolled) {
                    x += 9 * GRID_SIZE
                }
                // In other regions, slide on the corner
                else {
                    x += 2 * GRID_SIZE
                    y -= 2 * GRID_SIZE
                }
                // Re-run the loop from the start
                i = -1
            }
        }

        this.x = x
        this.y = y
    }

    lock() {
        this.isLocked = true
    }

    unlock() {
        this.isLocked = false
    }

    flip() {
        this.isFlipped = !this.isFlipped
    }

    changeBlood(amount: number) {
        this.blood = Math.max(0, this.blood + amount)
    }

    hasMarker(marker: Marker) {
        return this.markers.includes(marker)
    }

    // Shortcut to check for discipline
    hasDiscipline(discipline: Discipline, level: DisciplineLevel) {
        return (
            this.isMinion() &&
            this.minionAttrs.disciplines[discipline] &&
            this.minionAttrs.disciplines[discipline] >= level
        )
    }

    // Does the cards have a "during X phase" that apply in the current state ?
    isDuringCurrentPhase() {
        // Glow only card that are controlled and visible
        if (!this.isIn.controlled || !cardVisibility.anyoneCanSee(this)) {
            return false
        }

        const gameState = this.gameState
        const phase = gameState.turnPhase.toLowerCase()

        return (
            // Match "during each [...] phase"
            new RegExp(`during each(.)*${phase} phase`, 'i').test(this.text) ||
            // Match "during their [...] phase"
            (this.region.owner == gameState.activePlayer &&
                new RegExp(`during(.)*their(.)*${phase} phase`, 'i').test(this.text)) ||
            // Match "during your [...] phase"
            (this.controller == gameState.activePlayer &&
                new RegExp(`during your ${phase} phase`, 'i').test(this.text))
        )
    }
}

export class CryptCard extends Card {
    minionAttrs: MinionAttributes
    vampireAttrs: VampireAttributes
    isCrypt = true

    constructor(
        public gameId: GameId,
        public oid: CardOid,
        public ownerOid: PlayerOid,
    ) {
        super(gameId, oid, ownerOid)

        this.minionAttrs = new MinionAttributes()
        this.vampireAttrs = new VampireAttributes()

        // TODO : Finish the knownCards/resource
        if (this.krcgId && this.resource) {
            const cardResource = this.resource

            this.minionAttrs.capacity = cardResource.capacity
            this.minionAttrs.disciplines = { ...cardResource.disciplines } // Clone the disciplines object

            this.vampireAttrs.clan = cardResource.clan
            this.vampireAttrs.sect = cardResource.sect
            this.vampireAttrs.title = cardResource.title

            const implementation = CRYPT_CARD_IMPLEMENTATIONS[this.krcgId]
            implementation?.adapt(this)
        }
    }

    get resource(): CryptCardResource | undefined {
        if (!this.krcgId) {
            return undefined
        }
        const resource = gameResources.cardbase[this.krcgId]
        if (!resource) {
            throw new Error(`Crypt card ${this.krcgId} not found in Card Base`)
        }
        return resource as CryptCardResource
    }
}

export class LibraryCard extends Card {
    isCrypt = false

    constructor(
        public gameId: GameId,
        public oid: CardOid,
        public ownerOid: PlayerOid,
    ) {
        super(gameId, oid, ownerOid)

        // TODO : Finish the knownCards/resource
        if (this.resource && this.resource.type == LibraryCardType.Ally) {
            this.minionAttrs = new MinionAttributes()
        }
    }

    get resource(): LibraryCardResource | undefined {
        if (!this.krcgId) {
            return undefined
        }
        const resource = gameResources.cardbase[this.krcgId]
        if (!resource) {
            throw new Error(`Library card ${this.krcgId} not found in Card Base`)
        }
        return resource as LibraryCardResource
    }

    get type() {
        return this.resource?.type
    }

    get bloodCost() {
        return this.resource?.blood
    }

    get poolCost() {
        return this.resource?.pool
    }

    get clan() {
        return this.resource?.clan
    }

    get requirement() {
        return this.resource?.requirement
    }

    get disciplines(): string[] {
        return this.resource?.discipline.split('/') ?? []
    }
}

export type Minion = Card & { minionAttrs: MinionAttributes }
export type Vampire = Minion & { vampireAttrs: VampireAttributes }
