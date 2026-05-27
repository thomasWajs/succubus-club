<template>
    <FxGlow
        :color="Colors.CARD_PING.color"
        :outerStrength="0"
        :innerStrength="0"
        :scale="1"
        @create="onGlowCreate"
    />

    <FxColorMatrix
        :brightness="brightness"
        @create="onColorMatrixCreate"
    />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { FxColorMatrix, FxGlow, useScene } from 'phavuer'
import Phaser from 'phaser'
import { Colors } from '@/client/colors.ts'
import { CARD_PING_DURATION, CARD_PING_NB_BEATS } from '@/shared/const/game.ts'

const scene = useScene()
const brightness = ref(1)

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

function onGlowCreate(glowFx: Phaser.Filters.Controller) {
    glowFx.setPaddingOverride(-100, -100, 100, 100)

    addTween({
        targets: glowFx,
        outerStrength: 20,
        innerStrength: 1,
        scale: 4,
    })
}

function onColorMatrixCreate() {
    addTween({
        targets: brightness,
        value: 1.1,
    })
}
</script>
