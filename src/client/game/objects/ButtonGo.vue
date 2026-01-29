<template>
    <Rectangle
        ref="buttonRectangle"
        :origin="origin"
        :originX="originX"
        :originY="originY"
        :x="x"
        :y="y"
        :width="width"
        :height="height"
        :scale="scale"
        :lineWidth="BUTTON_BORDER_WIDTH"
        :strokeColor="borderColor.color"
        :fillColor="bgColor.color"
        :fillAlpha="bgColor.alphaGL"
        @create="onRectangleCreate"
        @pointerover="onPointerOver"
        @pointerout="onPointerOut"
        @pointerdown="onClick"
    />

    <Text
        v-if="text"
        ref="buttonText"
        :text="text"
        :style="mergedTextStyle"
        :origin="0.5"
        :x="x"
        :y="y"
    />

    <slot />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Rectangle, refObj, Text } from 'phavuer'
import { Colors } from '@/client/colors.ts'
import { BUTTON_BORDER_WIDTH, BUTTON_TEXT_STYLE } from '@/shared/const/game.ts'
import Color = Phaser.Display.Color
import Pointer = Phaser.Input.Pointer

const {
    name,
    textStyle,
    backgroundColor = Colors.BUTTON_BACKGROUND,
    borderColor = Colors.BUTTON_BORDER,
} = defineProps<{
    x: number
    y: number
    width: number
    height: number
    scale?: number
    text?: string
    textStyle?: object
    backgroundColor?: Color
    borderColor?: Color
    name?: string
    origin?: number
    originX?: number
    originY?: number
}>()

const buttonRectangle = refObj<GameObjects.Rectangle>()
const buttonText = refObj<GameObjects.Text>()
const isHovered = ref(false)

const mergedTextStyle = { ...BUTTON_TEXT_STYLE, ...textStyle }

function onRectangleCreate(rectangle: GameObjects.Rectangle) {
    rectangle.setInteractive({ cursor: 'pointer' })
    rectangle.setName(name ?? '')
}

function onPointerOver(pointer: Pointer) {
    isHovered.value = true
    emit('pointerover', pointer)
}

function onPointerOut(pointer: Pointer) {
    isHovered.value = false
    emit('pointerout', pointer)
}

function onClick(pointer: Pointer) {
    emit('click', pointer)
}

const bgColor = computed(() => {
    return isHovered.value ? backgroundColor.clone().brighten(12) : backgroundColor
})

function bringToTop() {
    if (!buttonRectangle.value) return

    const container = buttonRectangle.value.parentContainer
    container.bringToTop(buttonRectangle.value)
    if (buttonText.value) container.bringToTop(buttonText.value)
}

/**
 * Expose/Emit
 */

interface Emits {
    (e: 'click', pointer: Pointer): void
    (e: 'pointerover', pointer: Pointer): void
    (e: 'pointerout', pointer: Pointer): void
}
const emit = defineEmits<Emits>()

defineExpose({
    bringToTop,
})
</script>

<style lang="scss"></style>
