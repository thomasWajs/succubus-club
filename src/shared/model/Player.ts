import { BaseModel } from '@/shared/model/BaseModel.ts'
import { CardRegion } from '@/shared/model/CardRegion.ts'
import {
    CardRegionVisibility,
    PLAYER_NAME_LEGIBLE_LENGTH,
    RegionName,
} from '@/shared/const/model.ts'
import { CryptCard, LibraryCard, Minion, Vampire } from '@/shared/model/Card.ts'
import { PermanentId } from '@/shared/types/multiplayer.ts'
import {
    DEFAULT_PLAYER_SCALE,
    HORIZONTAL_SEPARATOR_DEFAULT_Y,
    VERTICAL_SEPARATOR_DEFAULT_X,
} from '@/shared/const/game.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { generateCardRegionOid } from '@/shared/state/ids.ts'
import { BOT_PERM_ID } from '@/shared/const/bot.ts'
import {
    AnyCardRegion,
    GameId,
    PlayerCardRegions,
    PlayerOid,
    Separators,
} from '@/shared/types/model.ts'

export class Player extends BaseModel {
    shortName: string

    constructor(
        public gameId: GameId,
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
        super(gameId, oid)
        if (name.length <= PLAYER_NAME_LEGIBLE_LENGTH) {
            this.shortName = this.name
        } else {
            this.shortName = `${this.name.substring(0, PLAYER_NAME_LEGIBLE_LENGTH - 2)}...`
        }
    }

    static createCardRegions(gameState: GameState): PlayerCardRegions {
        const gameId = gameState.gameId
        return {
            library: new CardRegion<LibraryCard>(
                gameId,
                generateCardRegionOid(),
                RegionName.Library,
                CardRegionVisibility.Hidden,
            ),
            crypt: new CardRegion<CryptCard>(
                gameId,
                generateCardRegionOid(),
                RegionName.Crypt,
                CardRegionVisibility.Hidden,
            ),
            ashHeap: new CardRegion(
                gameId,
                generateCardRegionOid(),
                RegionName.AshHeap,
                CardRegionVisibility.VisibleToAll,
            ),
            removed: new CardRegion(
                gameId,
                generateCardRegionOid(),
                RegionName.Removed,
                CardRegionVisibility.VisibleToAll,
            ),
            hand: new CardRegion<LibraryCard>(
                gameId,
                generateCardRegionOid(),
                RegionName.Hand,
                CardRegionVisibility.VisibleToController,
            ),
            uncontrolled: new CardRegion(
                gameId,
                generateCardRegionOid(),
                RegionName.Uncontrolled,
                CardRegionVisibility.VisibleToController,
            ),
            torpor: new CardRegion(
                gameId,
                generateCardRegionOid(),
                RegionName.Torpor,
                CardRegionVisibility.VisibleToAll,
            ),
            ready: new CardRegion(
                gameId,
                generateCardRegionOid(),
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

    get prey(): Player | undefined {
        const gameState = this.gameState
        if (gameState.competingPlayers.length <= 1) {
            return undefined
        }
        return gameState.competingPlayers[
            (gameState.competingPlayers.indexOf(this) + 1) % gameState.competingPlayers.length
        ]
    }

    get predator(): Player | undefined {
        const gameState = this.gameState
        if (gameState.competingPlayers.length <= 1) {
            return undefined
        }
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
        const nbCompetingPlayers = this.gameState.competingPlayers.length
        const activePlayerOid = this.gameState.activePlayer?.oid ?? ''
        const activePlayerTurnIndex = this.gameState.turnOrder.indexOf(activePlayerOid)
        const thisPlayerTurnIndex = this.gameState.turnOrder.indexOf(this.oid)
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
                this.gameState.activePlayerIndex++
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
                this.gameState.activePlayerIndex--
            }
            // If ousted during our own turn, advance immediatly to the next turn
            if (activePlayerOid == this.oid) {
                this.gameState.changeTurn(this.gameState.turnNumber + 1)
            }
        }
    }
}
