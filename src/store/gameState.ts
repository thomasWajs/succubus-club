import { acceptHMRUpdate, defineStore } from 'pinia'
import { Card, CardOid, CryptCard, LibraryCard } from '@/model/Card.ts'
import { Player, PlayerOid } from '@/model/Player.ts'
import { BaseModel, ObjectId } from '@/model/BaseModel.ts'
import { AnyCardRegion, CardRegionOid } from '@/model/CardRegion.ts'
import { KrcgId } from '@/resources/cards.ts'
import {
    DEFAULT_DPA,
    DEFAULT_MPA,
    DEFAULT_TRANSFERS,
    INITIAL_POOL,
    TurnSequence,
} from '@/model/const.ts'
import { ActionState } from '@/state/actionState.ts'
import { CombatState } from '@/state/combatState.ts'
import { useCoreStore } from '@/store/core.ts'
import { hashObject } from '@/gateway/serialization.ts'
import Phaser from 'phaser'
import Color = Phaser.Display.Color
import { TargetDeclaration, CardRevelation, CardRevelationTargetOid } from '@/state/types.ts'
import { PermanentId } from '@/multiplayer/types.ts'
import { useGameBusStore } from '@/store/bus.ts'

export type GameStateStore = ReturnType<typeof useGameStateStore>
export type GameState = GameStateStore['$state']
export type GameStateKey = keyof GameState

export const useGameStateStore = defineStore('gameState', {
    state: () => ({
        nextOid: 1,

        /** Main objects **/
        players: {} as Record<PlayerOid, Player>,
        cards: {} as Record<CardOid, Card>,

        /**
         * Allow to match Users to their Player when loading a gameState
         * ( Resync, Reconnect, Game loading... )
         */
        usersToPlayer: {} as Record<PermanentId, PlayerOid>,

        /** Turn / Phase **/
        turnOrder: [] as PlayerOid[], // Turn order at the start of the game, not impacted by ousted players
        activePlayerIndex: 0, // Index into state.competingPlayers
        turnNumber: 1,
        turnPhaseIndex: 0,

        /** Revelations **/
        revelations: {} as Record<CardRevelationTargetOid, CardRevelation>,

        /** The edge **/
        theEdgeControllerOid: undefined as PlayerOid | undefined,

        /** Resources for the bot **/
        turnResources: {
            mpa: DEFAULT_MPA, // masterPhaseActions
            transfers: 1,
            dpa: DEFAULT_DPA, // discardPhaseActions
        },

        /** Action and combat state for the bot **/
        action: null as ActionState | null,
        combat: null as CombatState | null,

        /** Target Declaration **/
        targetDeclarations: [] as TargetDeclaration[],

        /** Timer **/
        timerRemainingTime: null as number | null, // If null, no timer is running
        timerIsPaused: true,
    }),
    getters: {
        /**
         * All instances of BaseModel in the game state
         * ObjectId -> Card | Player | CardRegion
         */
        allStateObjects(state): Record<ObjectId, BaseModel> {
            return {
                ...state.players,
                ...state.cards,
                ...this.cardRegions,
            }
        },

        /**
         * All CardRegion in the game state
         * CardRegionOid => Card Region
         */
        cardRegions(): Record<CardRegionOid, AnyCardRegion> {
            const regions = {} as Record<CardRegionOid, AnyCardRegion>
            for (const player of this.orderedPlayers) {
                for (const cardRegion of player.allCardRegions) {
                    regions[cardRegion.oid] = cardRegion
                }
            }
            return regions
        },

        /**
         * Tells in which CardRegion each card is located
         * cardOid ==> Card Region
         */
        cardLocations(): Record<CardOid, AnyCardRegion> {
            const locations: Record<CardOid, AnyCardRegion> = {}

            for (const cardRegion of Object.values(this.cardRegions)) {
                for (const card of cardRegion.cards) {
                    locations[card.oid] = cardRegion
                }
            }
            return locations
        },

        /**
         * Tells which Player own each CardRegion
         * CardRegionOid ==> Player
         */
        regionOwners(): Record<CardRegionOid, Player> {
            const owners: Record<CardRegionOid, Player> = {}

            for (const player of this.orderedPlayers) {
                for (const cardRegion of player.allCardRegions) {
                    owners[cardRegion.oid] = player
                }
            }
            return owners
        },

        /**
         * Cards with an effect in the current phase
         */
        cardsDuringCurrentPhase: (state): Card[] =>
            Object.values(state.cards).filter(card => card.isDuringCurrentPhase()),

        // May be undefined for spectators
        selfPlayerOid: (state): PlayerOid | undefined =>
            state.usersToPlayer[useCoreStore().userProfile.permanentId],
        // May be undefined for spectators, or during temporary loading states
        selfPlayer(state): Player | undefined {
            return this.selfPlayerOid ? state.players[this.selfPlayerOid] : undefined
        },
        selfIsActive(): boolean {
            return this.activePlayer && this.selfPlayerOid ?
                    this.selfPlayerOid == this.activePlayer.oid
                :   false
        },

        isPlayer(): boolean {
            return !!this.selfPlayerOid
        },
        isSpectator(): boolean {
            return !this.selfPlayerOid
        },
        // If user is a player, returns self player.
        // If user is a spectator, arbitrarily use the first player
        centralPlayer(): Player {
            return this.selfPlayer ? this.selfPlayer : this.orderedPlayers[0]
        },
        centralPlayerSeatingIndex(state): number {
            return state.turnOrder.findIndex(playerOid => playerOid === this.centralPlayer.oid)
        },

        // Not impacted by ousted players
        orderedPlayers: state => state.turnOrder.map(playerOid => state.players[playerOid]),
        // Non-ousted ordered players
        competingPlayers(): Player[] {
            return this.orderedPlayers.filter(player => !player.isOusted)
        },
        turnPhase: state => TurnSequence[state.turnPhaseIndex],
        activePlayer(): Player | undefined {
            return this.competingPlayers[this.activePlayerIndex]
        },
        theEdgeController(): Player | undefined {
            return this.theEdgeControllerOid ? this.players[this.theEdgeControllerOid] : undefined
        },

        // Trigger special layout for 2-players games
        is2pGame: state => Object.keys(state.players).length == 2,

        /**
         * Return a neighbour player, starting at central player
         * 0 will return self player, 1 will return prey, 2 will return grandprey, etc...
         */
        getNthNeighbour() {
            return (n: number) => {
                return this.orderedPlayers[
                    (this.centralPlayerSeatingIndex + n) % this.orderedPlayers.length
                ]
            }
        },
    },
    actions: {
        hash() {
            return hashObject(this.$state)
        },

        getNextOid(): ObjectId {
            return this.nextOid++
        },

        createPlayer(name: string, color: Color, permId: PermanentId) {
            const player = new Player(
                this.getNextOid(),
                permId,
                Player.createCardRegions(),
                name,
                color.rgba,
                INITIAL_POOL,
            )
            this.players[player.oid] = player
            this.turnOrder.push(player.oid)
            return player
        },

        createCryptCard(krcgId: KrcgId, owner: Player, cardRegion: AnyCardRegion) {
            const card = new CryptCard(this.getNextOid(), krcgId, owner.oid)
            this.cards[card.oid] = card
            cardRegion.append(card)
            return card
        },

        createLibraryCard(krcgId: KrcgId, owner: Player, cardRegion: AnyCardRegion) {
            const card = new LibraryCard(this.getNextOid(), krcgId, owner.oid)
            this.cards[card.oid] = card
            cardRegion.append(card)
            return card
        },

        moveCardToRegion(card: Card, to: AnyCardRegion, position: number = 0) {
            if (to.cardsOid.includes(card.oid)) {
                // Card is already there, nothing to do
                return
            }

            const wasInPlay = card.isIn.play

            card.region.remove(card)
            to.insert(card, position)

            // Game state is clearly not the ideal place to put this,
            // but it's the central point for moving cards around regions.
            // If someone has a better idea, feel free to refactor.
            if (wasInPlay && !card.isIn.play) {
                const gameState = useGameBusStore()
                // Deselect a card when moved out of the play area.
                gameState.removeFromSelection(card)
                // Remove from card group when moved out of the play area.
                gameState.removeFromCardGroup(card)
                // Reset counters/markers when leaving play
                card.blood = 0
                card.greenCounter = 0
                card.markers = []
            }
        },

        changeTurn(newTurnNumber: number) {
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
                    this.turnResources = {
                        mpa: DEFAULT_MPA,
                        transfers: Math.min(DEFAULT_TRANSFERS, this.turnNumber),
                        dpa: DEFAULT_DPA,
                    }
                }
                // Backward
                else {
                    this.turnPhaseIndex = 4
                }
            }
        },

        initCardRevelation(oid: CardRevelationTargetOid) {
            this.revelations[oid] = {
                all: false,
            }
            for (const playerId in this.players) {
                this.revelations[oid][playerId] = false
            }
        },
    },
})

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useGameStateStore, import.meta.hot))
}
