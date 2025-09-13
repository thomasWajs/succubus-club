import Phaser from 'phaser'
import { BaseModel, ObjectId } from '@/model/BaseModel.ts'
import { BACK_TEXTURE_CRYPT, BACK_TEXTURE_LIB, GRID_SIZE } from '@/game/const.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import {
    KrcgId,
    CardResource,
    CryptCardResource,
    Disciplines,
    gameResources,
    LibraryCardResource,
    ATLAS_FREQUENT,
} from '@/resources/cards.ts'
import {
    ACTION_TYPES,
    CardRegionVisibility,
    Discipline,
    DisciplineLevel,
    LibraryCardType,
    Marker,
    RegionName,
    TurnPhase,
} from '@/model/const.ts'
import { useGameBusStore } from '@/store/bus.ts'
import {
    AllImplementationsType,
    CRYPT_CARD_IMPLEMENTATIONS,
    LIB_CARD_IMPLEMENTATIONS,
} from '@/resources/cardImpl'
import { CryptCardImplementation } from '@/resources/cardImpl/base.ts'
import { PlayerOid } from '@/model/Player.ts'
import { useCoreStore } from '@/store/core.ts'

// Alias to specify the expected objects through the codebase
export type CardOid = ObjectId

export type CardTexture = {
    textureName: string
    frameName?: string
}

export abstract class Card extends BaseModel {
    x = 0 // This is relative to its container, with origin=0
    y = 0 // This is relative to its container, with origin=0
    isLocked = false
    isFlipped = false
    blood = 0
    greenCounter = 0

    markers = [] as Marker[]

    constructor(
        public oid: CardOid,
        public readonly krcgId: KrcgId,
        public controllerOid: PlayerOid,
    ) {
        super(oid)
    }

    abstract get resource(): CardResource

    abstract get cssClass(): string

    get name() {
        return this.resource.name
    }

    get secureName() {
        return this.canSeeOrPeak() ? this.name : 'Hidden Card'
    }

    get controller() {
        return useGameStateStore().players[this.controllerOid]
    }

    get region() {
        return useGameStateStore().cardLocations[this.oid]
    }

    get position() {
        return this.region.indexOf(this)
    }

    get isRevealedToSelf() {
        const gameState = useGameStateStore()
        const revelation = gameState.revelations[this.oid] ?? {}
        return revelation.all || revelation[gameState.selfPlayer.oid]
    }

    setCoordinates(x: number, y: number) {
        x = Phaser.Math.Snap.To(x, GRID_SIZE)
        y = Phaser.Math.Snap.To(y, GRID_SIZE)

        // If we overlap another card, slide us on the corner
        for (let i = 0; i < this.region.cards.length; i++) {
            const card = this.region.cards[i]
            if (card.x == x && card.y == y && card.oid != this.oid) {
                x += GRID_SIZE
                y -= GRID_SIZE
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

    canSee() {
        // Flipping a Card allow only to hide it while in play ( or uncontrolled, for banishment ),
        // not to mess with visibility in all regions
        if (
            this.isFlipped &&
            [RegionName.Controlled, RegionName.Torpor, RegionName.Uncontrolled].includes(
                this.region.name,
            )
        ) {
            return false
        }

        // Check revelations
        if (this.region.isRevealedToSelf || this.isRevealedToSelf) {
            // CardRegion or Card was revealed, we can see the Card.
            return true
        }

        // No revelations, let's check normal visibility rules
        return (
            this.region.visibility == CardRegionVisibility.VisibleToAll ||
            (this.region.visibility == CardRegionVisibility.VisibleToController &&
                this.controllerOid == useGameStateStore().selfPlayer.oid)
        )
    }

    canPeek() {
        return (
            this.region.visibility != CardRegionVisibility.Hidden &&
            this.controllerOid == useGameStateStore().selfPlayer.oid
        )
    }

    canSeeOrPeak() {
        return this.canSee() || this.canPeek()
    }

    isSelected() {
        return useGameBusStore().selectedCards.includes(this)
    }

    isUsable() {
        const gameState = useGameStateStore()
        const resource = this.resource as LibraryCardResource
        return (
            (gameState.selfIsActive &&
                gameState.turnPhase == TurnPhase.Master &&
                resource.type == LibraryCardType.Master) ||
            (gameState.selfIsActive &&
                gameState.turnPhase == TurnPhase.Minion &&
                ACTION_TYPES.includes(resource.type)) ||
            (gameState.selfIsActive &&
                gameState.turnPhase == TurnPhase.Discard &&
                resource.type == LibraryCardType.Event) ||
            (!gameState.selfIsActive &&
                gameState.turnPhase == TurnPhase.Minion &&
                resource.type == LibraryCardType.Reaction)
        )
    }

    abstract get backTexture(): CardTexture

    get texture(): CardTexture {
        const core = useCoreStore()
        const frequentCards = core.phaserGame.textures.get(ATLAS_FREQUENT).getFrameNames()
        if (frequentCards.includes(this.resource.imageName)) {
            return {
                textureName: ATLAS_FREQUENT,
                frameName: this.resource.imageName,
            }
        } else {
            return {
                textureName: this.resource.imageName,
            }
        }
    }

    get displayedTexture() {
        return this.canSee() ? this.texture : this.backTexture
    }
}

export abstract class Minion extends Card {
    capacity: number // capacity for vampire, starting life for allies
    disciplines: Disciplines // Somme allies can play card as a vampire with a discipline

    bleed: number
    stealth: number
    intercept: number
    strength: number
    hunt: number

    // Shortcut to check for discipline
    hasDiscipline(discipline: Discipline, level: DisciplineLevel) {
        const vampireLevel = this.disciplines[discipline]
        return vampireLevel && vampireLevel >= level
    }

    // TODO : handle aggravated, handle wounded, handle going to torpor for vampire or burn for allies
    inflictDamage(amountRegular: number, amountAggravated: number = 0) {
        this.blood -= amountRegular
        this.blood -= amountAggravated
    }
}

export abstract class Vampire extends Minion {
    clan: string
    sect: string

    title: string
    //traits: Trait[]
}

export class CryptCard extends Vampire {
    disciplines = {} as Disciplines
    capacity = 0
    clan = ''
    sect = ''
    bleed = 1
    stealth = 0
    intercept = 0
    strength = 1
    hunt = 1
    vote = 0

    constructor(
        public oid: CardOid,
        public readonly krcgId: KrcgId,
        public controllerOid: PlayerOid,
    ) {
        super(oid, krcgId, controllerOid)

        const cardResource = this.resource

        // Clone the disciplines object
        this.disciplines = { ...cardResource.disciplines }

        this.capacity = cardResource.capacity
        this.clan = cardResource.clan
        this.sect = cardResource.sect

        this.title = cardResource.title

        this.implementation?.adapt(this)
    }

    get resource() {
        const resource = gameResources.cardbase[this.krcgId]
        if (!resource) {
            throw new Error(`Crypt card ${this.krcgId} not found in Card Base`)
        }
        return resource as CryptCardResource
    }

    get backTexture() {
        return {
            textureName: BACK_TEXTURE_CRYPT,
        }
    }

    get cssClass() {
        return 'cryptCard'
    }

    get implementation(): CryptCardImplementation | undefined {
        return CRYPT_CARD_IMPLEMENTATIONS[this.krcgId]
    }
}

export class LibraryCard extends Card {
    disciplines = [] as string[]
    //sect = ""
    //title = []

    constructor(
        public oid: CardOid,
        public readonly krcgId: KrcgId,
        public controllerOid: PlayerOid,
    ) {
        super(oid, krcgId, controllerOid)

        this.disciplines = this.resource.discipline.split('/')
    }

    get resource() {
        const resource = gameResources.cardbase[this.krcgId]
        if (!resource) {
            throw new Error(`Library card ${this.krcgId} not found in Card Base`)
        }
        return resource as LibraryCardResource
    }

    get type() {
        return this.resource.type
    }

    get bloodCost() {
        return this.resource.blood
    }

    get poolCost() {
        return this.resource.pool
    }

    get clan() {
        return this.resource.clan
    }

    get requirement() {
        return this.resource.requirement
    }

    /*
    get text() {
        return this.resource.text
    }
     */

    get backTexture() {
        return {
            textureName: BACK_TEXTURE_LIB,
        }
    }

    get cssClass() {
        return 'libCard'
    }

    get implementation(): AllImplementationsType | undefined {
        return LIB_CARD_IMPLEMENTATIONS[this.krcgId]
    }
}

export type AnyCard = LibraryCard | CryptCard
