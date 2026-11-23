<template>
    <FxGlow
        :color="Colors.CARD_PING.color"
        :outerStrength="0"
        :innerStrength="0"
        @create="onGlowCreate"
    />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { FxGlow, useScene } from 'phavuer'
import Phaser, { GameObjects } from 'phaser'
import { Colors } from '@/client/colors.ts'
import {
    CARD_PING_DURATION,
    CARD_PING_NB_BEATS,
    CARD_PING_TINT_ALPHA,
} from '@/shared/const/game.ts'

// Goes on the glow backdrop behind the card, never on the card image itself : Phaser
// renders FX off-screen at CSS resolution, which blurs the card on HiDPI screens. The
// colour pulse over the card is done by tweening the plain `tint` image instead.
const { tint } = defineProps<{
    tint?: GameObjects.Image
}>()

const scene = useScene()

function addTween(tweenConfig: Phaser.Types.Tweens.TweenBuilderConfig) {
    scene.tweens.add({
        duration: CARD_PING_DURATION / CARD_PING_NB_BEATS,
        yoyo: true,
        repeat: CARD_PING_NB_BEATS - 1,
        ease: 'Quad.inout',
        persist: false,
        ...tweenConfig,
    })
}

function onGlowCreate(glowFx: Phaser.FX.Glow) {
    addTween({
        targets: glowFx,
        outerStrength: 8,
    })
}

onMounted(() => {
    if (tint) {
        addTween({
            targets: tint,
            alpha: { from: 0, to: CARD_PING_TINT_ALPHA },
        })
    }
})
</script>
