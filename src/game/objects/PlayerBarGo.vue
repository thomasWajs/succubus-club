<template>
    <Rectangle
        ref="boundaries"
        :origin="0"
        :x="x"
        :y="y"
        :width="width"
        :height="height"
        :lineWidth="1"
        :strokeColor="color.color"
        :strokeAlpha="color.alphaGL"
        :fillColor="playerColor.color"
        :fillAlpha="0.5"
        @create="onBoundariesCreate"
    />

    <!-- Player Name -->
    <Text
        :text="player.name"
        :style="{
            color: '#000',
            fontStyle: 'Bold',
            fontSize: '18px',
        }"
        :origin="0"
        :x="x + 5"
        :y="y + 5"
    />

    <!-- Current Pool -->
    <Polygon
        ref="poolDiamond"
        :points="[
            [-19, 0],
            [0, 15],
            [19, 0],
            [0, -15],
        ]"
        :fillColor="WHITE.color"
        :fillAlpha="0.6"
        :lineWidth="COUNTER_OUTLINE_THICKNESS"
        :strokeColor="BLACK.color"
        :origin="0"
        :x="x + width / 2"
        :y="y + height / 2"
    />
    <Text
        :text="player.pool.toString()"
        :style="COUNTER_TEXT_STYLE"
        :origin="0.5"
        :x="x + width / 2"
        :y="y + height / 2"
    />

    <!-- The Edge -->
    <Text
        v-if="player == gameState.theEdgeController"
        :text="'🗡'"
        :style="{
            color: '#5c1a23',
            fontStyle: 'Bold',
            fontSize: '20px',
        }"
        :origin="1"
        :x="x + width - 50"
        :y="y + 25"
    />

    <!-- Victory Points -->
    <Text
        :text="player.victoryPoints + ' VP'"
        :style="{
            color: '#000',
            fontStyle: 'Bold',
            fontSize: '16px',
        }"
        :origin="1"
        :x="x + width - 5"
        :y="y + 22"
    />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Polygon, Rectangle, Text, refObj } from 'phavuer'
import { BLACK, COUNTER_OUTLINE_THICKNESS, COUNTER_TEXT_STYLE, WHITE } from '@/game/const.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { Player } from '@/model/Player.ts'
import Color = Phaser.Display.Color
import { useGameBusStore } from '@/store/bus.ts'

const props = defineProps<{
    x: number
    y: number
    width: number
    height: number
    color: Color
    player: Player
}>()

const gameState = useGameStateStore()
const gameBus = useGameBusStore()

const playerColor = props.player.color.clone().darken(20).desaturate(60)

const poolDiamond = refObj<GameObjects.Polygon>()

function onBoundariesCreate(boundaries: GameObjects.Rectangle) {
    boundaries.setInteractive({ draggable: false })
}

/**
 * World position ( for arrows )
 */

function getWorldPosition() {
    const poolObject = poolDiamond.value
    if (!poolObject || !poolObject.parentContainer) {
        return null
    }
    return poolObject.parentContainer
        .getWorldTransformMatrix()
        .transformPoint(poolObject.x, poolObject.y)
}

/**
 * Register onto the gameBus
 */

const playerInGame = {
    playerOid: props.player.oid,
    getWorldPosition,
}
onMounted(() => {
    gameBus.playersInGame[props.player.oid] = playerInGame
})
onBeforeUnmount(() => {
    delete gameBus.cardsInGame[props.player.oid]
})
</script>

<style lang="scss"></style>
