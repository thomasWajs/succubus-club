<template>
    <Container
        v-if="!players.hiddenPlayers.has(player.oid)"
        ref="playArea"
        @create="onContainerCreate"
    >
        <PlayerBarGo
            :x="0"
            :y="0"
            :width="PLAY_AREA_WIDTH"
            :height="PLAYER_BAR_HEIGHT"
            :color="playerColor"
            :player="player"
        />

        <RegionGO
            key="Ready"
            :x="0"
            :y="PLAYER_BAR_HEIGHT"
            :width="PLAY_AREA_WIDTH"
            :height="player.separators.horizontalY - PLAYER_BAR_HEIGHT"
            :color="playerColor"
            :cardRegion="player.ready"
        />

        <RegionGO
            key="Torpor"
            :x="0"
            :y="player.separators.horizontalY"
            :width="player.separators.verticalX"
            :height="TORPOR_ZONE_BOTTOM - player.separators.horizontalY"
            :color="playerColor"
            :cardRegion="player.torpor"
        />

        <RegionGO
            key="Uncontrolled"
            :x="player.separators.verticalX"
            :y="player.separators.horizontalY"
            :width="PLAY_AREA_WIDTH - player.separators.verticalX"
            :height="TORPOR_ZONE_BOTTOM - player.separators.horizontalY"
            :color="playerColor"
            :cardRegion="player.uncontrolled"
        />

        <!-- Vertical separator line -->
        <Rectangle
            v-if="player == players.selfPlayer"
            :key="'verticalSeparatorKey' + verticalSeparatorKey"
            :origin="0"
            :x="separators.vertical.dragX ? separators.vertical.dragX : player.separators.verticalX"
            :y="player.separators.horizontalY"
            :width="1"
            :height="TORPOR_ZONE_BOTTOM - player.separators.horizontalY"
            :fillColor="separators.vertical.over ? Colors.WHITE.color : playerColor.color"
            @create="onVerticalSeparatorCreate"
            @pointerover="separators.vertical.over = true"
            @pointerout="separators.vertical.over = false"
            @drag="onVerticalSeparatorDrag"
            @dragend="onVerticalSeparatorDragEnd"
        />

        <!-- Horizontal separator line -->
        <Rectangle
            v-if="player == players.selfPlayer"
            key="horizontalSeparator"
            :origin="0"
            :x="0"
            :y="
                separators.horizontal.dragY ?
                    separators.horizontal.dragY
                :   player.separators.horizontalY
            "
            :width="PLAY_AREA_WIDTH"
            :height="1"
            :fillColor="separators.horizontal.over ? Colors.WHITE.color : playerColor.color"
            @create="onHorizontalSeparatorCreate"
            @pointerover="separators.horizontal.over = true"
            @pointerout="separators.horizontal.over = false"
            @drag="onHorizontalSeparatorDrag"
            @dragend="onHorizontalSeparatorDragEnd"
        />

        <RegionCardStackGo
            key="AshHeap"
            :x="0"
            :y="CARD_STACKS_Y"
            :width="(PLAY_AREA_WIDTH / 9) * 2 - 8"
            :height="CARD_STACKS_HEIGHT"
            :color="playerColor"
            :cardRegion="player.ashHeap"
            :showTopCard="true"
        />
        <RegionCardStackGo
            key="Library"
            :x="(PLAY_AREA_WIDTH / 9) * 2 + 2"
            :y="CARD_STACKS_Y"
            :width="(PLAY_AREA_WIDTH / 9) * 2 - 8"
            :height="CARD_STACKS_HEIGHT"
            :color="playerColor"
            :cardRegion="player.library"
            :showTopCard="true"
            :draw="player == players.selfPlayer ? 'library' : undefined"
        />
        <RegionCardStackGo
            key="Crypt"
            :x="(PLAY_AREA_WIDTH / 9) * 4 + 4"
            :y="CARD_STACKS_Y"
            :width="(PLAY_AREA_WIDTH / 9) * 2 - 8"
            :height="CARD_STACKS_HEIGHT"
            :color="playerColor"
            :cardRegion="player.crypt"
            :showTopCard="true"
            :draw="player == players.selfPlayer ? 'crypt' : undefined"
        />
        <RegionCardStackGo
            key="Removed"
            :x="(PLAY_AREA_WIDTH / 9) * 6 + 6"
            :y="CARD_STACKS_Y"
            :width="PLAY_AREA_WIDTH / 9 - 8"
            :height="CARD_STACKS_HEIGHT"
            :color="playerColor"
            :cardRegion="player.removed"
            :showTopCard="false"
        />
        <RegionCardStackGo
            key="Hand"
            :x="(PLAY_AREA_WIDTH / 9) * 7 + 8"
            :y="CARD_STACKS_Y"
            :width="PLAY_AREA_WIDTH / 9 - 8"
            :height="CARD_STACKS_HEIGHT"
            :color="playerColor"
            :cardRegion="player.hand"
            :showTopCard="false"
        />

        <RegionTheEdgeGO
            key="TheEdge"
            :x="(PLAY_AREA_WIDTH / 9) * 8 + 8"
            :y="CARD_STACKS_Y"
            :width="PLAY_AREA_WIDTH / 9 - 8"
            :height="CARD_STACKS_HEIGHT"
            :color="playerColor"
            :player="player"
        />

        <Rectangle
            v-if="player.isOusted"
            ref="oustedOverlay"
            :origin="0"
            :x="0"
            :y="0"
            :width="PLAY_AREA_WIDTH"
            :height="PLAY_AREA_HEIGHT"
            :fillColor="0x808080"
            :alpha="0.5"
        />

        <Text
            v-if="player.isOusted"
            ref="oustedText"
            :originY="0.4"
            :originX="0.5"
            :x="PLAY_AREA_WIDTH / 2"
            :y="CONTROLLED_ZONE_HEIGHT / 2 - 40"
            text="OUSTED"
            :style="{
                color: '#a63446',
                fontSize: '52px',
                fontStyle: 'bold',
            }"
        />

        <ButtonGo
            v-if="player.isOusted"
            ref="hidePLayAreaButton"
            name="hidePLayAreaButton"
            :x="PLAY_AREA_WIDTH / 2"
            :y="CONTROLLED_ZONE_HEIGHT / 2 + 40"
            :width="200"
            :height="50"
            text="Hide Play Area"
            :textStyle="{ fontSize: '20px' }"
            @click="players.toggleHidden(player.oid)"
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
            :strokeColor="playerIsOutlined ? Colors.CARD_OUTLINE_HOVER.color : playerColor.color"
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
            :strokeColor="Colors.ALIGNMENT_GUIDE.color"
        />

        <CardGroupGO v-if="player == players.selfPlayer" />
    </Container>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Container, Line, Rectangle, refObj, Text } from 'phavuer'
import { Colors } from '@/client/colors.ts'
import {
    ALIGNMENT_GUIDE_OVERSHOOT,
    ALIGNMENT_GUIDE_WIDTH,
    CARD_HEIGHT,
    CARD_OUTLINE_THICKNESS,
    CARD_STACKS_HEIGHT,
    CARD_STACKS_Y,
    CARD_WIDTH,
    CONTROLLED_ZONE_HEIGHT,
    GRID_SIZE,
    HORIZONTAL_SEPARATOR_MAX_Y,
    HORIZONTAL_SEPARATOR_MIN_Y,
    PLAY_AREA_HEIGHT,
    PLAY_AREA_WIDTH,
    PLAYER_BAR_HEIGHT,
    TORPOR_ZONE_BOTTOM,
    VERTICAL_SEPARATOR_MAX_X,
    VERTICAL_SEPARATOR_MIN_X,
} from '@/shared/const/game.ts'
import RegionGO from '@/client/game/objects/RegionGO.vue'
import RegionCardStackGo from './RegionCardStackGO.vue'
import { Player } from '@/shared/model/Player.ts'
import PlayerBarGo from '@/client/game/objects/PlayerBarGo.vue'
import { PhaserDataKey } from '@/client/game/types.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { GUIDE_VERTICAL } from '@/shared/types/state.ts'
import CardGroupGO from '@/client/game/objects/CardGroupGO.vue'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { Snap } from '@/shared/utils.ts'
import { getPlayerColor } from '@/client/game/utils.ts'
import ButtonGo from '@/client/game/objects/ButtonGo.vue'
import RegionTheEdgeGO from '@/client/game/objects/RegionTheEdgeGO.vue'

const { player } = defineProps<{
    player: Player
}>()

const gameBus = useGameBusStore()
const players = usePlayersStore()

const oustedOverlay = refObj<GameObjects.Rectangle>()
const oustedText = refObj<GameObjects.Text>()
const hidePLayAreaButton = ref<typeof ButtonGo>()
function onContainerCreate(container: GameObjects.Container) {
    container.setData(PhaserDataKey.Player, player)

    function bringOustedToTop() {
        if (!player.isOusted) {
            return
        }
        if (oustedOverlay.value) {
            container.bringToTop(oustedOverlay.value)
        }
        if (oustedText.value) {
            container.bringToTop(oustedText.value)
        }
        hidePLayAreaButton.value?.bringToTop()
    }
    container.setData(PhaserDataKey.BringOustedToTop, bringOustedToTop)
}

const isHovered = ref(false)
function onPointerOver() {
    isHovered.value = true
}
function onPointerOut() {
    isHovered.value = false
}
const playerIsOutlined = computed(() => {
    return isHovered.value && gameBus.declaringTargetOrigin != null && player != players.selfPlayer
})

const playerColor = getPlayerColor(player)

onMounted(() => {
    // Bring all the cards on top of the outline rectangle
    for (const card of Object.values(gameBus.cardsInGame)) {
        card.bringToTop()
    }
})

/**
 * Separators
 */

const SEPARATOR_HIT_AREA_SIZE = 10

const separators = reactive({
    vertical: {
        over: false,
        dragX: 0,
    },
    horizontal: {
        over: false,
        dragY: 0,
    },
})

const verticalSeparatorKey = ref(0)
function onVerticalSeparatorCreate(separator: GameObjects.Rectangle) {
    separator.setInteractive({
        // wider hit area for easier grabbing
        hitArea: new Phaser.Geom.Rectangle(
            -SEPARATOR_HIT_AREA_SIZE / 2,
            0,
            SEPARATOR_HIT_AREA_SIZE,
            CARD_STACKS_Y - player.separators.horizontalY,
        ),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        cursor: 'ew-resize',
        draggable: true,
    })
    separator.setName('separator')

    // For the f**k of me I can't find why Phaser refuse
    // to update correctly the hitArea of this separator.
    // I give up, and just re-construct the Rectangle object
    // each time the y position change.
    watch(
        () => player.separators.horizontalY,
        () => {
            verticalSeparatorKey.value = verticalSeparatorKey.value + 1
        },
    )
}

function onVerticalSeparatorDrag({}, dragX: number) {
    // Clamp the position within bounds
    separators.vertical.dragX = Snap.to(
        Phaser.Math.Clamp(dragX, VERTICAL_SEPARATOR_MIN_X, VERTICAL_SEPARATOR_MAX_X),
        GRID_SIZE,
    )
}

function onVerticalSeparatorDragEnd() {
    if (!players.selfPlayer) {
        return
    }
    gameMutations.UI_changeSeparators.actSelf({
        player: players.selfPlayer,
        verticalX: separators.vertical.dragX,
    })
    separators.vertical.dragX = 0
}

function onHorizontalSeparatorCreate(separator: GameObjects.Rectangle) {
    separator.setInteractive({
        // taller hit area for easier grabbing
        hitArea: new Phaser.Geom.Rectangle(
            0,
            -SEPARATOR_HIT_AREA_SIZE / 2,
            PLAY_AREA_WIDTH,
            SEPARATOR_HIT_AREA_SIZE,
        ),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        cursor: 'ns-resize',
    })
    separator.setName('separator')
}

function onHorizontalSeparatorDrag({}, {}, dragY: number) {
    // Clamp the position within bounds
    separators.horizontal.dragY = Snap.to(
        Phaser.Math.Clamp(dragY, HORIZONTAL_SEPARATOR_MIN_Y, HORIZONTAL_SEPARATOR_MAX_Y),
        GRID_SIZE,
    )
}

function onHorizontalSeparatorDragEnd() {
    if (!players.selfPlayer) {
        return
    }
    gameMutations.UI_changeSeparators.actSelf({
        player: players.selfPlayer,
        horizontalY: separators.horizontal.dragY,
    })
    separators.horizontal.dragY = 0
}

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
