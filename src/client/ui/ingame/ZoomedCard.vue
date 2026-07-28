<template>
    <img
        v-if="zoomedCardTexture"
        id="ZoomedCard"
        :style="style"
        :src="zoomedCardTexture"
    />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useCardTexture } from '@/client/game/composables/useCardTexture.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { getScreenPoint } from '@/client/game/utils.ts'
import { layout } from '@/client/game/display.ts'

const core = useCoreStore()
const gameBus = useGameBusStore()

const zoomedCard = computed(() => {
    return gameBus.hoveredCard && gameBus.zoomHoveredCard ? gameBus.hoveredCard : null
})

const pointerScreenPosition = computed(() => {
    if (!zoomedCard.value || !gameBus.pointerPosition) {
        return null
    }
    return getScreenPoint(gameBus.pointerPosition.x, gameBus.pointerPosition.y)
})

const zoomedCardTexture = computed(() => {
    if (!zoomedCard.value) {
        return null
    }

    const { displayedTexture } = useCardTexture(zoomedCard.value)
    return core.phaserGame.textures.getBase64(
        displayedTexture.value.textureName,
        displayedTexture.value.frameName,
    )
})

const style = computed(() => {
    // The pointer would be above the zoomedCard, which would close it instantaneously.
    // Switch it to the left instead of right
    if (
        pointerScreenPosition.value &&
        window.innerWidth - pointerScreenPosition.value.x < layout.rightColumnWidth * 1.5 + 30
    ) {
        return {
            left: '0',
            'transform-origin': 'top left',
        }
    }

    // Default position : Top Right corner
    return {
        right: '0',
        'transform-origin': 'top right',
    }
})
</script>

<style lang="scss">
#ZoomedCard {
    position: absolute;
    top: 0;
    z-index: 1002;
    transform: scale(1.5);
}
</style>
