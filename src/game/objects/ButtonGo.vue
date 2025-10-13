<template>
    <Rectangle
        ref="buttonRectangle"
        :x="x"
        :y="y"
        :width="width"
        :height="height"
        :lineWidth="BUTTON_BORDER_WIDTH"
        :strokeColor="BUTTON_BORDER_COLOR.color"
        :fillColor="backgroundColor.color"
        :fillAlpha="backgroundColor.alphaGL"
        @create="onRectangleCreate"
        @pointerover="isHovered = true"
        @pointerout="isHovered = false"
        @pointerdown="emit('click')"
    />

    <Text
        :text="text"
        :style="BUTTON_TEXT_STYLE"
        :origin="0.5"
        :x="x"
        :y="y"
    />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { GameObjects } from 'phaser'
import { refObj, Rectangle, Text } from 'phavuer'
import {
    BUTTON_BORDER_WIDTH,
    BUTTON_BORDER_COLOR,
    BUTTON_BACKGROUND_COLOR,
    BUTTON_TEXT_STYLE,
    BUTTON_BACKGROUND_COLOR_HOVER,
} from '@/game/const.ts'

const { x, y, width, height } = defineProps<{
    x: number
    y: number
    width: number
    height: number
    text: string
}>()

const buttonRectangle = refObj<GameObjects.Rectangle>()
const isHovered = ref(false)

const backgroundColor = computed(() => {
    return isHovered.value ? BUTTON_BACKGROUND_COLOR_HOVER : BUTTON_BACKGROUND_COLOR
})

function onRectangleCreate(rectangle: GameObjects.Rectangle) {
    rectangle.setInteractive({ cursor: 'pointer' })
}

/**
 * Expose/Emit
 */

interface Emits {
    (e: 'click'): void
}
const emit = defineEmits<Emits>()
</script>

<style lang="scss"></style>
