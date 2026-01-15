import { BaseModel, ObjectId } from '@/model/BaseModel.ts'
import { AnyCardRegion, CardRegion } from '@/model/CardRegion.ts'
import { CardRegionVisibility, RegionName } from '@/model/const.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { Card, CryptCard, LibraryCard, Minion, Vampire } from '@/model/Card.ts'
import Phaser from 'phaser'
import { PermanentId } from '@/multiplayer/types.ts'
import { BOT_PERM_ID } from '@/game/setup.ts'
import {
    DEFAULT_PLAYER_SCALE,
    HORIZONTAL_SEPARATOR_DEFAULT_Y,
    VERTICAL_SEPARATOR_DEFAULT_X,
} from '@/game/const.ts'

const PLAYER_NAME_LEGIBLE_LENGTH = 22

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
    // Ready contains both type of cards
    ready: CardRegion<Card>
}

export type Separators = {
    verticalX: number
    horizontalY: number
}

export class Player extends BaseModel {
    shortName: string

    constructor(
        public oid: PlayerOid,
        public permId: PermanentId,
        public cardRegions: PlayerCardRegions,
        public name: string,
        public rgbaColor: string,
        public pool: number,
        public victoryPoints = 0,
        public isOusted = false,
        public scale = DEFAULT_PLAYER_SCALE,
        public separators: Separators = {
            verticalX: VERTICAL_SEPARATOR_DEFAULT_X,
            horizontalY: HORIZONTAL_SEPARATOR_DEFAULT_Y,
        },
        // Not currently in use
        // public handSize = INITIAL_HAND_SIZE,
    ) {
        super(oid)
        if (name.length <= PLAYER_NAME_LEGIBLE_LENGTH) {
            this.shortName = this.name
        } else {
            this.shortName = `${this.name.substring(0, PLAYER_NAME_LEGIBLE_LENGTH - 2)}...`
        }
    }

    get secureName() {
        return this.name
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
            ready: new CardRegion(
                gameState.getNextOid(),
                RegionName.Ready,
                CardRegionVisibility.VisibleToAll,
            ),
        }
    }

    get isBot() {
        return this.permId.startsWith(BOT_PERM_ID)
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

    get ready() {
        return this.cardRegions.ready
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
        return this.ready.cards.filter(c => c.isMinion()) as Minion[]
    }

    get minionsReadyUnlocked() {
        return this.minionsReady.filter(c => !c.isLocked)
    }

    get minionsReadyLocked() {
        return this.minionsReady.filter(c => c.isLocked)
    }

    get vampiresReady() {
        return this.ready.cards.filter(c => c.isVampire()) as Vampire[]
    }

    get vampiresReadyUnlocked() {
        return this.vampiresReady.filter(c => !c.isLocked)
    }

    get vampiresReadyLocked() {
        return this.vampiresReady.filter(c => c.isLocked)
    }

    get vampiresInTorpor() {
        return this.torpor.cards.filter(c => c.isVampire()) as Vampire[]
    }

    get vampiresInUncontrolled() {
        return this.uncontrolled.cards.filter(c => c.isVampire()) as Vampire[]
    }

    changePool(amount: number) {
        const gameState = useGameStateStore()
        const nbCompetingPlayers = gameState.competingPlayers.length
        const activePlayerOid = gameState.activePlayer?.oid || -1
        const activePlayerTurnIndex = gameState.turnOrder.indexOf(activePlayerOid)
        const thisPlayerTurnIndex = gameState.turnOrder.indexOf(this.oid)
        const wasOusted = this.isOusted

        // De-oust this player ( e.g. : when cancelling an ousting mutation )
        if (wasOusted && this.pool == 0 && amount > 0) {
            this.isOusted = false
            if (this.predator) {
                // The last oust had given 2 VP
                this.predator.victoryPoints -= nbCompetingPlayers == 1 ? 2 : 1
            }

            // Update the activePlayerIndex if it's after the de-ousted player
            if (activePlayerTurnIndex > thisPlayerTurnIndex) {
                gameState.activePlayerIndex++
            }
        }

        this.pool = Math.max(0, this.pool + amount)

        // Oust this player
        if (this.pool == 0 && !wasOusted) {
            if (this.predator) {
                // The last oust gives 2 VP
                this.predator.victoryPoints += nbCompetingPlayers == 2 ? 2 : 1
            }
            this.isOusted = true

            // Update the activePLayerIndex if it's after the ousted player
            if (activePlayerTurnIndex >= thisPlayerTurnIndex) {
                gameState.activePlayerIndex--
            }
            // If ousted during our own turn, advance immediatly to the next turn
            if (activePlayerOid == this.oid) {
                gameState.changeTurn(gameState.turnNumber + 1)
            }
        }
    }
}
