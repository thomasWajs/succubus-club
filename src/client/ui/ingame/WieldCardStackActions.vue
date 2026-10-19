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
            {{ shuffleSelection.length ? `${shuffleSelection.length} cards` : cardRegion.name }}
        </button>

        <div
            v-if="canGiveControl"
            class="mode-toggle"
        >
            <button
                class="game-button"
                :class="{ 'is-muted': mode != 'reveal' }"
                @click="mode = 'reveal'"
            >
                Reveal
            </button>
            <button
                class="game-button"
                :class="{ 'is-muted': mode != 'control' }"
                @click="mode = 'control'"
            >
                Control
            </button>
        </div>

        <div v-if="canGiveControl && mode == 'control'">
            <template v-if="isOwner">Give control to:</template>
            <template v-else>Release control:</template>
            <br />

            <div class="reveal-grid">
                <template
                    v-for="player in controlTargets"
                    :key="player.oid"
                >
                    <ControlButton
                        :player="player"
                        :cardRegion="cardRegion"
                    />
                </template>
            </div>
        </div>

        <div v-else-if="players.isPlayer">
            Reveal
            <template v-if="gameBus.selectedCards.length > 0">
                {{ gameBus.selectedCards.length }} Card(s)
            </template>
            <template v-else>
                {{ cardRegion.name }}
            </template>
            to:
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
import ControlButton from '@/client/ui/ingame/ControlButton.vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { computed, CSSProperties, ref } from 'vue'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { shuffleCardRegion } from '@/client/state/gameMutations.ts'
import { getShuffleSelection } from '@/client/utils.ts'

const { cardRegion } = defineProps<{
    cardRegion: AnyCardRegion
    actionsStyle: CSSProperties
}>()

const gameState = useGameStateStore()
const players = usePlayersStore()
const gameBus = useGameBusStore()

const mode = ref<'reveal' | 'control'>('reveal')

const shuffleSelection = computed(() => getShuffleSelection(cardRegion))

const isOwner = computed(() => cardRegion.owner?.oid == players.selfPlayer?.oid)

// Only the SCS enforces ownership, so handing over a stack makes sense there only.
// The owner gives control, the holder can only hand it back.
const canGiveControl = computed(
    () =>
        gameState.isStrictGame &&
        !!players.selfPlayer &&
        (isOwner.value || cardRegion.delegate?.oid == players.selfPlayer.oid),
)

const controlTargets = computed(() => {
    const owner = cardRegion.owner
    if (!owner) {
        return []
    }
    // A delegate only sees themself, to release the control
    if (!isOwner.value) {
        return cardRegion.delegate ? [cardRegion.delegate] : []
    }
    return Array.from({ length: gameState.orderedPlayers.length - 1 }, (_, i) =>
        players.getNthNeighbour(i + 1),
    ).filter(player => player.oid != owner.oid)
})
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

.mode-toggle {
    display: grid;
    grid-template-columns: 50% 50%;
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
