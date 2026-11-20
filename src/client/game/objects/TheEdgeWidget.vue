<template>
    <Container
        :x="widgetDrag.isDragging.value ? widgetDrag.dragPos.x : gameState.theEdgeWidgetPosition.x"
        :y="widgetDrag.isDragging.value ? widgetDrag.dragPos.y : gameState.theEdgeWidgetPosition.y"
        v-bind="widgetDrag.dragHandlers"
        @create="onContainerCreate"
    >
        <!-- The disc is drawn, not baked in the emblem image, so it follows the UI theme ( like the
        controlled Edge of the structured table, see RegionTheEdgeGO.vue ) -->
        <Circle
            :x="0"
            :y="0"
            :radius="DISC_RADIUS"
            :fillColor="Colors.THE_EDGE_CONTROLLED_DISC.color"
            :fillAlpha="1"
        />

        <Image
            :texture="Texture.TheEdgeEmblem"
            :origin="0.5"
            :x="0"
            :y="0"
        />
    </Container>
</template>

<script setup lang="ts">
import type { GameObjects } from 'phaser'
import { Circle, Container, Image } from 'phavuer'
import { Colors } from '@/client/colors.ts'
import { Texture } from '@/client/resources/textures.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { useWidgetDrag } from '@/client/game/composables/useWidgetDrag.ts'

const DISC_RADIUS = 48
// The grab area is the disc ( centered, unlike the hit area of an image )
const WIDGET_WIDTH = 2 * DISC_RADIUS
const WIDGET_HEIGHT = 2 * DISC_RADIUS

const gameState = useGameStateStore()
const players = usePlayersStore()

/**
 * Drag to reposition the widget on the table. Unlike PlayerWidget, this
 * widget is shared rather than owned by a single player, so any seated
 * player ( not a spectator ) can drag it.
 */

const widgetDrag = useWidgetDrag({
    canDrag: players.isPlayer,
    getPosition: () => gameState.theEdgeWidgetPosition,
    onMoved: position => gameMutations.FT_moveTheEdgeWidget.actSelf(position),
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
})

function onContainerCreate(containerObject: GameObjects.Container) {
    // Named so the pointer handlers don't start a selection area on it ( see input.ts )
    containerObject.setName('theEdgeWidget')
    widgetDrag.onCreate(containerObject)
}
</script>

<style lang="scss"></style>
