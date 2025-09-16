import { BaseModel, ObjectId } from '@/model/BaseModel.ts'
import { AnyCardRegion, CardRegion } from '@/model/CardRegion.ts'
import { CardRegionVisibility, INITIAL_HAND_SIZE, RegionName } from '@/model/const.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { Card, CryptCard, LibraryCard, Minion, Vampire } from '@/model/Card.ts'
import Phaser from 'phaser'
import { PermanentId } from '@/multiplayer/common.ts'

// Alias to specify the expected objects through the codebase
export type PlayerOid = ObjectId

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
    // Controlled contains both type of cards
    controlled: CardRegion<Card>
}

export class Player extends BaseModel {
    constructor(
        public oid: PlayerOid,
        public permId: PermanentId,
        public cardRegions: PlayerCardRegions,
        public name: string,
        public rgbaColor: string,
        public pool: number,
        public victoryPoints = 0,
        public isOusted = false,
        public handSize = INITIAL_HAND_SIZE,
    ) {
        super(oid)
    }

    static createCardRegions(): PlayerCardRegions {
        const gameState = useGameStateStore()
        return {
            library: new CardRegion<LibraryCard>(
                gameState.getNextOid(),
                RegionName.Library,
                CardRegionVisibility.Hidden,
            ),
            crypt: new CardRegion<CryptCard>(
                gameState.getNextOid(),
                RegionName.Crypt,
                CardRegionVisibility.Hidden,
            ),
            ashHeap: new CardRegion(
                gameState.getNextOid(),
                RegionName.AshHeap,
                CardRegionVisibility.VisibleToAll,
            ),
            removed: new CardRegion(
                gameState.getNextOid(),
                RegionName.Removed,
                CardRegionVisibility.VisibleToAll,
            ),
            hand: new CardRegion<LibraryCard>(
                gameState.getNextOid(),
                RegionName.Hand,
                CardRegionVisibility.VisibleToController,
            ),
            uncontrolled: new CardRegion(
                gameState.getNextOid(),
                RegionName.Uncontrolled,
                CardRegionVisibility.VisibleToController,
            ),
            torpor: new CardRegion(
                gameState.getNextOid(),
                RegionName.Torpor,
                CardRegionVisibility.VisibleToAll,
            ),
            controlled: new CardRegion(
                gameState.getNextOid(),
                RegionName.Controlled,
                CardRegionVisibility.VisibleToAll,
            ),
        }
    }

    /**
     * Shorthands to save some typing in other parts of the codebase
     */
    get library() {
        return this.cardRegions.library
    }

    get crypt() {
        return this.cardRegions.crypt
    }

    get ashHeap() {
        return this.cardRegions.ashHeap
    }

    get removed() {
        return this.cardRegions.removed
    }

    get hand() {
        return this.cardRegions.hand
    }

    get uncontrolled() {
        return this.cardRegions.uncontrolled
    }

    get torpor() {
        return this.cardRegions.torpor
    }

    get controlled() {
        return this.cardRegions.controlled
    }

    get allCardRegions(): AnyCardRegion[] {
        return Object.values(this.cardRegions)
    }

    get color() {
        return Phaser.Display.Color.RGBStringToColor(this.rgbaColor)
    }

    get prey(): Player | undefined {
        const gameState = useGameStateStore()
        return gameState.competingPlayers[
            (gameState.competingPlayers.indexOf(this) + 1) % gameState.competingPlayers.length
        ]
    }

    get predator(): Player | undefined {
        const gameState = useGameStateStore()
        // + gameState.turnOrder.length is here to fix js modulo bug
        return gameState.competingPlayers[
            (gameState.competingPlayers.indexOf(this) - 1 + gameState.competingPlayers.length) %
                gameState.competingPlayers.length
        ]
    }

    get minionsReady() {
        return this.controlled.cards.filter(c => c instanceof Minion) as Minion[]
    }

    get minionsReadyUnlocked() {
        return this.minionsReady.filter(c => !c.isLocked)
    }

    get minionsReadyLocked() {
        return this.minionsReady.filter(c => c.isLocked)
    }

    get vampiresReady() {
        return this.controlled.cards.filter(c => c instanceof Minion) as Vampire[]
    }

    get vampiresReadyUnlocked() {
        return this.vampiresReady.filter(c => !c.isLocked)
    }

    get vampiresReadyLocked() {
        return this.vampiresReady.filter(c => c.isLocked)
    }

    get vampiresInTorpor() {
        return this.torpor.cards.filter(c => c instanceof Vampire) as Vampire[]
    }

    get vampiresInUncontrolled() {
        return this.uncontrolled.cards as Vampire[]
    }

    changePool(amount: number) {
        if (this.pool == 0 && amount > 0) {
            this.isOusted = false
            if (this.predator) {
                this.predator.victoryPoints--
            }
        }

        this.pool = Math.max(0, this.pool + amount)

        if (this.pool <= 0) {
            this.isOusted = true
            if (this.predator) {
                this.predator.victoryPoints++
            }
        }
    }
}
