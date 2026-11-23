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
        :fillAlpha="barAlpha"
        @create="onBoundariesCreate"
    />

    <!-- Active player : purple in the centre, fading out toward both ends. It breathes
         ( onPreUpdate ) : spreads from the centre, then contracts back -->
    <Image
        v-if="isActive && !isLightUi"
        ref="activeGradient"
        :texture="FADE_TEXTURE_KEY"
        :originX="0.5"
        :originY="0"
        :x="x + width / 2"
        :y="y"
        :scaleX="width / FADE_TEXTURE_WIDTH"
        :scaleY="height / FADE_TEXTURE_HEIGHT"
        :tint="Colors.ACTIVE_PLAYER_GRADIENT.color"
        :alpha="ACTIVE_PLAYER_GRADIENT_ALPHA"
    />

    <!-- Before the name : the active player icon, then disconnected ( multiplayer ) -->
    <Image
        v-if="isActive"
        :texture="iconTextureKey('active')"
        :originX="0"
        :originY="0.5"
        :x="x + 5"
        :y="y + height / 2"
        :scale="ACTIVE_ICON_SIZE / CANVAS_ICON_SIZE"
        :tint="Colors.ACTIVE_PLAYER_ICON.color"
    />
    <Image
        v-if="isDisconnected"
        :texture="iconTextureKey('disconnected')"
        :origin="0"
        :x="disconnectedIconX"
        :y="y + 6"
        :scale="DISCONNECTED_ICON_SIZE / CANVAS_ICON_SIZE"
        :tint="Colors.DISCONNECTED_ICON.color"
    />

    <!-- Player Name -->
    <Text
        :text="player.shortName"
        :style="{
            color: nameColor,
            fontSize: '18px',
        }"
        :origin="0"
        :x="nameX"
        :y="y + 5"
    />

    <!-- Minus Pool -->
    <ButtonGO
        v-if="players.isPlayer"
        :x="x + width / 2 - POOL_BUTTON_OFFSET"
        :y="y + height / 2"
        :width="POOL_BUTTON_WIDTH"
        :height="POOL_BUTTON_HEIGHT"
        icon="decrease"
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
    <ButtonGO
        v-if="players.isPlayer"
        :x="x + width / 2 + POOL_BUTTON_OFFSET"
        :y="y + height / 2"
        :width="POOL_BUTTON_WIDTH"
        :height="POOL_BUTTON_HEIGHT"
        icon="increase"
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
            color: textColor,
            fontSize: '16px',
        }"
        :originX="1"
        :originY="0.5"
        :x="vpLabelX - 92"
        :y="y + height / 2"
    />

    <!-- Votes -->
    <Text
        v-if="aidsEnabled"
        :text="totalVotes + ' Vote' + (totalVotes > 1 ? 's' : '')"
        :style="{
            color: textColor,
            fontSize: '16px',
        }"
        :originX="1"
        :originY="0.5"
        :x="vpLabelX - 38"
        :y="y + height / 2"
    />

    <!-- Victory Points : a label, then the count in a badge styled like the pool diamond -->
    <Text
        text="VP"
        :style="{
            color: textColor,
            fontSize: '16px',
        }"
        :originX="1"
        :originY="0.5"
        :x="vpLabelX"
        :y="y + height / 2"
    />
    <Rectangle
        :origin="0.5"
        :x="vpBadgeX"
        :y="y + height / 2"
        :width="VP_BADGE_WIDTH"
        :height="VP_BADGE_HEIGHT"
        :fillColor="Colors.WHITE.color"
        :fillAlpha="VP_BADGE_FILL_ALPHA"
        :lineWidth="COUNTER_OUTLINE_THICKNESS"
        :strokeColor="Colors.BLACK.color"
    />
    <Text
        :text="player.victoryPoints.toString()"
        :style="COUNTER_TEXT_STYLE"
        :origin="0.5"
        :x="vpBadgeX"
        :y="y + height / 2"
    />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Image, onPreUpdate, Polygon, Rectangle, refObj, Text } from 'phavuer'
import { Colors, playAreaTextColor, playerNameRgba } from '@/client/colors.ts'
import {
    ACTIVE_PLAYER_BAR_DESATURATE,
    ACTIVE_PLAYER_GRADIENT_ALPHA,
    ACTIVE_PLAYER_GRADIENT_MIN_REACH,
    ACTIVE_PLAYER_GRADIENT_PERIOD,
    COUNTER_OUTLINE_THICKNESS,
    COUNTER_TEXT_STYLE,
    PLAYER_BAR_DESATURATE,
    POOL_BUTTON_HEIGHT,
    POOL_BUTTON_OFFSET,
    POOL_BUTTON_WIDTH,
    VP_BADGE_FILL_ALPHA,
    VP_BADGE_HEIGHT,
    VP_BADGE_WIDTH,
} from '@/shared/const/game.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { isLightUi } from '@/client/gateway/uiTheme.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { Player } from '@/shared/model/Player.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import ButtonGO from '@/client/game/objects/ButtonGO.vue'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { getPlayerColor } from '@/client/game/utils.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import {
    CANVAS_ICON_SIZE,
    FADE_TEXTURE_HEIGHT,
    FADE_TEXTURE_KEY,
    FADE_TEXTURE_WIDTH,
    iconTextureKey,
} from '@/client/resources/textures.ts'
import Color = Phaser.Display.Color

// Same height as the 18px name
const DISCONNECTED_ICON_SIZE = 18
// Taller than the name : smaller, the skull is unreadable on the side bars, drawn scaled down
const ACTIVE_ICON_SIZE = 30
// Between the icons and the name
const ICON_GAP = 4

const { x, y, width, height, color, player } = defineProps<{
    x: number
    y: number
    width: number
    height: number
    color: Color
    player: Player
}>()

const players = usePlayersStore()
const gameState = useGameStateStore()
const gameBus = useGameBusStore()
const { aidsEnabled } = useUIFeatures()

const isActive = computed(() => gameState.activePlayer == player)

// Light : a greyed player color, half transparent, with black texts.
// Dark : a neutral bar, nearly opaque, with light texts and the name in the player color.
// The active player's bar differs by its background : less greyed in light, a breathing purple in
// the centre in dark ( same grey on the ends ). A star skull precedes its name, in both themes.
const playerColor = computed(() => {
    if (isLightUi.value) {
        const desaturate = isActive.value ? ACTIVE_PLAYER_BAR_DESATURATE : PLAYER_BAR_DESATURATE
        return getPlayerColor(player).darken(20).desaturate(desaturate)
    }
    return Colors.DARK_PLAYER_BAR
})

// Left side, from the edge : the active player icon, the disconnected icon, then the name
const disconnectedIconX = computed(() => x + 5 + (isActive.value ? ACTIVE_ICON_SIZE + ICON_GAP : 0))
const nameX = computed(
    () => disconnectedIconX.value + (isDisconnected.value ? DISCONNECTED_ICON_SIZE + ICON_GAP : 0),
)
// Right side, from the edge : the VP badge, its label, then the votes and ballots
const vpBadgeX = computed(() => x + width - 5 - VP_BADGE_WIDTH / 2)
const vpLabelX = computed(() => vpBadgeX.value - VP_BADGE_WIDTH / 2 - 5)
const nameColor = computed(() => (isLightUi.value ? playAreaTextColor() : playerNameRgba(player)))
const barAlpha = computed(() => (isLightUi.value ? 0.5 : 0.9))
const textColor = computed(playAreaTextColor)
const isDisconnected = computed(() => players.disconnectedPlayers.has(player.oid))

// Total votes and ballots granted by the player's vampires in the ready region
const totalVotes = computed(() =>
    player.vampiresReady.reduce((sum, vampire) => sum + vampire.vampireAttrs.vote, 0),
)
const totalBallots = computed(() =>
    player.vampiresReady.reduce((sum, vampire) => sum + vampire.vampireAttrs.ballot, 0),
)

const poolDiamond = refObj<GameObjects.Polygon>()

// Set on the game object each frame, outside of Vue's reactivity
const activeGradient = refObj<GameObjects.Image>()
onPreUpdate(time => {
    const gradient = activeGradient.value
    if (!gradient) {
        return
    }
    const wave = 0.5 - 0.5 * Math.cos((2 * Math.PI * time) / ACTIVE_PLAYER_GRADIENT_PERIOD)
    const reach = ACTIVE_PLAYER_GRADIENT_MIN_REACH + (1 - ACTIVE_PLAYER_GRADIENT_MIN_REACH) * wave
    gradient.scaleX = (width / FADE_TEXTURE_WIDTH) * reach
})

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
