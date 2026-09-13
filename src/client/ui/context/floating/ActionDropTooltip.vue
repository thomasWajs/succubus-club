<template>
    <div
        v-if="content"
        class="action-drop-tooltip"
        :style="style"
    >
        {{ content.verb }} <strong>{{ content.cardName }}</strong> with
        <strong>{{ content.minionName }}</strong>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { LibraryCard } from '@/shared/model/Card.ts'
import { ActionVerb } from '@/shared/const/model.ts'
import { getCardRectangle, getScreenPoint, getScreenScale } from '@/client/game/utils.ts'

const gameBus = useGameBusStore()

const content = computed(() => {
    const minion = gameBus.dropMinionCandidate
    const card = gameBus.dragOver?.card
    if (!minion || !(card instanceof LibraryCard) || !card.type) {
        return null
    }
    return {
        // Action cards have a dedicated verb ; modifiers and reactions, which
        // are just played onto the minion, fall back to a generic "Plays".
        verb: ActionVerb[card.type as keyof typeof ActionVerb] ?? 'Plays',
        cardName: card.name,
        minionName: minion.name,
    }
})

// Anchored just below the highlighted minion, centered on it.
const style = computed(() => {
    const minion = gameBus.dropMinionCandidate
    const worldPoint = minion && gameBus.cardsInGame[minion.oid]?.getWorldPosition()
    if (!minion || !worldPoint) {
        return { display: 'none' }
    }
    const { x, y } = getScreenPoint(worldPoint.x, worldPoint.y)
    const rect = getCardRectangle(minion)
    const scale = getScreenScale()
    return {
        left: `${x}px`,
        top: `${y + (rect.height * scale) / 2 + 10}px`,
        transform: `scale(${scale}) translateX(-50%)`,
    }
})
</script>

<style lang="scss">
@use '../../../styles/base' as *;

.action-drop-tooltip {
    @extend .game-tooltip;

    transform-origin: top left;
    z-index: 1049;
}
</style>
