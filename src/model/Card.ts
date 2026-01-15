import Phaser from 'phaser'
import { BaseModel, ObjectId } from '@/model/BaseModel.ts'
import { GRID_SIZE } from '@/game/const.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import {
    ATLAS_FREQUENT,
    CardResource,
    CryptCardResource,
    Disciplines,
    gameResources,
    isCryptId,
    KrcgId,
    LibraryCardResource,
} from '@/resources/cards.ts'
import {
    ACTION_TYPES,
    DEFAULT_CARD_ATTRS,
    Discipline,
    DisciplineLevel,
    LibraryCardType,
    Marker,
    TurnPhase,
} from '@/model/const.ts'
import { useGameBusStore } from '@/store/bus.ts'
import { CRYPT_CARD_IMPLEMENTATIONS } from '@/resources/cardImpl'
import { PlayerOid } from '@/model/Player.ts'
import { useCoreStore } from '@/store/core.ts'
import * as cardVisibility from '@/state/cardVisibility.ts'
import { anyoneCanSee } from '@/state/cardVisibility.ts'
import { GameType } from '@/state/types.ts'
import { Texture } from '@/resources/textures.ts'

// Alias to specify the expected objects through the codebase
export type CardOid = ObjectId

export type CardTexture = {
    textureName: string
    frameName?: string
}

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

export abstract class Card extends BaseModel {
    x = 0 // This is relative to its container, with origin=0
    y = 0 // This is relative to its container, with origin=0
    isLocked = false
    isFlipped = false

    blood = 0
    greenCounter = 0

    markers = [] as string[]

    /**
     * Currently, the attrs are not used in multiplayer.
     * So we're not actually setting them to save on bandwidth/storage,
     * but we still set an empty object as marker to know which card is a minion/vampire.
     */
    minionAttrs?: MinionAttributes | Record<string, never>
    vampireAttrs?: VampireAttributes | Record<string, never>

    protected constructor(
        public oid: CardOid,
        public readonly krcgId: KrcgId,
        public ownerOid: PlayerOid,
    ) {
        super(oid)
    }

    abstract get resource(): CardResource

    get isCrypt() {
        return isCryptId(this.krcgId)
    }

    get name() {
        return this.resource.name
    }

    get secureName() {
        return this.selfCanSeeOrPeek ? this.name : 'Hidden Card'
    }

    get rulings() {
        return this.resource.rulings
    }

    get text() {
        return this.resource.text
    }

    get owner() {
        return useGameStateStore().players[this.ownerOid]
    }

    // For now, there's no way to take control of another card
    get controllerOid() {
        return this.ownerOid
    }

    get controller() {
        return useGameStateStore().players[this.controllerOid]
    }

    get region() {
        return useGameStateStore().cardLocations[this.oid]
    }

    // Shortcuts to check this card's region
    get isIn() {
        return this.region.is
    }

    get position() {
        return this.region.indexOf(this)
    }

    get selfCanSee() {
        const gameState = useGameStateStore()
        return gameState.selfPlayer ?
                cardVisibility.canSee(gameState.selfPlayer, this)
            :   anyoneCanSee(this)
    }

    get selfCanSeeOrPeek() {
        const gameState = useGameStateStore()
        return gameState.selfPlayer ?
                cardVisibility.canSeeOrPeek(gameState.selfPlayer, this)
            :   anyoneCanSee(this)
    }

    isMinion(): this is Minion {
        return !!this.minionAttrs
    }

    isVampire(): this is Vampire {
        return !!this.vampireAttrs
    }

    becomeMinion() {
        if (!this.minionAttrs) {
            if (useCoreStore().gameType == GameType.TrainBot) {
                this.minionAttrs = new MinionAttributes()
            } else {
                this.minionAttrs = {}
            }
        }
    }

    becomeVampire() {
        this.becomeMinion()
        if (!this.vampireAttrs) {
            if (useCoreStore().gameType == GameType.TrainBot) {
                this.vampireAttrs = new VampireAttributes()
            } else {
                this.vampireAttrs = {}
            }
        }
    }

    getPlayerVision() {
        return cardVisibility.getPlayerVision(this)
    }

    setCoordinates(x: number, y: number) {
        x = Phaser.Math.Snap.To(x, GRID_SIZE)
        y = Phaser.Math.Snap.To(y, GRID_SIZE)

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

    isSelected() {
        return useGameBusStore().selectedCards.includes(this)
    }

    // Does the cards have a "during X phase" that apply in the current state ?
    isDuringCurrentPhase() {
        // Glow only card that are controlled and visible
        if (!this.isIn.controlled || !this.selfCanSee) {
            return false
        }

        const gameState = useGameStateStore()
        const text = this.resource.text
        const phase = gameState.turnPhase.toLowerCase()

        return (
            // Match "during each [...] phase"
            new RegExp(`during each(.)*${phase} phase`, 'i').test(text) ||
            // Match "during their [...] phase"
            (this.region.owner == gameState.activePlayer &&
                new RegExp(`during(.)*their(.)*${phase} phase`, 'i').test(text)) ||
            // Match "during your [...] phase"
            (this.controller == gameState.activePlayer &&
                new RegExp(`during your ${phase} phase`, 'i').test(text))
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

export default Card

export class CryptCard extends Card {
    minionAttrs: MinionAttributes | Record<string, never>
    vampireAttrs: VampireAttributes | Record<string, never>

    constructor(
        public oid: CardOid,
        public readonly krcgId: KrcgId,
        public ownerOid: PlayerOid,
    ) {
        super(oid, krcgId, ownerOid)

        const cardResource = this.resource

        // Not used in multiplayer ( yet? )
        if (useCoreStore().gameType == GameType.TrainBot) {
            this.minionAttrs = new MinionAttributes()
            this.minionAttrs.capacity = cardResource.capacity
            this.minionAttrs.disciplines = { ...cardResource.disciplines } // Clone the disciplines object

            this.vampireAttrs = new VampireAttributes()
            this.vampireAttrs.clan = cardResource.clan
            this.vampireAttrs.sect = cardResource.sect
            this.vampireAttrs.title = cardResource.title
        } else {
            this.minionAttrs = {}
            this.vampireAttrs = {}
        }

        const implementation = CRYPT_CARD_IMPLEMENTATIONS[this.krcgId]
        implementation?.adapt(this)
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
            textureName: Texture.CardbackCrypt,
        }
    }
}

export class LibraryCard extends Card {
    disciplines = [] as string[]

    constructor(
        public oid: CardOid,
        public readonly krcgId: KrcgId,
        public ownerOid: PlayerOid,
    ) {
        super(oid, krcgId, ownerOid)

        // Not used in multiplayer ( yet? )
        if (useCoreStore().gameType == GameType.TrainBot) {
            this.disciplines = this.resource.discipline.split('/')

            if (this.resource.type == LibraryCardType.Ally) {
                this.minionAttrs = new MinionAttributes()
            }
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

    get backTexture() {
        return {
            textureName: Texture.CardbackLibrary,
        }
    }

    isPlayable() {
        const gameState = useGameStateStore()
        const resource = this.resource
        // A card may have multiples types, we must check each of them
        const types = resource.type.split('/') as LibraryCardType[]
        for (const type of types) {
            if (
                (gameState.selfIsActive &&
                    ((gameState.turnPhase == TurnPhase.Master && type == LibraryCardType.Master) ||
                        (gameState.turnPhase == TurnPhase.Minion &&
                            (ACTION_TYPES.includes(type) ||
                                type == LibraryCardType.ActionModifier)) ||
                        (gameState.turnPhase == TurnPhase.Discard &&
                            type == LibraryCardType.Event))) ||
                (!gameState.selfIsActive &&
                    gameState.turnPhase == TurnPhase.Minion &&
                    type == LibraryCardType.Reaction) ||
                (gameState.turnPhase == TurnPhase.Minion && type == LibraryCardType.Combat)
            ) {
                return true
            }
        }
        return false
    }
}

export type Minion = Card & { minionAttrs: MinionAttributes }
export type Vampire = Minion & { vampireAttrs: VampireAttributes }
