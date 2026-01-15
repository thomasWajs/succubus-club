<template>
    <Scene
        key="Tabletop"
        name="Tabletop"
        :autoStart="false"
        @init="init"
        @update="update"
    >
        <!-- Order of declaration is important here :
        Hand MUST come before the rest for drag alpha -->
        <HandGO
            v-if="gameState.selfPlayer"
            key="Hand"
        />

        <!-- Play areas for 3+ players, with a central player at the center of the screen -->
        <PlayAreaGO
            v-if="playerSeats.bottomLeft"
            key="PlayAreaBottomLeft"
            :player="playerSeats.bottomLeft"
            :scale="OTHER_PLAYERS_SCALE"
            :x="0"
            :y="BOTTOM_PLAYERS_Y"
        />
        <PlayAreaGO
            v-if="playerSeats.topLeft"
            key="PlayAreaTopLeft"
            :player="playerSeats.topLeft"
            :scale="OTHER_PLAYERS_SCALE"
            :x="0"
            :y="0"
        />
        <PlayAreaGO
            v-if="playerSeats.topRight"
            key="PlayAreaBottomRight"
            :player="playerSeats.topRight"
            :scale="OTHER_PLAYERS_SCALE"
            :x="RIGHT_PLAYERS_X"
            :y="0"
        />

        <PlayAreaGO
            v-if="playerSeats.bottomRight"
            key="PlayAreaTopRight"
            :player="playerSeats.bottomRight"
            :scale="OTHER_PLAYERS_SCALE"
            :x="RIGHT_PLAYERS_X"
            :y="BOTTOM_PLAYERS_Y"
        />

        <!-- Special layout for 2 players -->
        <PlayAreaGO
            v-if="playerSeats.opponent2P"
            key="PlayAreaLeft"
            :player="playerSeats.opponent2P"
            :x="TWO_PLAYERS_HORIZONTAL_GUTTER"
            :y="PLAY_AREA_Y"
        />

        <!--
        Play area of the "central player".
        If the user is a player, it's the self player.
        If the user is a spectator, it's the first player.
        In a 2 player game, the "central" player is actually on the right of the screen.
        -->
        <PlayAreaGO
            v-if="playerSeats.central"
            key="PlayAreaCenter"
            :player="playerSeats.central"
            :x="playerSeats.centralX"
            :y="PLAY_AREA_Y"
        />

        <!-- Menus -->
        <template v-if="gameState.isPlayer">
            <ChangePoolMenu v-show="sceneReady" />
            <ContextMenu v-show="sceneReady" />
            <ContextSubmenu v-show="sceneReady" />
            <FloatingActionsCloud v-if="actionDeclarationEnabled" />
        </template>

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
    BOTTOM_PLAYERS_Y,
    OTHER_PLAYERS_SCALE,
    PLAY_AREA_X,
    PLAY_AREA_Y,
    RIGHT_PLAYERS_X,
    TWO_PLAYERS_HORIZONTAL_GUTTER,
    WORLD_WIDTH,
} from '@/game/const.ts'
import { useGameBusStore } from '@/store/bus.ts'
import PlayAreaGO from '@/game/objects/PlayAreaGO.vue'
import { computed, ref } from 'vue'
import ContextMenu from '@/ui/context/menu/ContextMenu.vue'
import ContextSubmenu from '@/ui/context/menu/ContextSubmenu.vue'
import WieldCardStack from '@/game/objects/WieldCardStack.vue'
import { useCoreStore } from '@/store/core.ts'
import { setupKeyboardHandlers, setupPointerHandlers } from '@/game/input.ts'
import { setupCamera } from '@/game/camera.ts'
import ArrowGo from '@/game/objects/ArrowGo.vue'
import { CardOid } from '@/model/Card.ts'
import { Arrow } from '@/state/types.ts'
import { PlayerOid } from '@/model/Player.ts'
import ChangePoolMenu from '@/ui/ingame/ChangePoolMenu.vue'
import HandGO from '@/game/objects/HandGO.vue'
import SelectionArea from '@/game/objects/SelectionArea.vue'
import FloatingActionsCloud from '@/ui/context/floating/FloatingActionsCloud.vue'
import Vector2Like = Phaser.Types.Math.Vector2Like

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

const actionDeclarationEnabled = computed(
    () => core.userProfile.preferences.actionDeclaration ?? true,
)

/**
 * Player seating
 */

const playerSeats = computed(() => {
    // Special layout for 2 players
    if (gameState.is2pGame) {
        return {
            central: gameState.centralPlayer,
            // In a 2 player game, the "central" player is actually on the right of the screen.
            centralX: WORLD_WIDTH / 2 + TWO_PLAYERS_HORIZONTAL_GUTTER,
            opponent2P: gameState.getNthNeighbour(1),
        }
    }
    // Normal layout for 3+ players
    else {
        return {
            central: gameState.centralPlayer,
            centralX: PLAY_AREA_X,
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
        const pos = gameBus.playersInGame[objectId].getWorldPosition()
        // The arrow land at the bottom of the pool diamond,
        // so as to not hide the pool count.
        if (pos) {
            pos.y += 10
        }
        return pos
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
        ...gameState.targetDeclarations.map(tg => {
            return {
                from: getWorldPosition(tg.originOid),
                to: getWorldPosition(tg.targetOid),
            }
        }),
    ]
    return _arrows.filter(arrow => arrow.from && arrow.to) as Arrow[]
})
</script>
