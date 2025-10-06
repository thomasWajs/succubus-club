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
import * as cardVisibility from '@/state/cardVisibility.ts'

// Alias to specify the expected objects through the codebase
export type CardOid = ObjectId

export type CardTexture = {
    textureName: string
    frameName?: string
}

class MinionAttributes {
    capacity = 0 // capacity for vampire, starting life for allies
    disciplines = {} as Disciplines // Some allies can play card as a vampire with a discipline

    bleed = 1
    stealth = 0
    intercept = 0
    strength = 1
    hunt = 1
}

class VampireAttributes {
    clan = ''
    sect = ''
    title = ''
    vote = 0
    //traits: Trait[]
}

export abstract class Card extends BaseModel {
    x = 0 // This is relative to its container, with origin=0
    y = 0 // This is relative to its container, with origin=0
    isLocked = false
    isFlipped = false

    blood = 0
    greenCounter = 0

    markers = [] as string[]

    minionAttrs?: MinionAttributes
    vampireAttrs?: VampireAttributes

    protected constructor(
        public oid: CardOid,
        public readonly krcgId: KrcgId,
        public controllerOid: PlayerOid,
    ) {
        super(oid)
    }

    abstract get resource(): CardResource

    get name() {
        return this.resource.name
    }

    get secureName() {
        return this.selfCanSeeOrPeek ? this.name : 'Hidden Card'
    }

    get controller() {
        return useGameStateStore().players[this.controllerOid]
    }

    get region() {
        return useGameStateStore().cardLocations[this.oid]
    }

    // Shortcuts to check this card's region
    get isIn() {
        const rName = this.region.name
        return {
            play: [RegionName.Ready, RegionName.Torpor, RegionName.Uncontrolled].includes(rName),
            controlled: [RegionName.Ready, RegionName.Torpor].includes(rName),
            ready: rName == RegionName.Ready,
            torpor: rName == RegionName.Torpor,
            uncontrolled: rName == RegionName.Uncontrolled,
            crypt: rName == RegionName.Crypt,
            library: rName == RegionName.Library,
            hand: rName == RegionName.Hand,
            ashHeap: rName == RegionName.AshHeap,
            removed: rName == RegionName.Removed,
        }
    }

    get position() {
        return this.region.indexOf(this)
    }

    get selfCanSee() {
        return cardVisibility.canSee(useGameStateStore().selfPlayer, this)
    }

    get selfCanSeeOrPeek() {
        return cardVisibility.canSeeOrPeek(useGameStateStore().selfPlayer, this)
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
        if (!this.minionAttrs) {
            this.minionAttrs = new MinionAttributes()
        }
        if (!this.vampireAttrs) {
            this.vampireAttrs = new VampireAttributes()
        }
    }

    getPlayerVision() {
        return cardVisibility.getPlayerVision(this)
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

    // Shortcut to check for discipline
    hasDiscipline(discipline: Discipline, level: DisciplineLevel) {
        return (
            this.isMinion() &&
            this.minionAttrs.disciplines[discipline] &&
            this.minionAttrs.disciplines[discipline] >= level
        )
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
        return this.selfCanSee ? this.texture : this.backTexture
    }
}

export class CryptCard extends Card {
    minionAttrs: MinionAttributes
    vampireAttrs: VampireAttributes

    constructor(
        public oid: CardOid,
        public readonly krcgId: KrcgId,
        public controllerOid: PlayerOid,
    ) {
        super(oid, krcgId, controllerOid)

        const cardResource = this.resource

        this.minionAttrs = new MinionAttributes()
        this.minionAttrs.capacity = cardResource.capacity
        this.minionAttrs.disciplines = { ...cardResource.disciplines } // Clone the disciplines object

        this.vampireAttrs = new VampireAttributes()
        this.vampireAttrs.clan = cardResource.clan
        this.vampireAttrs.sect = cardResource.sect
        this.vampireAttrs.title = cardResource.title

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

    get implementation(): CryptCardImplementation | undefined {
        return CRYPT_CARD_IMPLEMENTATIONS[this.krcgId]
    }
}

export class LibraryCard extends Card {
    disciplines = [] as string[]

    constructor(
        public oid: CardOid,
        public readonly krcgId: KrcgId,
        public controllerOid: PlayerOid,
    ) {
        super(oid, krcgId, controllerOid)

        this.disciplines = this.resource.discipline.split('/')

        if (this.resource.type == LibraryCardType.Ally) {
            this.minionAttrs = new MinionAttributes()
        }
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

    get implementation(): AllImplementationsType | undefined {
        return LIB_CARD_IMPLEMENTATIONS[this.krcgId]
    }
}

export type Minion = Card & { minionAttrs: MinionAttributes }
export type Vampire = Minion & { vampireAttrs: VampireAttributes }
