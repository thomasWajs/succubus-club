<template>
    <Container
        ref="container"
        :x="widgetDrag.isDragging.value ? widgetDrag.dragPos.x : player.widgetPosition.x"
        :y="widgetDrag.isDragging.value ? widgetDrag.dragPos.y : player.widgetPosition.y"
        :rotation="contentRotation"
        v-bind="widgetDrag.dragHandlers"
        @create="onContainerCreate"
    >
        <!-- Background / drag handle : a circle so the widget reads the same at
        any orientation, and its upright content stays legible for every seat -->
        <Circle
            :x="0"
            :y="0"
            :radius="RADIUS"
            :lineWidth="2"
            :strokeColor="playerColor.color"
            :fillColor="Colors.REGION_BACKGROUND.color"
            :fillAlpha="Colors.REGION_BACKGROUND.alphaGL"
        />

        <!-- Username -->
        <Text
            :text="player.shortName"
            :style="{ color: playerColor.rgba, fontStyle: 'Bold', fontSize: '16px' }"
            :origin="0.5"
            :x="0"
            :y="USERNAME_Y"
        />

        <!-- Pool -->
        <PoolWidget
            :x="0"
            :y="POOL_Y"
            :player="player"
        />

        <!-- Library | Crypt : own widget shows the top card ; opponents only get
        a small labeled box, like removed/hand just below -->
        <StackWidget
            :x="COLUMN_LEFT_X"
            :y="isOwnWidget ? LIBRARY_CRYPT_Y : LIBRARY_CRYPT_Y + BOX_HEIGHT / 2"
            :width="isOwnWidget ? STACK_WIDTH : BOX_WIDTH"
            :height="isOwnWidget ? STACK_HEIGHT : BOX_HEIGHT"
            :cardRegion="player.library"
            :showTopCard="isOwnWidget"
        />

        <StackWidget
            :x="COLUMN_RIGHT_X"
            :y="isOwnWidget ? LIBRARY_CRYPT_Y : LIBRARY_CRYPT_Y + BOX_HEIGHT / 2"
            :width="isOwnWidget ? STACK_WIDTH : BOX_WIDTH"
            :height="isOwnWidget ? STACK_HEIGHT : BOX_HEIGHT"
            :cardRegion="player.crypt"
            :showTopCard="isOwnWidget"
        />

        <!-- Removed | Hand -->
        <StackWidget
            :x="COLUMN_LEFT_X"
            :y="REMOVED_HAND_Y"
            :width="BOX_WIDTH"
            :height="BOX_HEIGHT"
            :cardRegion="player.removed"
        />

        <StackWidget
            :x="COLUMN_RIGHT_X"
            :y="REMOVED_HAND_Y"
            :width="BOX_WIDTH"
            :height="BOX_HEIGHT"
            :cardRegion="player.hand"
        />

        <!-- Ash Heap -->
        <StackWidget
            :x="0"
            :y="ASH_HEAP_Y"
            :width="STACK_WIDTH"
            :height="STACK_HEIGHT"
            :cardRegion="player.ashHeap"
            :showTopCard="true"
        />

        <!-- Target hit area : while declaring a target, an opponent's widget can
        be clicked to target that player, mirroring the play-area outline in
        structured mode ( see PlayAreaGO.vue ). A disc on top so a click anywhere
        on the widget targets ; input.ts reads the player from PhaserDataKey.Player
        on this container. Only a stroke ( no fill ) so the content stays visible,
        highlighted on hover. -->
        <Circle
            v-if="!isOwnWidget"
            :visible="!!gameBus.declaringTargetOrigin"
            :x="0"
            :y="0"
            :radius="RADIUS"
            :lineWidth="playerIsOutlined ? CARD_OUTLINE_THICKNESS : 1"
            :strokeColor="playerIsOutlined ? Colors.CARD_OUTLINE_HOVER.color : playerColor.color"
            @pointerover="isTargetHovered = true"
            @pointerout="isTargetHovered = false"
        />
    </Container>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { GameObjects } from 'phaser'
import { Circle, Container, refObj, Text } from 'phavuer'
import { Colors } from '@/client/colors.ts'
import { CARD_OUTLINE_THICKNESS, FREE_TABLE_WIDGET_RADIUS } from '@/shared/const/game.ts'
import { PhaserDataKey } from '@/client/game/types.ts'
import { Player } from '@/shared/model/Player.ts'
import { Point2D } from '@/shared/types/model.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { getPlayerColor } from '@/client/game/utils.ts'
import { cameraTick, getFreeTableCameraRotation } from '@/client/game/camera.ts'
import { useWidgetDrag } from '@/client/game/composables/useWidgetDrag.ts'
import PoolWidget from '@/client/game/objects/PoolWidget.vue'
import StackWidget from '@/client/game/objects/StackWidget.vue'

const { player } = defineProps<{
    player: Player
}>()

// Circle widget. Content stacks compactly, with two two-column rows keeping
// the disc small :
//   username
//   pool
//   library | crypt
//   removed  | hand
//   ash heap
// Opponents' library/crypt collapse to small boxes ( see template ).
const RADIUS = FREE_TABLE_WIDGET_RADIUS

// Row centers, top to bottom, laid out symmetrically about the disc center
const USERNAME_Y = -93
const POOL_Y = -65
const LIBRARY_CRYPT_Y = -18
const REMOVED_HAND_Y = 28
const ASH_HEAP_Y = 74

// Shared columns for the two two-column rows
const COLUMN_LEFT_X = -51
const COLUMN_RIGHT_X = 51

// Stacks that show their top card ( library, crypt, ash heap )
const STACK_WIDTH = 96
const STACK_HEIGHT = 56

// Plain labeled boxes ( removed, hand )
const BOX_WIDTH = 96
const BOX_HEIGHT = 24

const players = usePlayersStore()
const gameBus = useGameBusStore()

const playerColor = getPlayerColor(player)

/**
 * The widget body no longer faces the table center ( which left opponents'
 * text upside down ) : it counter-rotates the camera so its content always
 * reads upright for the local viewer, at any seat and any camera rotation.
 * `cameraTick` is read purely to re-run this when the camera pans/rotates
 * outside of Vue's reactivity ( see camera.ts ).
 */
const contentRotation = computed(() => {
    void cameraTick.value
    return -getFreeTableCameraRotation()
})

/**
 * Drag to reposition the widget on the table.
 * Only the owning player can drag their own widget, mirroring how separators
 * can only be dragged by the player they belong to.
 */

const container = refObj<GameObjects.Container>()

const isOwnWidget = player.oid == players.selfPlayerOid

/**
 * Target declaration : an opponent's widget can be clicked to target that
 * player while an arrow is being drawn ( see the Rectangle hit area in the
 * template and input.ts ). Highlight it on hover, matching PlayAreaGO.vue.
 */
const isTargetHovered = ref(false)
const playerIsOutlined = computed(
    () => isTargetHovered.value && gameBus.declaringTargetOrigin != null && !isOwnWidget,
)

const widgetDrag = useWidgetDrag({
    canDrag: isOwnWidget,
    getPosition: () => player.widgetPosition,
    onMoved: position => gameMutations.FT_movePlayerWidget.actSelf({ player, ...position }),
    width: 2 * RADIUS,
    height: 2 * RADIUS,
})

function onContainerCreate(containerObject: GameObjects.Container) {
    containerObject.setName('playerWidget')
    containerObject.setData(PhaserDataKey.Player, player)
    widgetDrag.onCreate(containerObject)
}

/**
 * World position ( for arrows )
 */

function getWorldPosition(): Point2D | null {
    if (!container.value) {
        return null
    }
    return container.value.getWorldTransformMatrix().transformPoint(0, 0)
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
    delete gameBus.playersInGame[player.oid]
})
</script>

<style lang="scss"></style>
