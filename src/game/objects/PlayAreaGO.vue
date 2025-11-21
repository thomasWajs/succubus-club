<template>
    <Container
        ref="playArea"
        @create="onContainerCreate"
    >
        <PlayerBarGo
            :x="0"
            :y="0"
            :width="PLAY_AREA_WIDTH"
            :height="PLAYER_BAR_HEIGHT"
            :color="player.color"
            :player="player"
        />

        <RegionGO
            key="Ready"
            :x="0"
            :y="PLAYER_BAR_HEIGHT"
            :width="PLAY_AREA_WIDTH"
            :height="CONTROLLED_ZONE_HEIGHT"
            :color="player.color"
            :cardRegion="player.ready"
        />

        <RegionGO
            key="Torpor"
            :x="0"
            :y="TORPOR_ZONE_Y"
            :width="PLAY_AREA_WIDTH / 2"
            :height="TORPOR_ZONE_HEIGHT"
            :color="player.color"
            :cardRegion="player.torpor"
        />

        <RegionGO
            key="Uncontrolled"
            :x="PLAY_AREA_WIDTH / 2"
            :y="TORPOR_ZONE_Y"
            :width="PLAY_AREA_WIDTH / 2"
            :height="TORPOR_ZONE_HEIGHT"
            :color="player.color"
            :cardRegion="player.uncontrolled"
        />

        <CardStackRegionGO
            key="AshHeap"
            :x="0"
            :y="CARD_STACKS_Y"
            :width="(PLAY_AREA_WIDTH / 8) * 2"
            :height="CARD_STACKS_HEIGHT"
            :color="player.color"
            :cardRegion="player.ashHeap"
            :showTopCard="true"
        />
        <CardStackRegionGO
            key="Library"
            :x="(PLAY_AREA_WIDTH / 8) * 2"
            :y="CARD_STACKS_Y"
            :width="(PLAY_AREA_WIDTH / 8) * 2"
            :height="CARD_STACKS_HEIGHT"
            :color="player.color"
            :cardRegion="player.library"
            :showTopCard="true"
            :draw="player == gameState.selfPlayer ? 'library' : undefined"
        />
        <CardStackRegionGO
            key="Crypt"
            :x="(PLAY_AREA_WIDTH / 8) * 4"
            :y="CARD_STACKS_Y"
            :width="(PLAY_AREA_WIDTH / 8) * 2"
            :height="CARD_STACKS_HEIGHT"
            :color="player.color"
            :cardRegion="player.crypt"
            :showTopCard="true"
            :draw="player == gameState.selfPlayer ? 'crypt' : undefined"
        />
        <CardStackRegionGO
            key="Removed"
            :x="(PLAY_AREA_WIDTH / 8) * 6"
            :y="CARD_STACKS_Y"
            :width="PLAY_AREA_WIDTH / 8"
            :height="CARD_STACKS_HEIGHT"
            :color="player.color"
            :cardRegion="player.removed"
            :showTopCard="false"
        />
        <CardStackRegionGO
            key="Hand"
            :x="(PLAY_AREA_WIDTH / 8) * 7"
            :y="CARD_STACKS_Y"
            :width="PLAY_AREA_WIDTH / 8"
            :height="CARD_STACKS_HEIGHT"
            :color="player.color"
            :cardRegion="player.hand"
            :showTopCard="false"
        />

        <Text
            v-if="player.isOusted"
            key="Ousted"
            :originY="0.4"
            :originX="0.5"
            :x="PLAY_AREA_WIDTH / 2"
            :y="CONTROLLED_ZONE_HEIGHT / 2"
            text="OUSTED"
            :style="{
                color: '#a63446',
                fontSize: '52px',
                fontStyle: 'bold',
            }"
        />

        <Rectangle
            ref="playerOutline"
            :origin="0"
            :x="0"
            :y="0"
            :visible="!!gameBus.declaringTargetOrigin"
            :height="PLAY_AREA_HEIGHT"
            :width="PLAY_AREA_WIDTH"
            :lineWidth="playerIsOutlined ? CARD_OUTLINE_THICKNESS : 1"
            :strokeColor="playerIsOutlined ? CARD_OUTLINE_COLOR_HOVER.color : player.color.color"
            @pointerover="onPointerOver"
            @pointerout="onPointerOut"
        />

        <Line
            v-for="(line, index) of alignmentLines"
            :key="index"
            :origin="0"
            :x1="line.x1"
            :y1="line.y1"
            :x2="line.x2"
            :y2="line.y2"
            :lineWidth="ALIGNMENT_GUIDE_WIDTH"
            :strokeColor="ALIGNMENT_GUIDE_COLOR.color"
        />
    </Container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Container, Line, Text, Rectangle } from 'phavuer'
import {
    CARD_OUTLINE_COLOR_HOVER,
    CARD_OUTLINE_THICKNESS,
    CARD_STACKS_HEIGHT,
    CARD_STACKS_Y,
    CONTROLLED_ZONE_HEIGHT,
    ALIGNMENT_GUIDE_COLOR,
    ALIGNMENT_GUIDE_WIDTH,
    PLAY_AREA_HEIGHT,
    PLAY_AREA_WIDTH,
    PLAYER_BAR_HEIGHT,
    TORPOR_ZONE_HEIGHT,
    TORPOR_ZONE_Y,
    ALIGNMENT_GUIDE_OVERSHOOT,
    CARD_WIDTH,
    CARD_HEIGHT,
} from '@/game/const.ts'
import RegionGO from '@/game/objects/RegionGO.vue'
import CardStackRegionGO from '@/game/objects/CardStackRegionGO.vue'
import { Player } from '@/model/Player.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import PlayerBarGo from '@/game/objects/PlayerBarGo.vue'
import { PhaserDataKey } from '@/game/types.ts'
import { useGameBusStore } from '@/store/bus.ts'
import { GUIDE_VERTICAL } from '@/state/types.ts'

const { player } = defineProps<{
    player: Player
}>()

const gameState = useGameStateStore()
const gameBus = useGameBusStore()

function onContainerCreate(container: GameObjects.Container) {
    container.setData(PhaserDataKey.Player, player)
}

const isHovered = ref(false)
function onPointerOver() {
    isHovered.value = true
}
function onPointerOut() {
    isHovered.value = false
}
const playerIsOutlined = computed(() => {
    return (
        isHovered.value && gameBus.declaringTargetOrigin != null && player != gameState.selfPlayer
    )
})

onMounted(() => {
    // Bring all the cards on top of the outline rectangle
    for (const card of Object.values(gameBus.cardsInGame)) {
        card.bringToTop()
    }
})

/**
 * Alignment guides
 */

const alignmentLines = computed(() => {
    if (gameBus.dragOver?.cardRegion?.owner != player) {
        return []
    }

    const lines: Phaser.Geom.Line[] = []

    for (const guide of gameBus.alignmentGuides) {
        // Vertical line
        if (guide.type === GUIDE_VERTICAL) {
            const minY = Math.min(guide.dragY, ...guide.withCards.map(card => card.y))
            const maxY = Math.max(guide.dragY, ...guide.withCards.map(card => card.y))
            const height = CARD_HEIGHT * guide.scale

            lines.push(
                new Phaser.Geom.Line(
                    guide.dragX,
                    minY - ALIGNMENT_GUIDE_OVERSHOOT,
                    guide.dragX,
                    maxY + height + ALIGNMENT_GUIDE_OVERSHOOT,
                ),
            )
        }
        // Horizontal line
        else {
            const minX = Math.min(guide.dragX, ...guide.withCards.map(card => card.x))
            const maxX = Math.max(guide.dragX, ...guide.withCards.map(card => card.x))
            const width = CARD_WIDTH * guide.scale

            lines.push(
                new Phaser.Geom.Line(
                    minX - ALIGNMENT_GUIDE_OVERSHOOT,
                    guide.dragY,
                    maxX + width + ALIGNMENT_GUIDE_OVERSHOOT,
                    guide.dragY,
                ),
            )
        }
    }

    return lines
})
</script>
