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

    <!--
        Active player : a color in the centre, fading out toward both ends. It breathes
        ( onPreUpdate ) : spreads from the centre, then contracts back. Hidden rather than
        removed : created when the turn passes, it would be drawn over the bar's buttons
    -->
    <Image
        ref="activeGradient"
        :visible="isActive"
        :texture="gradientTexture"
        :originX="0.5"
        :originY="0"
        :x="x + width / 2"
        :y="y"
        :scaleX="width / FADE_TEXTURE_WIDTH"
        :scaleY="height / FADE_TEXTURE_HEIGHT"
        :tint="gradientColor.color"
        :alpha="gradientAlpha"
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

    <!--
        Ballots, votes and victory points : the count in a badge styled like the pool diamond,
        then a label
    -->
    <template
        v-for="badge in countBadges"
        :key="badge.label"
    >
        <Rectangle
            :origin="0.5"
            :x="badge.badgeX"
            :y="y + height / 2"
            :width="COUNT_BADGE_WIDTH"
            :height="COUNT_BADGE_HEIGHT"
            :fillColor="Colors.WHITE.color"
            :fillAlpha="COUNT_BADGE_FILL_ALPHA"
            :lineWidth="COUNTER_OUTLINE_THICKNESS"
            :strokeColor="Colors.BLACK.color"
            @create="onCountBadgeCreate"
        />
        <Text
            :text="badge.label"
            :style="{
                color: textColor,
                fontSize: '16px',
            }"
            :originX="0"
            :originY="0.5"
            :x="badge.badgeX + COUNT_BADGE_WIDTH / 2 + BADGE_TEXT_GAP"
            :y="y + height / 2"
        />
        <Text
            :text="badge.count.toString()"
            :style="COUNTER_TEXT_STYLE"
            :origin="0.5"
            :x="badge.badgeX"
            :y="y + height / 2"
        />
    </template>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Image, onPreUpdate, Polygon, Rectangle, refObj, Text, useScene } from 'phavuer'
import { Colors, playAreaTextColor, playerNameRgba } from '@/client/colors.ts'
import {
    ACTIVE_PLAYER_GRADIENT_ALPHA,
    ACTIVE_PLAYER_GRADIENT_MIN_REACH,
    ACTIVE_PLAYER_GRADIENT_PERIOD,
    COUNT_BADGE_FILL_ALPHA,
    COUNT_BADGE_HEIGHT,
    COUNT_BADGE_WIDTH,
    COUNTER_OUTLINE_THICKNESS,
    COUNTER_TEXT_STYLE,
    DARK_ACTIVE_PLAYER_GRADIENT_ALPHA,
    PLAYER_BAR_DESATURATE,
    POOL_BUTTON_HEIGHT,
    POOL_BUTTON_OFFSET,
    POOL_BUTTON_WIDTH,
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
    FADE_TEXTURE_WIDTH,
    fadeDither,
    fadeTextureKey,
    iconTextureKey,
} from '@/client/resources/textures.ts'
import Color = Phaser.Display.Color

// Same height as the 18px name
const DISCONNECTED_ICON_SIZE = 18
// Taller than the name : smaller, the skull is unreadable on the side bars, drawn scaled down
const ACTIVE_ICON_SIZE = 30
// Between the icons and the name
const NAME_ICON_GAP = 4
// Widest renders of the 16px Verdana labels ( "VP", "Votes", "Ballots" ), and the space between
// the badge groups
const VP_LABEL_WIDTH = 22
const VOTES_LABEL_WIDTH = 44
const BALLOTS_LABEL_WIDTH = 54
const BADGE_GROUP_GAP = 8
const BADGE_TEXT_GAP = 3

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
// The active player's bar has the same background, plus a breathing color in its centre : its seat
// color, not greyed, in light, a purple in dark. A star skull precedes its name.
const playerColor = computed(() => {
    if (isLightUi.value) {
        return getPlayerColor(player).darken(20).desaturate(PLAYER_BAR_DESATURATE)
    }
    return Colors.DARK_PLAYER_BAR
})
const gradientColor = computed(() =>
    isLightUi.value ? getPlayerColor(player).darken(20) : Colors.ACTIVE_PLAYER_GRADIENT,
)
const gradientAlpha = computed(() =>
    isLightUi.value ? ACTIVE_PLAYER_GRADIENT_ALPHA : DARK_ACTIVE_PLAYER_GRADIENT_ALPHA,
)
const scene = useScene()
const gradientTexture = computed(() =>
    fadeTextureKey(
        scene.textures,
        fadeDither(gradientAlpha.value, gradientColor.value, playerColor.value),
    ),
)

// Left side, from the edge : the active player icon, the disconnected icon, then the name
const disconnectedIconX = computed(
    () => x + 5 + (isActive.value ? ACTIVE_ICON_SIZE + NAME_ICON_GAP : 0),
)
const nameX = computed(
    () =>
        disconnectedIconX.value +
        (isDisconnected.value ? DISCONNECTED_ICON_SIZE + NAME_ICON_GAP : 0),
)
// Right side, from the edge : the VP, votes, then ballots groups, each a badge then its label
const vpBadgeX = computed(
    () => x + width - BADGE_TEXT_GAP - VP_LABEL_WIDTH - BADGE_TEXT_GAP - COUNT_BADGE_WIDTH / 2,
)
const votesBadgeX = computed(
    () => vpBadgeX.value - COUNT_BADGE_WIDTH - BADGE_GROUP_GAP - VOTES_LABEL_WIDTH - BADGE_TEXT_GAP,
)
const ballotsBadgeX = computed(
    () =>
        votesBadgeX.value -
        COUNT_BADGE_WIDTH -
        BADGE_GROUP_GAP -
        BALLOTS_LABEL_WIDTH -
        BADGE_TEXT_GAP,
)
const countBadges = computed(() => {
    const badges = [{ label: 'VP', count: player.victoryPoints, badgeX: vpBadgeX.value }]
    if (aidsEnabled.value) {
        badges.push({
            label: totalVotes.value > 1 ? 'Votes' : 'Vote',
            count: totalVotes.value,
            badgeX: votesBadgeX.value,
        })
        // Only when the player has at least one
        if (totalBallots.value >= 1) {
            badges.push({
                label: totalBallots.value > 1 ? 'Ballots' : 'Ballot',
                count: totalBallots.value,
                badgeX: ballotsBadgeX.value,
            })
        }
    }
    return badges
})
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

// Count badges : a pill with faceted ends ( Phaser draws the rounded corners of a Rectangle with
// radius / 5 segments, so 2 at this size )
function onCountBadgeCreate(badge: GameObjects.Rectangle) {
    badge.setRounded(COUNT_BADGE_HEIGHT / 2)
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
