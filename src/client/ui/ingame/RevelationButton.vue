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
import { useGameBusStore } from '@/client/store/bus.ts'
import { ALL_PLAYERS, CardRevelationViewer } from '@/shared/types/state.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { computed } from 'vue'
import { isRevealedToViewer } from '@/shared/state/cardVisibility.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'

const { viewer, cardRegion } = defineProps<{
    viewer: CardRevelationViewer
    cardRegion: AnyCardRegion
}>()

const gameBus = useGameBusStore()

const isActive = computed(() => {
    const target = gameBus.selectedCards.length > 0 ? gameBus.selectedCards[0] : cardRegion
    return isRevealedToViewer(target, viewer)
})

function reveal() {
    if (gameBus.selectedCards.length > 0) {
        gameBus.selectedCards.forEach(card =>
            gameMutations.reveal.actSelf({
                target: card,
                viewer,
            }),
        )
    } else {
        gameMutations.reveal.actSelf({
            target: cardRegion,
            viewer,
        })
    }
}
</script>
