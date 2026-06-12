<template>
    <FxGlow
        :color="color.color"
        :innerStrength="1"
        :outerStrength="1"
        @create="onGlowCreate"
    />

    <FxColorMatrix :brightness="1" />
</template>

<script setup lang="ts">
import Phaser from 'phaser'
import { FxColorMatrix, FxGlow, useScene } from 'phavuer'
import Color = Phaser.Display.Color

const { color } = defineProps<{
    color: Color
}>()

const scene = useScene()

function onGlowCreate(glowFx: Phaser.FX.Glow) {
    scene.tweens.add({
        targets: glowFx,
        innerStrength: 1,
        outerStrength: 3,
        duration: 1000,
        repeat: -1,
        yoyo: true,
        ease: 'Quad.inout',
    })
}
</script>

<style lang="scss"></style>
