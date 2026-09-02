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
        v-if="players.isPlayer"
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
        :fillColor="Colors.WHITE.color"
        :fillAlpha="0.6"
        :lineWidth="COUNTER_OUTLINE_THICKNESS"
        :strokeColor="Colors.BLACK.color"
        :origin="0"
        :x="x + width / 2"
        :y="y + height / 2"
        @create="onPoolDiamondCreate"
        @pointerdown.stop="onPoolDiamondPointerDown"
    />
    <Text
        :text="player.pool.toString()"
        :style="COUNTER_TEXT_STYLE"
        :origin="0.5"
        :x="x + width / 2"
        :y="y + height / 2"
        @create="onPoolTextCreate"
        @pointerdown.stop="onPoolDiamondPointerDown"
    />

    <!-- Plus Pool -->
    <ButtonGo
        v-if="players.isPlayer"
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

    <!-- Ballots ( only shown when the player has at least one ) -->
    <Text
        v-if="aidsEnabled && totalBallots >= 1"
        :text="totalBallots + ' ballot'"
        :style="{
            color: '#000',
            fontStyle: 'Bold',
            fontSize: '16px',
        }"
        :origin="1"
        :x="x + width - 130"
        :y="y + 22"
    />

    <!-- Votes -->
    <Text
        v-if="aidsEnabled"
        :text="totalVotes + ' vote'"
        :style="{
            color: '#000',
            fontStyle: 'Bold',
            fontSize: '16px',
        }"
        :origin="1"
        :x="x + width - 60"
        :y="y + 22"
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
import { computed, onBeforeUnmount, onMounted } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Polygon, Rectangle, refObj, Text } from 'phavuer'
import { Colors } from '@/client/colors.ts'
import { COUNTER_OUTLINE_THICKNESS, COUNTER_TEXT_STYLE } from '@/shared/const/game.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { Player } from '@/shared/model/Player.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import ButtonGo from '@/client/game/objects/ButtonGo.vue'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { getPlayerColor } from '@/client/game/utils.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import Color = Phaser.Display.Color

const { x, y, width, height, color, player } = defineProps<{
    x: number
    y: number
    width: number
    height: number
    color: Color
    player: Player
}>()

const players = usePlayersStore()
const gameBus = useGameBusStore()
const { aidsEnabled } = useUIFeatures()

const playerColor = getPlayerColor(player).darken(20).desaturate(60)

// Total votes and ballots granted by the player's vampires in the ready region
const totalVotes = computed(() =>
    player.vampiresReady.reduce((sum, vampire) => sum + vampire.vampireAttrs.vote, 0),
)
const totalBallots = computed(() =>
    player.vampiresReady.reduce((sum, vampire) => sum + vampire.vampireAttrs.ballot, 0),
)

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
