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
                theEdgeController: isControlled ? undefined : player,
            })
        "
    >
        <Circle
            :radius="DISC_RADIUS"
            :fillColor="
                isControlled ? Colors.THE_EDGE_CONTROLLED_DISC.color : Colors.THE_EDGE_DISC.color
            "
            :fillAlpha="1"
            :x="x + width / 2"
            :y="y + height / 2 - DISC_OFFSET_Y"
        />

        <Image
            :texture="Texture.TheEdgeEmblem"
            :alpha="isControlled ? 1 : THE_EDGE_IDLE_EMBLEM_ALPHA"
            :scale="EMBLEM_SCALE"
            :origin="0.5"
            :x="x + width / 2"
            :y="y + height / 2 - DISC_OFFSET_Y"
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
import { computed } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Circle, Image, Rectangle, Text } from 'phavuer'
import { Texture } from '@/client/resources/textures.ts'
import { Colors, regionNameColor } from '@/client/colors.ts'
import { THE_EDGE_IDLE_EMBLEM_ALPHA } from '@/shared/const/game.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { Player } from '@/shared/model/Player.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'

const { color, player } = defineProps<{
    x: number
    y: number
    width: number
    height: number
    color: Phaser.Display.Color
    player: Player
}>()

const gameState = useGameStateStore()

const DISC_RADIUS = 24
// How far above the zone's centre the disc sits, to leave room for the label below it
const DISC_OFFSET_Y = 11
// The emblem texture is drawn at twice its displayed size, to stay sharp on HiDPI screens.
// It is centered on the emblem's own enclosing circle, which leaves a ~3.5 px gap to the disc
const EMBLEM_SCALE = 0.5

const isControlled = computed(() => player == gameState.theEdgeController)

function onTheEdgeCreate(theEdge: GameObjects.Rectangle) {
    theEdge.setInteractive({
        cursor: 'pointer',
    })
}
</script>

<style lang="scss"></style>
