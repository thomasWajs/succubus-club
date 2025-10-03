<template>
    <Line
        :origin="0"
        :x1="arrowAttrs.x1"
        :y1="arrowAttrs.y1"
        :x2="arrowAttrs.x2"
        :y2="arrowAttrs.y2"
        :lineWidth="3"
        :strokeColor="ARROW_COLOR.color"
    />

    <Triangle
        :origin="0"
        :x1="arrowAttrs.x2"
        :y1="arrowAttrs.y2"
        :x2="arrowAttrs.x3"
        :y2="arrowAttrs.y3"
        :x3="arrowAttrs.x4"
        :y3="arrowAttrs.y4"
        :fillColor="ARROW_COLOR.color"
    />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Line, Triangle } from 'phavuer'
import { ARROW_COLOR, ARROW_HEAD_HEIGHT, ARROW_HEAD_WIDTH } from '@/game/const.ts'
import { Arrow } from '@/state/types.ts'

const { arrow } = defineProps<{
    arrow: Arrow
}>()

/**
 * Thanks to https://phaser.io/sandbox/CgXdHog5 !
 *
 * The arrowhead is an isosceles triangle of the given `width` and `height`.
 */
const arrowAttrs = computed(() => {
    const { x: x1, y: y1 } = arrow.from
    const { x: x2, y: y2 } = arrow.to

    const dx = x2 - x1
    const dy = y2 - y1

    const lineLength = Math.sqrt(dx * dx + dy * dy)

    // Line unit vector
    const udx = dx / lineLength
    const udy = dy / lineLength

    // Perpendicular unit vector
    const pdx = -udy
    const pdy = udx

    // Arrowhead base vertices
    const x3 = x2 - ARROW_HEAD_HEIGHT * udx + ARROW_HEAD_WIDTH * pdx
    const y3 = y2 - ARROW_HEAD_HEIGHT * udy + ARROW_HEAD_WIDTH * pdy
    const x4 = x2 - ARROW_HEAD_HEIGHT * udx - ARROW_HEAD_WIDTH * pdx
    const y4 = y2 - ARROW_HEAD_HEIGHT * udy - ARROW_HEAD_WIDTH * pdy

    return { x1, y1, x2, y2, x3, y3, x4, y4 }
})
</script>

<style lang="scss"></style>
