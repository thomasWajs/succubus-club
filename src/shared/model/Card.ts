import { BaseModel } from '@/shared/model/BaseModel.ts'
import {
    DEFAULT_CARD_ATTRS,
    Discipline,
    DisciplineLevel,
    LibraryCardType,
    Marker,
    TITLE_BALLOTS,
    TITLE_VOTES,
} from '@/shared/const/model.ts'
import { CRYPT_CARD_IMPLEMENTATIONS } from '@/shared/cardImpl'
import * as cardVisibility from '@/shared/state/cardVisibility.ts'
import { GRID_SIZE } from '@/shared/const/game.ts'
import { KrcgId } from '@/shared/types/gateway.ts'
import { CardOid, GameId, ObjectId, PlayerOid } from '@/shared/types/model.ts'
import {
    CardResource,
    CryptCardResource,
    Disciplines,
    LibraryCardResource,
} from '@/shared/types/resources.ts'
import { gameResources } from '@/shared/registries.ts'

// Markers for hidden crypt cards in SCS mode :
// We know they are vampires, but can't know their attrs at init.
export const UNKNOWN_MINION_ATTRS = 'UNKNOWN_MINION_ATTRS' as const
export const UNKNOWN_VAMPIRE_ATTRS = 'UNKNOWN_VAMPIRE_ATTRS' as const

class MinionAttributes {
    capacity = 0 // capacity for vampire, starting life for allies
    disciplines = {} as Disciplines // Some allies can play card as a vampire with a discipline

    bleed = DEFAULT_CARD_ATTRS.Bleed
    stealth = DEFAULT_CARD_ATTRS.Stealth
    intercept = DEFAULT_CARD_ATTRS.Intercept
    strength = DEFAULT_CARD_ATTRS.Strength
}

class VampireAttributes {
    clan = ''
    sect = ''
    title = ''
    hunt = DEFAULT_CARD_ATTRS.Hunt
    vote = DEFAULT_CARD_ATTRS.Vote
    ballot = DEFAULT_CARD_ATTRS.Ballot
    //traits: Trait[]
}

export type PropertiesInPlay = {
    isLocked: boolean
    isFlipped: boolean
    blood: number
    greenCounter: number
    orangeCounter: number
    markers: string[]
}

export function isCryptId(krcgId: KrcgId | number) {
    // Krcg id of crypt card begins by 2, library begins by 1
    return krcgId.toString()[0] == '2'
}

export abstract class Card extends BaseModel implements PropertiesInPlay {
    x = 0 // This is relative to its container, with origin=0
    y = 0 // This is relative to its container, with origin=0
    isLocked = false
    isFlipped = false
    isCrypt: boolean // Used to show the correct backcard when we don't know the krcgId

    blood = 0
    greenCounter = 0
    orangeCounter = 0

    markers = [] as string[]

    minionAttrs?: MinionAttributes | typeof UNKNOWN_MINION_ATTRS
    vampireAttrs?: VampireAttributes | typeof UNKNOWN_VAMPIRE_ATTRS

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

    // For now, there's no way to explicitely take control of another card
    // For now, the controller is the owner of the region of the card.
    // Except for Master Cards, which most of the time stay under the control of their owner.
    get controllerOid(): ObjectId {
        if (this instanceof LibraryCard && this.resource?.type === LibraryCardType.Master) {
            return this.owner.oid
        }
        return this.region.owner?.oid ?? this.owner.oid
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

    get position(): number {
        return this.region.indexOf(this)
    }

    abstract initMinionAttrs(): void

    updatePropertiesInPlay(props: PropertiesInPlay) {
        Object.assign(this, props)
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
        // If we overlap another card
        for (let i = 0; i < this.region.cards.length; i++) {
            const card = this.region.cards[i]
            if (card.x == x && card.y == y && card.oid != this.oid) {
                // In uncontrolled, only slide on the right
                if (this.isIn.uncontrolled) {
                    x += 8 * GRID_SIZE
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
                new RegExp(`during your ${phase} phase`, 'i').test(this.text)) ||
            // Match "during this [...] phase"
            (this.controller == gameState.activePlayer &&
                new RegExp(`during this(.)*${phase} phase`, 'i').test(this.text))
        )
    }

    // Can this library card become a vampire by cardtext ( embrace-like )
    isEmbraceLike() {
        return new RegExp(`becomes a.*(\\d[ -]|same.*)capacity`, 'i').test(this.text)
    }

    // Can this card put a referendum to the table by cardtext ?
    canCallReferendum() {
        return new RegExp(`(can|may) call .* referendum`, 'i').test(this.text)
    }
}

export class CryptCard extends Card {
    minionAttrs: MinionAttributes | typeof UNKNOWN_MINION_ATTRS
    vampireAttrs: VampireAttributes | typeof UNKNOWN_VAMPIRE_ATTRS
    isCrypt = true

    constructor(
        public gameId: GameId,
        public oid: CardOid,
        public ownerOid: PlayerOid,
    ) {
        super(gameId, oid, ownerOid)

        // Markers for hidden crypt cards in SCS mode :
        // We know they are vampires, but can't know their attrs at init.
        this.minionAttrs = UNKNOWN_MINION_ATTRS
        this.vampireAttrs = UNKNOWN_VAMPIRE_ATTRS

        // SCS And Ably mode will know the resource from the start,
        // so we can init at creation for them.
        // Client in SCS mode will need to wait to know the card
        this.initMinionAttrs()
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

    initMinionAttrs() {
        if (!this.krcgId || !this.resource) {
            return
        }

        const cardResource = this.resource

        if (this.minionAttrs == UNKNOWN_MINION_ATTRS) {
            this.minionAttrs = new MinionAttributes()
            this.minionAttrs.capacity = cardResource.capacity
            this.minionAttrs.disciplines = { ...cardResource.disciplines } // Clone the disciplines object
        }

        if (this.vampireAttrs == UNKNOWN_VAMPIRE_ATTRS) {
            this.vampireAttrs = new VampireAttributes()
            this.vampireAttrs.clan = cardResource.clan
            this.vampireAttrs.sect = cardResource.sect
            this.vampireAttrs.title = cardResource.title
            this.vampireAttrs.vote = TITLE_VOTES[cardResource.title] ?? DEFAULT_CARD_ATTRS.Vote
            this.vampireAttrs.ballot =
                TITLE_BALLOTS[cardResource.title] ?? DEFAULT_CARD_ATTRS.Ballot
        }

        const implementation = CRYPT_CARD_IMPLEMENTATIONS[this.krcgId]
        implementation?.adapt(this)
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

        // SCS And Ably mode will know the resource from the start,
        // so we can init at creation for them.
        // Client in SCS mode will need to wait to know the card
        this.initMinionAttrs()
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

    // Stealth granted when the card text opens with e.g. "+1 stealth action",
    // or null when it has no such prefix. Used to infer an action's stealth for
    // the ~4000 cards that have no hand-written implementation. Stealth granted
    // only at inf / sup is ignored for now.
    get textStealth(): number | null {
        const match = this.text.match(/^\s*\+(\d+)\s+stealth\s+action\b/i)
        return match ? Number(match[1]) : null
    }

    initMinionAttrs() {
        if (!this.resource) {
            return
        }

        if (!this.minionAttrs && this.resource.type == LibraryCardType.Ally) {
            this.minionAttrs = new MinionAttributes()
        }
    }
}

export type Minion = Card & { minionAttrs: MinionAttributes }
export type Vampire = Minion & { vampireAttrs: VampireAttributes }
