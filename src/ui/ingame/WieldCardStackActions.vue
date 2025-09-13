<template>
    <div
        id="WieldCardStackActions"
        :style="actionsStyle"
    >
        <div id="WieldCardStackActionsHeading">
            <span>{{ cardRegion.cards.length }} Cards</span>
            <span>{{ cardRegion.name }}</span>
        </div>

        <input
            id="WieldCardStackSearch"
            v-model="gameBus.wieldCardStack.searchString"
            placeholder="Search for a card..."
        />

        <button
            class="game-button"
            @click="
                gameMutations.shuffle.actSelf({
                    cardRegion: cardRegion,
                    newCardsOrder: cardRegion.generateShuffledCardsOrder(),
                })
            "
        >
            Shuffle
        </button>

        <hr />

        <div>
            Reveal
            <template v-if="gameBus.selectedCards.length > 0">
                {{ gameBus.selectedCards.length }} Card(s)
            </template>
            <template v-else>
                {{ cardRegion.name }}
            </template>
            to :
            <br />

            <div id="RevealGrid">
                <RevelationButton
                    :viewer="ALL_PLAYERS"
                    :cardRegion="cardRegion"
                />

                <RevelationButton
                    :viewer="gameState.selfPlayer"
                    :cardRegion="cardRegion"
                />

                <template
                    v-for="i in gameState.orderedPlayers.length - 1"
                    :key="i"
                >
                    <RevelationButton
                        :viewer="gameState.getNthNeighbour(i)"
                        :cardRegion="cardRegion"
                    />
                </template>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { gameMutations } from '@/state/gameMutations.ts'
import { ALL_PLAYERS } from '@/state/types.ts'
import RevelationButton from '@/ui/ingame/RevelationButton.vue'
import { AnyCardRegion } from '@/model/CardRegion.ts'
import { useGameBusStore } from '@/store/bus.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { CSSProperties } from 'vue'

defineProps<{
    cardRegion: AnyCardRegion
    actionsStyle: CSSProperties
}>()

const gameState = useGameStateStore()
const gameBus = useGameBusStore()
</script>

<style lang="scss">
#WieldCardStackActions {
    position: absolute;
    transform-origin: top left;
    background-color: transparent;
    box-sizing: border-box;
    padding: 5px;
    border-left: solid 2px black;

    display: flex;
    flex-direction: column;
}

#WieldCardStackActionsHeading {
    display: flex;
    justify-content: space-between;
    font-size: 18px;
    font-weight: bold;
    color: $ash-grey;
}

#WieldCardStackSearch {
    box-sizing: border-box;
    margin: 10px 0;
    padding: 5px 3px;
    font-size: 16px;
}

#RevealGrid {
    display: grid;
    grid-template-columns: 1fr 1fr;
}
</style>
