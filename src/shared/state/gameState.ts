import { Card, CryptCard, LibraryCard } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { BaseModel } from '@/shared/model/BaseModel.ts'
import {
    CardRegionVisibility,
    DEFAULT_DPA,
    DEFAULT_MPA,
    DEFAULT_TRANSFERS,
    INITIAL_POOL,
    RegionName,
    TurnSequence,
} from '@/shared/const/model.ts'
import {
    ActionState,
    CardRevelation,
    CardRevelationTargetOid,
    CombatState,
    GameType,
    KnownCards,
    ReferendumState,
    TargetDeclaration,
} from '@/shared/types/state.ts'
import { PermanentId } from '@/shared/types/multiplayer.ts'
import { generateCardOid, generatePlayerOid } from '@/shared/state/ids.ts'
import {
    AnyCardRegion,
    CardOid,
    CardRegionOid,
    GameId,
    ObjectId,
    PlayerOid,
} from '@/shared/types/model.ts'
import { KrcgId } from '@/shared/types/gateway.ts'
import { CardRegion } from '@/shared/model/CardRegion.ts'

export class GameState {
    gameId: GameId = ''
    gameType: GameType = GameType.Unset
    isStrictGame: boolean = false

    /** Main objects **/
    players: Record<PlayerOid, Player> = {}
    cards: Record<CardOid, Card> = {}
    // The cards known by the running service.
    // The server knows them all.
    // In Ably mode, the client knows them all.
    // In SCS mode, the client only knows the cards it has seen.
    knownCards: KnownCards = {}
    // Cards that have been reassigned to a new id. Keep them just for deserialization
    staleCards: Record<CardOid, Card> = {}

    /**
     * Allow to match Users to their Player when loading a gameState
     * ( Resync, Reconnect, Game loading... )
     */
    usersToPlayer: Record<PermanentId, PlayerOid> = {}

    /** Turn / Phase **/
    turnOrder: PlayerOid[] = [] // Turn order at the start of the game, not impacted by ousted players
    activePlayerIndex: number = 0 // Index into state.competingPlayers
    turnNumber: number = 1
    turnPhaseIndex: number = 0

    /** Revelations **/
    revelations: Record<CardRevelationTargetOid, CardRevelation> = {}

    /** The edge **/
    theEdgeControllerOid: PlayerOid | undefined = undefined

    /** Target Declaration **/
    targetDeclarations: TargetDeclaration[] = []

    /** Timer **/
    timerStartTime: number | null = null // Date.now() when timer started (null = no timer)
    timerIsPaused: boolean = true
    timerPausedAt: number | null = null // Date.now() when last paused
    timerTotalPausedMs: number = 0 // Accumulated pause duration in ms

    /** Resources for the bot **/
    turnResources = {
        mpa: DEFAULT_MPA, // masterPhaseActions
        transfers: 1,
        dpa: DEFAULT_DPA, // discardPhaseActions
    }

    /** Action and combat state for the bot **/
    action: ActionState | null = null
    combat: CombatState | null = null

    /** Referendum state **/
    referendum: ReferendumState | null = null

    // Getters

    /**
     * All instances of BaseModel in the game state
     * ObjectId -> Card | Player | CardRegion
     */
    get allStateObjects(): Record<ObjectId, BaseModel> {
        return {
            ...this.players,
            ...this.cards,
            ...this.cardRegions,
        }
    }

    /**
     * All CardRegion in the game state
     * CardRegionOid => Card Region
     */
    get cardRegions(): Record<CardRegionOid, AnyCardRegion> {
        const regions = {} as Record<CardRegionOid, AnyCardRegion>
        for (const player of this.orderedPlayers) {
            for (const cardRegion of player.allCardRegions) {
                regions[cardRegion.oid] = cardRegion
            }
        }
        return regions
    }

    /**
     * An empty region, to serve as "void" placeholder for detached cards
     */
    get limboRegion(): AnyCardRegion {
        return new CardRegion(this.gameId, 'limbo', RegionName.Limbo, CardRegionVisibility.Hidden)
    }

    /**
     * Tells in which CardRegion each card is located
     * cardOid ==> Card Region
     */
    get cardLocations(): Record<CardOid, AnyCardRegion> {
        const locations: Record<CardOid, AnyCardRegion> = {}

        for (const cardRegion of Object.values(this.cardRegions)) {
            for (const card of cardRegion.cards) {
                locations[card.oid] = cardRegion
            }
        }
        return locations
    }

    /**
     * Tells which Player own each CardRegion
     * CardRegionOid ==> Player
     */
    get regionOwners(): Record<CardRegionOid, Player> {
        const owners: Record<CardRegionOid, Player> = {}

        for (const player of this.orderedPlayers) {
            for (const cardRegion of player.allCardRegions) {
                owners[cardRegion.oid] = player
            }
        }
        return owners
    }

    // Cards with an effect in the current phase
    get cardsDuringCurrentPhase(): Card[] {
        return Object.values(this.cards).filter(card => card.isDuringCurrentPhase())
    }

    get turnPhase() {
        return TurnSequence[this.turnPhaseIndex]
    }

    get theEdgeController(): Player | undefined {
        return this.theEdgeControllerOid ? this.players[this.theEdgeControllerOid] : undefined
    }

    /**
     * Players getters
     */

    // Not impacted by ousted players
    get orderedPlayers(): Player[] {
        return this.turnOrder.map(playerOid => this.players[playerOid])
    }

    // Non-ousted ordered players
    get competingPlayers(): Player[] {
        return this.orderedPlayers.filter(player => !player.isOusted)
    }

    get activePlayer(): Player | undefined {
        return this.competingPlayers[this.activePlayerIndex]
    }

    /**
     * Methods / store actions
     */

    createPlayer(name: string, rgbaColor: string, permId: PermanentId): Player {
        const player = new Player(
            this.gameId,
            generatePlayerOid(),
            permId,
            Player.createCardRegions(this),
            name,
            rgbaColor,
            INITIAL_POOL,
        )
        this.players[player.oid] = player
        this.turnOrder.push(player.oid)
        return player
    }

    createCryptCard(krcgId: KrcgId, owner: Player, cardRegion: AnyCardRegion): CryptCard {
        const cardOid = generateCardOid()
        this.knownCards[cardOid] = krcgId
        const card = new CryptCard(this.gameId, cardOid, owner.oid)
        this.cards[card.oid] = card
        cardRegion.append(card)
        return card
    }

    createLibraryCard(krcgId: KrcgId, owner: Player, cardRegion: AnyCardRegion): LibraryCard {
        const cardOid = generateCardOid()
        this.knownCards[cardOid] = krcgId
        const card = new LibraryCard(this.gameId, cardOid, owner.oid)
        this.cards[card.oid] = card
        cardRegion.append(card)
        return card
    }

    moveCardToRegion(card: Card, to: AnyCardRegion, position: number = 0) {
        if (to.cardsOid.includes(card.oid)) {
            // Card is already there, nothing to do
            return { leftPlay: false }
        }

        const wasInPlay = card.isIn.play

        card.region.remove(card)
        to.insert(card, position)

        const leftPlay = wasInPlay && !card.isIn.play

        if (leftPlay) {
            card.updatePropertiesInPlay({
                isLocked: false,
                isFlipped: false,
                blood: 0,
                greenCounter: 0,
                orangeCounter: 0,
                markers: [],
            })
        }

        return { leftPlay }
    }

    setNewTurnResources(): void {
        // standard game use 1/2/3/4 transfers for the first 4 turns.
        // 2-player games use 3/4 transfers for the first 2 turns.
        const nbPlayers = this.orderedPlayers.length
        const transfers = Math.min(DEFAULT_TRANSFERS, this.turnNumber + (nbPlayers == 2 ? 2 : 0))
        this.turnResources = {
            mpa: DEFAULT_MPA,
            transfers,
            dpa: DEFAULT_DPA,
        }
    }

    changeTurn(newTurnNumber: number): void {
        // The turn didn't change, nothing to do
        if (newTurnNumber == this.turnNumber) {
            return
        } else {
            // Will normally be 1 or -1
            const delta = newTurnNumber - this.turnNumber
            this.turnNumber = newTurnNumber
            this.activePlayerIndex =
                (this.activePlayerIndex + delta + this.competingPlayers.length) %
                this.competingPlayers.length

            // Forward
            if (delta > 0) {
                this.turnPhaseIndex = 0
                this.setNewTurnResources()
            }
            // Backward
            else {
                this.turnPhaseIndex = 4
            }
        }
    }

    initCardRevelation(oid: CardRevelationTargetOid): void {
        this.revelations[oid] = {
            all: false,
        }
        for (const playerId in this.players) {
            this.revelations[oid][playerId] = false
        }
    }
}
