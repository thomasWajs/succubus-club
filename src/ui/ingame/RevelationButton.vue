<template>
    <button
        class="game-button"
        :class="{ 'is-muted': !isActive }"
        @click="reveal()"
    >
        <template v-if="viewer == ALL_PLAYERS">ALL</template>
        <template v-else>{{ viewer.name }}</template>
    </button>
</template>

<script setup lang="ts">
import { useGameBusStore } from '@/store/bus.ts'
import { ALL_PLAYERS, CardRevelationViewer } from '@/state/types.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import { AnyCardRegion } from '@/model/CardRegion.ts'
import { computed } from 'vue'
import { useGameStateStore } from '@/store/gameState.ts'

const props = defineProps<{
    viewer: CardRevelationViewer
    cardRegion: AnyCardRegion
}>()

const gameState = useGameStateStore()
const gameBus = useGameBusStore()

const isActive = computed(() => {
    const target = gameBus.selectedCards.length > 0 ? gameBus.selectedCards[0] : props.cardRegion
    return gameState.isRevealed(target, props.viewer)
})

function reveal() {
    if (gameBus.selectedCards.length > 0) {
        gameBus.selectedCards.forEach(card =>
            gameMutations.reveal.actSelf({
                target: card,
                viewer: props.viewer,
            }),
        )
    } else {
        gameMutations.reveal.actSelf({
            target: props.cardRegion,
            viewer: props.viewer,
        })
    }
}
</script>
