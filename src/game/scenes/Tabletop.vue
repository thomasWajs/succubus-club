<template>
    <Scene
        key="Tabletop"
        name="Tabletop"
        :autoStart="false"
        @init="init"
        @update="update"
    >
        <template v-if="playerSeats.bottomLeft">
            <PlayAreaGO
                key="PlayAreaBottomLeft"
                :player="playerSeats.bottomLeft"
                :scale="OTHER_PLAYERS_SCALE"
                :x="0"
                :y="BOTTOM_PLAYERS_Y"
            />
        </template>

        <template v-if="playerSeats.topLeft">
            <PlayAreaGO
                key="PlayAreaTopLeft"
                :player="playerSeats.topLeft"
                :scale="OTHER_PLAYERS_SCALE"
                :x="0"
                :y="0"
            />
        </template>

        <template v-if="playerSeats.topRight">
            <PlayAreaGO
                key="PlayAreaBottomRight"
                :player="playerSeats.topRight"
                :scale="OTHER_PLAYERS_SCALE"
                :x="RIGHT_PLAYERS_X"
                :y="0"
            />
        </template>

        <template v-if="playerSeats.bottomRight">
            <PlayAreaGO
                key="PlayAreaTopRight"
                :player="playerSeats.bottomRight"
                :scale="OTHER_PLAYERS_SCALE"
                :x="RIGHT_PLAYERS_X"
                :y="BOTTOM_PLAYERS_Y"
            />
        </template>

        <PlayAreaGO
            v-if="gameState.centralPlayer"
            key="PlayAreaCenter"
            :player="gameState.centralPlayer"
            :x="PLAY_AREA_X"
            :y="PLAY_AREA_Y"
        />

        <HandGO
            v-if="gameState.selfPlayer"
            key="Hand"
        />

        <!-- Menus -->
        <ChangePoolMenu
            v-if="gameState.isPlayer"
            v-show="sceneReady"
        />
        <ContextMenu
            v-if="gameState.isPlayer"
            v-show="sceneReady"
        />
        <ContextSubmenu
            v-if="gameState.isPlayer"
            v-show="sceneReady"
        />

        <!-- Card Stack -->
        <WieldCardStack
            v-if="gameBus.wieldCardStack.show"
            :cardRegion="gameBus.wieldCardStack.cardRegion!"
        />

        <!-- Arrows -->
        <ArrowGo
            v-for="(arrow, index) in arrows"
            :key="'arrow' + index"
            :arrow="arrow"
        />

        <!-- Selection Area -->
        <SelectionArea />
    </Scene>
</template>

<script setup lang="ts">
import Phaser from 'phaser'
import { Scene } from 'phavuer'
import { useGameStateStore } from '@/store/gameState.ts'
import {
    OTHER_PLAYERS_SCALE,
    BOTTOM_PLAYERS_Y,
    RIGHT_PLAYERS_X,
    PLAY_AREA_X,
    PLAY_AREA_Y,
} from '@/game/const.ts'
import { useGameBusStore } from '@/store/bus.ts'
import PlayAreaGO from '@/game/objects/PlayAreaGO.vue'
import { computed, ref } from 'vue'
import ContextMenu from '@/ui/context/ContextMenu.vue'
import ContextSubmenu from '@/ui/context/ContextSubmenu.vue'
import WieldCardStack from '@/game/objects/WieldCardStack.vue'
import { useCoreStore } from '@/store/core.ts'
import { setupKeyboardHandlers, setupPointerHandlers } from '@/game/input.ts'
import { setupCamera } from '@/game/camera.ts'
import ArrowGo from '@/game/objects/ArrowGo.vue'
import { CardOid } from '@/model/Card.ts'
import { Arrow } from '@/state/types.ts'
import { PlayerOid } from '@/model/Player.ts'
import Vector2Like = Phaser.Types.Math.Vector2Like
import ChangePoolMenu from '@/ui/ingame/ChangePoolMenu.vue'
import HandGO from '@/game/objects/HandGO.vue'
import SelectionArea from '@/game/objects/SelectionArea.vue'

const core = useCoreStore()
const gameState = useGameStateStore()
const gameBus = useGameBusStore()

const sceneReady = ref(false)
let scene: Phaser.Scene | undefined

function init(_scene: Phaser.Scene) {
    scene = _scene
    setupCamera(scene)
    setupPointerHandlers(scene)
    setupKeyboardHandlers(scene)
}

let firstUpdate = true
function update() {
    if (firstUpdate) {
        sceneReady.value = true
        core.phaserIsReady = true
        firstUpdate = false
    }
}

/**
 * Player seating
 */

const playerSeats = computed(() => {
    return {
        bottomLeft: gameState.orderedPlayers.length >= 4 ? gameState.getNthNeighbour(1) : null,
        topLeft:
            gameState.orderedPlayers.length == 2 || gameState.orderedPlayers.length == 3 ?
                gameState.getNthNeighbour(1)
            : gameState.orderedPlayers.length > 3 ? gameState.getNthNeighbour(2)
            : null,
        topRight:
            gameState.orderedPlayers.length == 3 ? gameState.getNthNeighbour(2)
            : gameState.orderedPlayers.length >= 4 ? gameState.getNthNeighbour(3)
            : null,
        bottomRight: gameState.orderedPlayers.length >= 5 ? gameState.getNthNeighbour(4) : null,
    }
})

/**
 * Arrows
 */

function getWorldPosition(objectId?: CardOid | PlayerOid): Vector2Like | null {
    if (!objectId) {
        return null
    }

    if (objectId in gameBus.cardsInGame) {
        return gameBus.cardsInGame[objectId].getWorldPosition()
    }

    if (objectId in gameBus.playersInGame) {
        return gameBus.playersInGame[objectId].getWorldPosition()
    }

    return null
}

const arrows = computed(() => {
    const _arrows = [
        // The current declarating target, if any
        {
            from: getWorldPosition(gameBus.declaringTargetOrigin?.oid),
            to: {
                x: gameBus.pointerPosition?.x ?? 0,
                y: gameBus.pointerPosition?.y ?? 0,
            },
        },
        // The already declared targets
        ...gameState.targetDeclarations.map(arrow => {
            return {
                from: getWorldPosition(arrow.originOid),
                to: getWorldPosition(arrow.targetOid),
            }
        }),
    ]
    return _arrows.filter(arrow => arrow.from && arrow.to) as Arrow[]
})
</script>
