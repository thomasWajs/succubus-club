<template>
    <div
        id="WieldCardStackActions"
        :style="actionsStyle"
    >
        <div class="actions-heading">
            <span>{{ cardRegion.cards.length }} Cards</span>
            <span>{{ cardRegion.name }}</span>
        </div>

        <!-- With the rules engine : the pass of a search ( stopped, declined ), the panel over the
             central box and its fixed Pass -->
        <button
            v-if="searchPass"
            class="game-button search-pass"
            :title="searchPass.text ?? undefined"
            @click="passEngine"
        >
            Pass
        </button>

        <input
            v-if="players.isPlayer"
            v-model="gameBus.wieldCardStack.searchString"
            class="search-input"
            placeholder="Search for a card..."
            @keydown.stop
        />

        <button
            v-if="players.isPlayer"
            class="game-button shuffle-button"
            @click="shuffleCardRegion(cardRegion)"
        >
            Shuffle
        </button>

        <div v-if="players.isPlayer">
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
                    v-if="players.selfPlayer"
                    :viewer="players.selfPlayer"
                    :cardRegion="cardRegion"
                />

                <template
                    v-for="i in gameState.orderedPlayers.length - 1"
                    :key="i"
                >
                    <RevelationButton
                        :viewer="players.getNthNeighbour(i)"
                        :cardRegion="cardRegion"
                    />
                </template>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ALL_PLAYERS } from '@/shared/types/state.ts'
import RevelationButton from '@/client/ui/ingame/RevelationButton.vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { computed, CSSProperties } from 'vue'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { shuffleCardRegion } from '@/client/state/gameMutations.ts'
import { searchedRegions } from '@/client/engine/interaction.ts'
import { enginePassOption, passEngine } from '@/client/engine/driver.ts'

const props = defineProps<{
    cardRegion: AnyCardRegion
    actionsStyle: CSSProperties
}>()

const gameState = useGameStateStore()
const players = usePlayersStore()
const gameBus = useGameBusStore()

const searchPass = computed(() =>
    searchedRegions.value.some(region => region.oid == props.cardRegion.oid) ?
        enginePassOption()
    :   undefined,
)
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

.shuffle-button,
.search-pass {
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
