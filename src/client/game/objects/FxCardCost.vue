<template>
    <Text
        v-if="blood > 0"
        :text="`-${blood}`"
        :style="BLOOD_COST_FX_TEXT_STYLE"
        :origin="0.5"
        :x="pool > 0 ? x - gap : x"
        :y="y - rise"
        :alpha="alpha"
        :scale="scale"
    />
    <Text
        v-if="pool > 0"
        :text="`-${pool}`"
        :style="POOL_COST_FX_TEXT_STYLE"
        :origin="0.5"
        :x="blood > 0 ? x + gap : x"
        :y="y - rise"
        :alpha="alpha"
        :scale="scale"
    />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Text, useScene } from 'phavuer'
import {
    BLOOD_COST_FX_TEXT_STYLE,
    CARD_COST_FX_DURATION,
    POOL_COST_FX_TEXT_STYLE,
} from '@/shared/const/game.ts'

const props = defineProps<{
    blood: number
    pool: number
    // Base position ( container coordinates ) : centered above the card.
    x: number
    y: number
    // Distance the cost travels upward, in container coordinates.
    riseDistance: number
    scale: number
}>()

const scene = useScene()
const rise = ref(0)
const alpha = ref(1)

// Horizontal spread when both costs are shown side by side.
const gap = computed(() => 20 * props.scale)

onMounted(() => {
    // Phaser tweens mutate the target's property, so tweening the ref's `value`
    // updates it reactively ( same trick as FxPingCard ).
    scene.tweens.add({
        targets: rise,
        value: props.riseDistance,
        duration: CARD_COST_FX_DURATION,
        ease: 'Quad.out',
    })
    scene.tweens.add({
        targets: alpha,
        value: 0,
        duration: CARD_COST_FX_DURATION,
        ease: 'Quad.in',
    })
})
</script>
