<template>
    <FxGlow
        :color="Colors.CARD_PING.color"
        :outerStrength="0"
        :innerStrength="0"
        @create="onGlowCreate"
    />

    <FxGradient
        :color1="Colors.CARD_PING.color"
        :color2="Colors.CARD_PING.color"
        :alpha="gradientAlpha"
        @create="onGradientCreate"
    />

    <FxColorMatrix
        :brightness="brightness"
        @create="onColorMatrixCreate"
    />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { FxColorMatrix, FxGlow, FxGradient, useScene } from 'phavuer'
import Phaser from 'phaser'
import { Colors } from '@/client/colors.ts'
import { CARD_PING_DURATION, CARD_PING_NB_BEATS } from '@/shared/const/game.ts'

const scene = useScene()
const brightness = ref(1)
const gradientAlpha = ref(1)

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
        innerStrength: 1,
    })
}

function onColorMatrixCreate() {
    addTween({
        targets: brightness,
        value: 1.1,
    })
}

function onGradientCreate() {
    addTween({
        targets: gradientAlpha,
        value: 0.85,
    })
}
</script>
