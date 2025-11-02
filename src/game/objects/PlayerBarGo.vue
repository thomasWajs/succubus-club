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
        :text="player.shortName"
        :style="{
            color: '#000',
            fontStyle: 'Bold',
            fontSize: '18px',
        }"
        :origin="0"
        :x="x + 5"
        :y="y + 5"
    />

    <!-- Minus Pool -->
    <ButtonGo
        v-if="gameState.isPlayer"
        :x="x + width / 2 - 35"
        :y="y + height / 2"
        :width="25"
        :height="25"
        text="-"
        @click="
            gameMutations.changePool.actSelf({
                player,
                amount: -1,
            })
        "
    />

    <!-- Current Pool -->
    <Polygon
        ref="poolDiamond"
        :points="diamondVertices"
        :fillColor="WHITE.color"
        :fillAlpha="0.6"
        :lineWidth="COUNTER_OUTLINE_THICKNESS"
        :strokeColor="BLACK.color"
        :origin="0"
        :x="x + width / 2"
        :y="y + height / 2"
        @create="onPoolDiamondCreate"
        @pointerdown.stop
        @pointerup.stop="onPoolDiamondPointerUp"
    />
    <Text
        :text="player.pool.toString()"
        :style="COUNTER_TEXT_STYLE"
        :origin="0.5"
        :x="x + width / 2"
        :y="y + height / 2"
    />

    <!-- Plus Pool -->
    <ButtonGo
        v-if="gameState.isPlayer"
        :x="x + width / 2 + 35"
        :y="y + height / 2"
        :width="25"
        :height="25"
        text="+"
        @click="
            gameMutations.changePool.actSelf({
                player,
                amount: +1,
            })
        "
    />

    <!-- The Edge -->
    <Image
        :texture="player == gameState.theEdgeController ? Texture.TheEdgeTeal : Texture.TheEdge"
        :alpha="player == gameState.theEdgeController ? 1 : 0.4"
        :origin="1"
        :x="x + width - 60"
        :y="y + 30"
        @create="onTheEdgeCreate"
        @pointerdown="
            gameMutations.changeTheEdgeControl.actSelf({
                newController: player == gameState.theEdgeController ? undefined : player,
            })
        "
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
import { Polygon, Rectangle, Text, Image, refObj } from 'phavuer'
import { BLACK, COUNTER_OUTLINE_THICKNESS, COUNTER_TEXT_STYLE, WHITE } from '@/game/const.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { Player } from '@/model/Player.ts'
import Color = Phaser.Display.Color
import { useGameBusStore } from '@/store/bus.ts'
import ButtonGo from '@/game/objects/ButtonGo.vue'
import { gameMutations } from '@/state/gameMutations.ts'
import { Texture } from '@/resources/textures.ts'

const { x, y, width, height, color, player } = defineProps<{
    x: number
    y: number
    width: number
    height: number
    color: Color
    player: Player
}>()

const gameState = useGameStateStore()
const gameBus = useGameBusStore()

const playerColor = player.color.clone().darken(20).desaturate(60)

const poolDiamond = refObj<GameObjects.Polygon>()

const diamondVertices = [
    [-19, 0],
    [0, 15],
    [19, 0],
    [0, -15],
]

function onBoundariesCreate(boundaries: GameObjects.Rectangle) {
    boundaries.setInteractive({ draggable: false })
}

function onPoolDiamondCreate(poolDiamond: GameObjects.Polygon) {
    poolDiamond.setInteractive({
        hitArea: new Phaser.Geom.Polygon(diamondVertices.flat()),
        hitAreaCallback: Phaser.Geom.Polygon.Contains,
        cursor: 'pointer',
    })
}

function onTheEdgeCreate(theEdge: GameObjects.Image) {
    theEdge.setInteractive({
        cursor: 'pointer',
    })
}

function onPoolDiamondPointerUp() {
    if (gameState.isPlayer) {
        gameBus.changePool = { show: true, player }
    }
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
    playerOid: player.oid,
    getWorldPosition,
}
onMounted(() => {
    gameBus.playersInGame[player.oid] = playerInGame
})
onBeforeUnmount(() => {
    delete gameBus.cardsInGame[player.oid]
})
</script>

<style lang="scss"></style>
