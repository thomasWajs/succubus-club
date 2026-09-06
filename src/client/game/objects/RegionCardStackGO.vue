<template>
    <Rectangle
        ref="boundaries"
        :origin="0"
        :x="x - (highlightDropZone ? 4 : 0)"
        :y="y - (highlightDropZone ? 4 : 0)"
        :width="width + (highlightDropZone ? 8 : 0)"
        :height="height + (highlightDropZone ? 8 : 0)"
        :lineWidth="1"
        :strokeColor="isRegionHovered ? regionhigHlightColor.color : color.color"
        :strokeAlpha="isRegionHovered ? regionhigHlightColor.alphaGL : color.alphaGL"
        :fillColor="Colors.REGION_BACKGROUND.color"
        :fillAlpha="Colors.REGION_BACKGROUND.alphaGL"
        :dropZone="true"
        @create="onBoundariesCreate"
        @pointerover="onBoundariesPointerOver"
        @pointerout="onBoundariesPointerOut"
        @pointerdown="onBoundariesPointerDown"
    >
        <FxHighlightRegionDrop
            v-if="highlightDropZone"
            :color="color"
        />
    </Rectangle>

    <Rectangle
        :width="stackSizeWidth"
        :height="28"
        :fillColor="Colors.REGION_STACK_SIZE_BACKGROUND.color"
        :lineWidth="1"
        :strokeColor="color.color"
        :strokeAlpha="0.5"
        :origin="0"
        :x="x + width - stackSizeWidth"
        :y="y"
    />

    <Text
        ref="cardCount"
        :text="cardRegion.cards.length.toString()"
        :style="{
            color: color.rgba,
            fontSize: 22,
        }"
        :origin="1"
        :x="x + width - 3"
        :y="y + 25"
    />

    <Text
        ref="regionName"
        :text="cardRegion.name"
        :style="{
            color: color.rgba,
            fontSize: 12,
        }"
        :alpha="0.7"
        :origin="1"
        :x="x + width - 3"
        :y="y + height - 5"
    />

    <Image
        v-if="showTopCard && topCard"
        ref="image"
        :texture="displayedTexture.textureName"
        :frame="displayedTexture.frameName"
        :x="x + (image ? image.displayHeight / 2 : 0) + 5"
        :y="y + (image ? image.displayWidth / 2 : 0) + 5"
        :scale="CARD_IN_STACK_SCALE"
        :rotation="Math.PI / 2"
        @create="onImageCreate"
        @pointermove="onImagePointerMove"
        @pointerover="onImagePointerOver"
        @pointerout="onImagePointerOut"
        @pointerdown="onImagePointerDown"
    />

    <Rectangle
        ref="cardOutline"
        :visible="drawHoverAttrs.isHovered"
        :x="x + (image ? image.displayHeight / 2 : 0) + 5"
        :y="y + (image ? image.displayWidth / 2 : 0) + 5"
        :width="image ? image.displayHeight : 0"
        :height="image ? image.displayWidth : 0"
        :lineWidth="CARD_OUTLINE_THICKNESS"
        :strokeColor="Colors.CARD_OUTLINE_HOVER.color"
    />

    <div
        v-show="drawHoverAttrs.isHovered && !cardRegion.isEmpty"
        class="game-tooltip"
        :style="{
            left: drawHoverAttrs.x - 40 + 'px',
            top: `${drawHoverAttrs.y + 40}px`,
        }"
    >
        Draw {{ draw }}
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Image, Rectangle, refObj, Text } from 'phavuer'
import { Colors } from '@/client/colors.ts'
import { CARD_IN_STACK_SCALE, CARD_OUTLINE_THICKNESS } from '@/shared/const/game.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { PhaserDataKey, RegionCategory } from '@/client/game/types.ts'
import { positionContextMenu } from '@/client/game/utils.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { useCardTexture } from '@/client/game/composables/useCardTexture.ts'
import FxHighlightRegionDrop from './FxHighlightRegionDrop.vue'
import { GameType } from '@/shared/types/state.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import Color = Phaser.Display.Color
import Pointer = Phaser.Input.Pointer

const { color, cardRegion, draw } = defineProps<{
    x: number
    y: number
    width: number
    height: number
    color: Color
    cardRegion: AnyCardRegion
    showTopCard: boolean
    draw?: 'crypt' | 'library'
}>()

const gameState = useGameStateStore()
const players = usePlayersStore()
const gameBus = useGameBusStore()

const image = refObj<GameObjects.Image>()

const topCard = computed(() => (cardRegion.length > 0 ? cardRegion.firstCard : null))
const displayedTexture = computed(() => {
    return topCard.value ?
            useCardTexture(topCard.value).displayedTexture.value
        :   { textureName: undefined, frameName: undefined }
})

const isRegionHovered = ref(false)
const regionhigHlightColor = computed(() => {
    return color.clone().lighten(25).brighten(10)
})

/**
 * Boundaries
 */

const WIELD_CARD_STACK_CURSOR = 'url(assets/wieldCardStack.png) 12 12, zoom-in'
function onBoundariesCreate(boundaries: GameObjects.Rectangle) {
    boundaries.setData(PhaserDataKey.CardRegionOid, cardRegion.oid)
    boundaries.setData(PhaserDataKey.RegionCategory, RegionCategory.Stack)

    // boundaries is already interactive because it declare a dropZone
    // so we update its cursor property instead of using setInteractive()
    if (boundaries.input) {
        boundaries.input.cursor = WIELD_CARD_STACK_CURSOR
    }
}

const highlightDropZone = computed(() => {
    return (
        players.isPlayer && // don't highlight for spectator
        gameBus.dragOver && // A drag is in progress
        gameBus.dragOver.cardRegion?.oid == cardRegion.oid && // This region is dragged over
        gameBus.dragOver.card.region.oid != cardRegion.oid // The dragged card is not already in this region
    )
})

function onBoundariesPointerOver() {
    isRegionHovered.value = true
    closeUpAshHeap()
}

function onBoundariesPointerOut() {
    isRegionHovered.value = false
    gameBus.assignPinnedCloseUpCard()
}

const stackSizeWidth = computed(() => {
    return cardRegion.cards.length > 9 ? 32 : 24
})

/**
 * Wield card stack on click
 */

function onBoundariesPointerDown() {
    gameBus.wieldCardStack.show = true
    gameBus.wieldCardStack.cardRegion = cardRegion
}

/**
 * Outline stack + tooltip on pointer over
 */

const drawHoverAttrs = reactive({
    isHovered: false,
    x: 0,
    y: 0,
})

function onImagePointerMove(pointer: Pointer) {
    if (canDraw.value) {
        drawHoverAttrs.isHovered = true
        drawHoverAttrs.x = pointer.x
        drawHoverAttrs.y = pointer.y
    }
}

function onImagePointerOver() {
    closeUpAshHeap()
}

function onImagePointerOut() {
    drawHoverAttrs.isHovered = false
    gameBus.assignPinnedCloseUpCard()
}

function onImageCreate(image: GameObjects.Image) {
    if (canDraw.value) {
        image.setInteractive({ draggable: false, cursor: 'pointer' })
    }
}

/**
 * Draw card on click
 */

// Normally, players can only draw from their own stacks.
// But in Puppeteer mode, the user can make anyone draw
const canDraw = computed(() => {
    return (
        draw &&
        (cardRegion.owner == players.selfPlayer || gameState.gameType === GameType.Puppeteer)
    )
})

function onImagePointerDown(pointer: Pointer) {
    const stackOwner = cardRegion.owner
    if (!canDraw.value || !stackOwner || !topCard.value) {
        return
    }

    if (pointer.leftButtonDown()) {
        if (draw == 'library') {
            gameMutations.drawLibrary.actSelf({
                player: stackOwner,
            })
        } else if (draw == 'crypt') {
            gameMutations.drawCrypt.actSelf({
                player: stackOwner,
            })
        }
    } else if (pointer.rightButtonDown()) {
        gameBus.selectedCards = [topCard.value]
        gameBus.contextMenu.cards = [topCard.value]
        gameBus.contextMenu.show = true
        gameBus.contextMenu.fromStackRegion = true
        const setXY = (x: number, y: number) => {
            gameBus.contextMenu.x = x
            gameBus.contextMenu.y = y
        }
        positionContextMenu(pointer.x, pointer.y, pointer.y, '.context-menu', setXY)
    }
}

/**
 * Closeup for stacks
 */

function closeUpAshHeap() {
    // Close up top card of the ash heap
    if (cardRegion.is.ashHeap && cardRegion.length > 0 && !gameBus.dragOver) {
        gameBus.setCloseUpCard(cardRegion.firstCard)
    }
}
</script>
