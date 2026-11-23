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
        :rotation="rotation"
        :lineWidth="BUTTON_BORDER_WIDTH"
        :strokeColor="border.color"
        :fillColor="bgColor.color"
        :fillAlpha="bgColor.alphaGL"
        :depth="depth"
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
        :rotation="rotation"
        :depth="depth"
    />

    <Image
        v-if="icon"
        ref="buttonIcon"
        :texture="iconTextureKey(icon)"
        :x="x"
        :y="y"
        :scale="iconScale"
        :rotation="rotation"
        :tint="iconColor?.color ?? Colors.WHITE.color"
        :depth="depth"
    />

    <slot />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Image, Rectangle, refObj, Text } from 'phavuer'
import { Colors } from '@/client/colors.ts'
import { BUTTON_BORDER_WIDTH, BUTTON_ICON_RATIO, BUTTON_TEXT_STYLE } from '@/shared/const/game.ts'
import { PhaserDataKey } from '@/client/game/types.ts'
import { IconName } from '@/client/resources/icons.ts'
import { CANVAS_ICON_SIZE, iconTextureKey } from '@/client/resources/textures.ts'
import Color = Phaser.Display.Color
import Pointer = Phaser.Input.Pointer

const {
    width,
    height,
    scale = 1,
    name,
    textStyle,
    backgroundColor,
    borderColor,
} = defineProps<{
    x: number
    y: number
    width: number
    height: number
    scale?: number
    rotation?: number
    text?: string
    textStyle?: object
    // One of CANVAS_ICONS, drawn in the button centre
    icon?: IconName
    iconColor?: Color
    backgroundColor?: Color
    borderColor?: Color
    name?: string
    origin?: number
    originX?: number
    originY?: number
    depth?: number
}>()

const buttonRectangle = refObj<GameObjects.Rectangle>()
const buttonText = refObj<GameObjects.Text>()
const buttonIcon = refObj<GameObjects.Image>()
const isHovered = ref(false)

const mergedTextStyle = { ...BUTTON_TEXT_STYLE, ...textStyle }

// Scaled with the button, unlike the text
const iconScale = computed(
    () => (Math.min(width, height) * scale * BUTTON_ICON_RATIO) / CANVAS_ICON_SIZE,
)

function onRectangleCreate(rectangle: GameObjects.Rectangle) {
    rectangle.setInteractive({ cursor: 'pointer' })
    rectangle.setName(name ?? '')
    rectangle.setData(PhaserDataKey.OverlayButton, true)
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

// Default colors are resolved here ( not as prop defaults ) so they follow the UI theme
const border = computed(() => borderColor ?? Colors.BUTTON_BORDER)
const bgColor = computed(() => {
    const background = backgroundColor ?? Colors.BUTTON_BACKGROUND
    return isHovered.value ? background.clone().brighten(12) : background
})

function bringToTop() {
    if (!buttonRectangle.value) return

    const container = buttonRectangle.value.parentContainer
    container.bringToTop(buttonRectangle.value)
    if (buttonText.value) container.bringToTop(buttonText.value)
    if (buttonIcon.value) container.bringToTop(buttonIcon.value)

    // If the player is ousted, the ousted overlay always takes precedence
    if (name != 'hidePLayAreaButton') {
        const bringOustedToTop = container.getData(PhaserDataKey.BringOustedToTop)
        bringOustedToTop?.()
    }
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
