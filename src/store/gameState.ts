import { acceptHMRUpdate, defineStore } from 'pinia'
import { Card, CardOid, CryptCard, LibraryCard } from '@/model/Card.ts'
import { Player, PlayerOid } from '@/model/Player.ts'
import { BaseModel, ObjectId } from '@/model/BaseModel.ts'
import { AnyCardRegion, CardRegionOid } from '@/model/CardRegion.ts'
import { KrcgId } from '@/resources/cards.ts'
import { DEFAULT_DPA, DEFAULT_MPA, INITIAL_POOL, TurnSequence } from '@/model/const.ts'
import { ActionState } from '@/state/actionState.ts'
import { CombatState } from '@/state/combatState.ts'
import { useCoreStore } from '@/store/core.ts'
import { hashObject } from '@/gateway/serialization.ts'
import Phaser from 'phaser'
import Color = Phaser.Display.Color
import { TargetDeclaration, CardRevelation, CardRevelationTargetOid } from '@/state/types.ts'
import { PermanentId } from '@/multiplayer/types.ts'

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

        selfPlayerOid: (state): PlayerOid =>
            state.usersToPlayer[useCoreStore().userProfile.permanentId],
        // Self player might be undefined at some point during multiplayer games
        selfPlayer(state): Player | undefined {
            return state.players[this.selfPlayerOid]
        },
        selfIsActive(): boolean {
            return this.selfPlayerOid == this.activePlayer.oid
        },
        selfPlayerSeatingIndex(state): number {
            return state.turnOrder.findIndex(playerOid => playerOid === this.selfPlayerOid)
        },
        // Not impacted by ousted players
        orderedPlayers: state => state.turnOrder.map(playerOid => state.players[playerOid]),
        // Non-ousted ordered players
        competingPlayers(): Player[] {
            return this.orderedPlayers.filter(player => !player.isOusted)
        },
        turnPhase: state => TurnSequence[state.turnPhaseIndex],
        activePlayer(): Player {
            return this.competingPlayers[this.activePlayerIndex]
        },
        theEdgeController(): Player | undefined {
            return this.theEdgeControllerOid ? this.players[this.theEdgeControllerOid] : undefined
        },

        /**
         * Return a neighbour player, starting at self player
         * 0 will return self player, 1 will return prey, 2 will return grandprey, etc...
         */
        getNthNeighbour() {
            return (n: number) => {
                return this.orderedPlayers[
                    (this.selfPlayerSeatingIndex + n) % this.orderedPlayers.length
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

        createCryptCard(krcgId: KrcgId, controller: Player, cardRegion: AnyCardRegion) {
            const card = new CryptCard(this.getNextOid(), krcgId, controller.oid)
            this.cards[card.oid] = card
            cardRegion.append(card)
            return card
        },

        createLibraryCard(krcgId: KrcgId, controller: Player, cardRegion: AnyCardRegion) {
            const card = new LibraryCard(this.getNextOid(), krcgId, controller.oid)
            this.cards[card.oid] = card
            cardRegion.append(card)
            return card
        },

        moveCardToRegion(card: Card, to: AnyCardRegion, position: number = 0) {
            if (to.cardsOid.includes(card.oid)) {
                // Card is already there, nothing to do
                return
            }
            card.region.remove(card)
            to.insert(card, position)
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
