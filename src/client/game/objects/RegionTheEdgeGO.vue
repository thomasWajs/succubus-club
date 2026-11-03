<template>
    <Rectangle
        ref="boundaries"
        :origin="0"
        :x="x"
        :y="y"
        :width="width"
        :height="height"
        :lineWidth="0"
        :strokeAlpha="0"
        :fillAlpha="0"
        @create="onTheEdgeCreate"
        @pointerdown="
            gameMutations.changeTheEdgeControl.actSelf({
                theEdgeController: player == gameState.theEdgeController ? undefined : player,
            })
        "
    >
        <Image
            :texture="player == gameState.theEdgeController ? Texture.TheEdgeTeal : Texture.TheEdge"
            :alpha="player == gameState.theEdgeController ? 1 : 0.3"
            :origin="0.5"
            :x="x + width / 2"
            :y="y + height / 2 - 8"
        />

        <Text
            ref="regionName"
            text="The Edge"
            :style="{
                color: regionNameColor(color),
                fontSize: 12,
            }"
            :origin="1"
            :x="x + width - 3"
            :y="y + height - 5"
        />
    </Rectangle>
</template>

<script setup lang="ts">
import Phaser, { GameObjects } from 'phaser'
import { Image, Rectangle, Text } from 'phavuer'
import { Texture } from '@/client/resources/textures.ts'
import { regionNameColor } from '@/client/colors.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { Player } from '@/shared/model/Player.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import Color = Phaser.Display.Color

const { color } = defineProps<{
    x: number
    y: number
    width: number
    height: number
    color: Color
    player: Player
}>()

const gameState = useGameStateStore()

function onTheEdgeCreate(theEdge: GameObjects.Rectangle) {
    theEdge.setInteractive({
        cursor: 'pointer',
    })
}
</script>

<style lang="scss"></style>
