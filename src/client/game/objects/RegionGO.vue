<template>
    <!-- Region boundaries -->
    <Rectangle
        ref="boundaries"
        :origin="0"
        :x="x"
        :y="y"
        :width="width"
        :height="height"
        :lineWidth="color ? 1 : 0"
        :strokeColor="color?.color"
        :strokeAlpha="color?.alphaGL"
        :fillColor="cardRegion.is.table ? undefined : Colors.REGION_BACKGROUND.color"
        :dropZone="true"
        @create="onBoundariesCreate"
    >
        <FxHighlightRegionDrop
            v-if="highlightDropZone && color"
            :color="color"
        />
    </Rectangle>

    <!-- Region name displayed as text -->
    <Text
        v-if="!cardRegion.is.table"
        ref="regionName"
        :text="cardRegion.name"
        :style="{
            color: color?.rgba,
        }"
        :alpha="0.7"
        :origin="1"
        :x="x + width - 5"
        :y="y + height - 5"
    />

    <!-- Cards for this region -->
    <CardGO
        v-for="card in cardRegion.cards"
        :key="cardRegion.name + card.oid"
        :card="card"
        :regionName="cardRegion.name"
    />

    <!-- Alignment guides, shown while dragging a card over this region -->
    <Line
        v-for="(line, index) of alignmentLines"
        :key="index"
        :origin="0"
        :x1="line.x1"
        :y1="line.y1"
        :x2="line.x2"
        :y2="line.y2"
        :lineWidth="ALIGNMENT_GUIDE_WIDTH"
        :strokeColor="Colors.ALIGNMENT_GUIDE.color"
    />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Line, Rectangle, Text } from 'phavuer'
import { usePlayersStore } from '@/client/state/players.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { Colors } from '@/client/colors.ts'
import CardGO from '@/client/game/objects/CardGO.vue'
import { PhaserDataKey, RegionCategory } from '@/client/game/types.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import FxHighlightRegionDrop from './FxHighlightRegionDrop.vue'
import {
    ALIGNMENT_GUIDE_OVERSHOOT,
    ALIGNMENT_GUIDE_WIDTH,
    CARD_HEIGHT,
    CARD_WIDTH,
} from '@/shared/const/game.ts'
import { GUIDE_VERTICAL } from '@/shared/types/state.ts'
import { rotateAroundPivot } from '@/shared/state/freeTableLayout.ts'
import { Point2D } from '@/shared/types/model.ts'
import Color = Phaser.Display.Color

const players = usePlayersStore()
const gameBus = useGameBusStore()

const { cardRegion } = defineProps<{
    x: number
    y: number
    width: number
    height: number
    color?: Color
    cardRegion: AnyCardRegion
}>()

const highlightDropZone = computed(() => {
    return (
        players.isPlayer && // don't highlight for spectators
        !cardRegion.is.ready &&
        !cardRegion.is.table &&
        gameBus.dragOver && // A drag is in progress
        gameBus.dragOver.cardRegion?.oid == cardRegion.oid && // This region is dragged over
        gameBus.dragOver.card.region.oid != cardRegion.oid // The dragged card is not already in this region
    )
})

function onBoundariesCreate(boundaries: GameObjects.Rectangle) {
    boundaries.setData(PhaserDataKey.CardRegionOid, cardRegion.oid)
    boundaries.setData(PhaserDataKey.RegionCategory, RegionCategory.Table)
}

/**
 * Alignment guides
 */

const alignmentLines = computed(() => {
    if (gameBus.dragOver?.cardRegion?.oid != cardRegion.oid) {
        return []
    }

    const lines: Phaser.Geom.Line[] = []

    for (const guide of gameBus.alignmentGuides) {
        // Points below are built in unrotated table space ( see
        // AlignmentGuide.rotation ) - rotate around the same pivot to match.
        const pivot: Point2D = { x: guide.dragX, y: guide.dragY }

        // Vertical line
        if (guide.type === GUIDE_VERTICAL) {
            const minY = Math.min(guide.dragY, ...guide.withCards.map(card => card.y))
            const maxY = Math.max(guide.dragY, ...guide.withCards.map(card => card.y))
            const height = CARD_HEIGHT * guide.scale

            const p1 = rotateAroundPivot(
                { x: guide.dragX, y: minY - ALIGNMENT_GUIDE_OVERSHOOT },
                pivot,
                guide.rotation,
            )
            const p2 = rotateAroundPivot(
                { x: guide.dragX, y: maxY + height + ALIGNMENT_GUIDE_OVERSHOOT },
                pivot,
                guide.rotation,
            )

            lines.push(new Phaser.Geom.Line(p1.x, p1.y, p2.x, p2.y))
        }
        // Horizontal line
        else {
            const minX = Math.min(guide.dragX, ...guide.withCards.map(card => card.x))
            const maxX = Math.max(guide.dragX, ...guide.withCards.map(card => card.x))
            const width = CARD_WIDTH * guide.scale

            const p1 = rotateAroundPivot(
                { x: minX - ALIGNMENT_GUIDE_OVERSHOOT, y: guide.dragY },
                pivot,
                guide.rotation,
            )
            const p2 = rotateAroundPivot(
                { x: maxX + width + ALIGNMENT_GUIDE_OVERSHOOT, y: guide.dragY },
                pivot,
                guide.rotation,
            )

            lines.push(new Phaser.Geom.Line(p1.x, p1.y, p2.x, p2.y))
        }
    }

    return lines
})
</script>
