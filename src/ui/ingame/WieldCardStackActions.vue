<template>
    <div
        id="WieldCardStackActions"
        :style="actionsStyle"
    >
        <div class="actions-heading">
            <span>{{ cardRegion.cards.length }} Cards</span>
            <span>{{ cardRegion.name }}</span>
        </div>

        <input
            v-if="gameState.isPlayer"
            v-model="gameBus.wieldCardStack.searchString"
            class="search-input"
            placeholder="Search for a card..."
            @keydown.stop
        />

        <button
            v-if="gameState.isPlayer"
            class="game-button shuffle-button"
            @click="
                gameMutations.shuffle.actSelf({
                    cardRegion: cardRegion,
                    cardsOrder: cardRegion.generateShuffledCardsOrder(),
                    previousCardsOrder: [...cardRegion.cardsOid],
                })
            "
        >
            Shuffle
        </button>

        <div v-if="gameState.isPlayer">
            Reveal
            <template v-if="gameBus.selectedCards.length > 0">
                {{ gameBus.selectedCards.length }} Card(s)
            </template>
            <template v-else>
                {{ cardRegion.name }}
            </template>
            to :
            <br />

            <div class="reveal-grid">
                <RevelationButton
                    :viewer="ALL_PLAYERS"
                    :cardRegion="cardRegion"
                />

                <RevelationButton
                    v-if="gameState.selfPlayer"
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

<style scoped lang="scss">
#WieldCardStackActions {
    position: absolute;
    transform-origin: top right;
    background-color: transparent;
    box-sizing: border-box;
    padding: 5px;
    border-left: solid 2px black;

    display: flex;
    flex-direction: column;
}

.actions-heading {
    display: flex;
    justify-content: space-between;
    font-size: 18px;
    font-weight: bold;
    color: $ash-grey;
}

.search-input {
    box-sizing: border-box;
    margin: 10px 0;
    padding: 5px 3px;
    font-size: 16px;
}

.shuffle-button {
    margin: 5px 0;
}

.reveal-grid {
    display: grid;
    grid-template-columns: 50% 50%;

    .game-button {
        overflow: hidden;
    }
}
</style>
