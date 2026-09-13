<template>
    <!-- Minus Pool -->
    <ButtonGO
        v-if="players.isPlayer"
        :x="x - 40"
        :y="y"
        :width="26"
        :height="26"
        text="-"
        @click="gameMutations.changePool.actSelf({ player, amount: -1 })"
    />

    <!-- Current Pool -->
    <Polygon
        ref="poolDiamond"
        :points="diamondVertices"
        :fillColor="Colors.WHITE.color"
        :fillAlpha="0.6"
        :lineWidth="COUNTER_OUTLINE_THICKNESS"
        :strokeColor="Colors.BLACK.color"
        :origin="0"
        :x="x"
        :y="y"
        @create="onPoolDiamondCreate"
        @pointerdown.stop="onPoolDiamondPointerDown"
    />
    <Text
        :text="player.pool.toString()"
        :style="COUNTER_TEXT_STYLE"
        :origin="0.5"
        :x="x"
        :y="y"
        @create="onPoolTextCreate"
        @pointerdown.stop="onPoolDiamondPointerDown"
    />

    <!-- Plus Pool -->
    <ButtonGO
        v-if="players.isPlayer"
        :x="x + 40"
        :y="y"
        :width="26"
        :height="26"
        text="+"
        @click="gameMutations.changePool.actSelf({ player, amount: +1 })"
    />
</template>

<script setup lang="ts">
import Phaser, { GameObjects } from 'phaser'
import { Polygon, Text } from 'phavuer'
import { Colors } from '@/client/colors.ts'
import { COUNTER_OUTLINE_THICKNESS, COUNTER_TEXT_STYLE } from '@/shared/const/game.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { Player } from '@/shared/model/Player.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import ButtonGO from '@/client/game/objects/ButtonGO.vue'
import { gameMutations } from '@/shared/state/gameMutations.ts'

const { x, y, player } = defineProps<{
    x: number
    y: number
    player: Player
}>()

const players = usePlayersStore()
const gameBus = useGameBusStore()

const diamondVertices = [
    [-19, 0],
    [0, 15],
    [19, 0],
    [0, -15],
]

function onPoolDiamondCreate(poolDiamond: GameObjects.Polygon) {
    poolDiamond.setInteractive({
        hitArea: new Phaser.Geom.Polygon(diamondVertices.flat()),
        hitAreaCallback: Phaser.Geom.Polygon.Contains,
        cursor: 'pointer',
    })
}

function onPoolTextCreate(poolText: GameObjects.Text) {
    poolText.setInteractive({
        cursor: 'pointer',
    })
}

function onPoolDiamondPointerDown() {
    if (players.isPlayer && !gameBus.declaringTargetOrigin) {
        gameBus.changePool = { show: true, player }
    }
}
</script>

<style lang="scss"></style>
