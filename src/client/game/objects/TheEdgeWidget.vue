<template>
    <Image
        :texture="Texture.TheEdgeBig"
        :origin="0.5"
        :x="widgetDrag.isDragging.value ? widgetDrag.dragPos.x : gameState.theEdgeWidgetPosition.x"
        :y="widgetDrag.isDragging.value ? widgetDrag.dragPos.y : gameState.theEdgeWidgetPosition.y"
        v-bind="widgetDrag.dragHandlers"
        @create="widgetDrag.onCreate"
    />
</template>

<script setup lang="ts">
import { Image } from 'phavuer'
import { Texture } from '@/client/resources/textures.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { useWidgetDrag } from '@/client/game/composables/useWidgetDrag.ts'

const WIDGET_WIDTH = 200
const WIDGET_HEIGHT = 192

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
</script>

<style lang="scss"></style>
