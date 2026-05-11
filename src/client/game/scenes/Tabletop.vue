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
            v-if="players.selfPlayer"
            key="Hand"
        />

        <template
            v-for="playerSeat in playerSeats"
            :key="playerSeat.player?.oid ?? ''"
        >
            <PlayAreaGO
                :player="playerSeat.player"
                :scale="playerSeat.scale"
                :x="playerSeat.x"
                :y="playerSeat.y"
            />
        </template>

        <!-- Menus -->
        <template v-if="players.isPlayer">
            <ChangePoolMenu v-show="sceneReady" />
            <ContextMenu v-show="sceneReady" />
            <ContextSubmenu v-show="sceneReady" />
            <FloatingActionsCloud />
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
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import {
    BOTTOM_PLAYERS_Y,
    GRID_SIZE,
    HD_WIDTH,
    OTHER_PLAYERS_SCALE,
    PLAY_AREA_WIDTH,
    PLAY_AREA_X,
    PLAY_AREA_Y,
    RIGHT_COLUMN_WIDTH,
    RIGHT_PLAYERS_X,
    TWO_PLAYERS_HORIZONTAL_GUTTER,
    WORLD_WIDTH,
} from '@/shared/const/game.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import PlayAreaGO from '@/client/game/objects/PlayAreaGO.vue'
import { computed, ref } from 'vue'
import ContextMenu from '@/client/ui/context/menu/ContextMenu.vue'
import ContextSubmenu from '@/client/ui/context/menu/ContextSubmenu.vue'
import WieldCardStack from '@/client/game/objects/WieldCardStack.vue'
import { useCoreStore } from '@/client/store/core.ts'
import { setupKeyboardHandlers, setupPointerHandlers } from '@/client/game/input.ts'
import { setupCamera } from '@/client/game/camera.ts'
import ArrowGo from '@/client/game/objects/ArrowGo.vue'
import { Arrow } from '@/shared/types/state.ts'
import ChangePoolMenu from '@/client/ui/ingame/ChangePoolMenu.vue'
import HandGO from '@/client/game/objects/HandGO.vue'
import SelectionArea from '@/client/game/objects/SelectionArea.vue'
import FloatingActionsCloud from '@/client/ui/context/floating/FloatingActionsCloud.vue'
import { CardOid, PlayerOid, Point2D } from '@/shared/types/model.ts'
import { setupDisplayWatcher } from '@/client/game/display.ts'
import { Player } from '@/shared/model/Player.ts'

const core = useCoreStore()
const gameState = useGameStateStore()
const players = usePlayersStore()
const gameBus = useGameBusStore()

const sceneReady = ref(false)
let scene: Phaser.Scene | undefined

function init(_scene: Phaser.Scene) {
    scene = _scene
    setupCamera(scene)
    setupPointerHandlers(scene)
    setupKeyboardHandlers(scene)
    setupDisplayWatcher()
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

type PlayerSeat = {
    player: Player
    scale: number
    x: number
    y: number
}

const FOCUS_MODE_PLAY_AREA_WIDTH = PLAY_AREA_WIDTH - GRID_SIZE // 630 px
const FOCUS_MODE_GUTTER = (HD_WIDTH - 3 * FOCUS_MODE_PLAY_AREA_WIDTH) / 2 // 15px
const FOCUS_MODE_SCALE = FOCUS_MODE_PLAY_AREA_WIDTH / PLAY_AREA_WIDTH // About 0.985
const FOCUS_MODE_FARAWAY_PLAYER_SCALE = 0.45

function playerSeatsNormalMode(visiblePlayers: Player[]): PlayerSeat[] {
    const seats: PlayerSeat[] = []

    // Bottom left ( if 4+ visible players )
    if (visiblePlayers.length >= 4) {
        seats.push({
            player: visiblePlayers[1],
            scale: OTHER_PLAYERS_SCALE,
            x: 0,
            y: BOTTOM_PLAYERS_Y,
        })
    }

    if (visiblePlayers.length >= 3) {
        // Top Left
        seats.push({
            player: visiblePlayers.length == 3 ? visiblePlayers[1] : visiblePlayers[2],
            scale: gameBus.focusMode ? FOCUS_MODE_SCALE : OTHER_PLAYERS_SCALE,
            x: 0,
            y: 0,
        })

        // Top Right
        seats.push({
            player: visiblePlayers.length == 3 ? visiblePlayers[2] : visiblePlayers[3],
            scale: gameBus.focusMode ? FOCUS_MODE_SCALE : OTHER_PLAYERS_SCALE,
            x: RIGHT_PLAYERS_X,
            y: 0,
        })
    }

    // Bottom right ( if 5 visible players )
    if (visiblePlayers.length == 5) {
        seats.push({
            player: visiblePlayers[4],
            scale: OTHER_PLAYERS_SCALE,
            x: RIGHT_PLAYERS_X,
            y: BOTTOM_PLAYERS_Y,
        })
    }

    // End with the central player
    if (visiblePlayers.length >= 1) {
        seats.push({
            player: visiblePlayers[0],
            scale: 1,
            x: PLAY_AREA_X,
            y: PLAY_AREA_Y,
        })
    }

    return seats
}

function playerSeatsFocusMode(): PlayerSeat[] {
    const seats: PlayerSeat[] = []

    // Center ( Active player )
    seats.push({
        player: players.centralPlayer,
        scale: FOCUS_MODE_SCALE,
        x: PLAY_AREA_X + FOCUS_MODE_GUTTER / 2,
        y: PLAY_AREA_Y,
    })

    // Left ( Prey )
    if (players.centralPlayer.prey) {
        seats.push({
            player: players.centralPlayer.prey,
            scale: FOCUS_MODE_SCALE,
            x: -RIGHT_COLUMN_WIDTH / 2 + FOCUS_MODE_GUTTER / 2,
            y: PLAY_AREA_Y,
        })
    }

    // Right ( Predator )
    if (
        players.centralPlayer.predator &&
        players.centralPlayer.predator != players.centralPlayer.prey
    ) {
        seats.push({
            player: players.centralPlayer.predator,
            scale: FOCUS_MODE_SCALE,
            x: RIGHT_PLAYERS_X,
            y: PLAY_AREA_Y,
        })
    }

    // 4th player
    if (players.competingPlayers.length >= 4 && players.centralPlayer.prey?.prey) {
        seats.push({
            player: players.centralPlayer.prey.prey,
            scale: FOCUS_MODE_FARAWAY_PLAYER_SCALE,
            x: -RIGHT_COLUMN_WIDTH / 2 + FOCUS_MODE_GUTTER / 2,
            y: 0,
        })
    }

    // 5th player
    if (players.competingPlayers.length >= 5 && players.centralPlayer.predator?.predator) {
        seats.push({
            player: players.centralPlayer.predator.predator,
            scale: FOCUS_MODE_FARAWAY_PLAYER_SCALE,
            x: RIGHT_PLAYERS_X,
            y: 0,
        })
    }

    return seats
}

function playerSeatsDuel(visiblePlayers: Player[]): PlayerSeat[] {
    // Try to anchor selfPLayer on the right to align its hand in TrainBot mode
    const [leftPlayer, rightPlayer] =
        players.selfPlayer == visiblePlayers[0] ?
            [visiblePlayers[1], visiblePlayers[0]]
        :   [visiblePlayers[0], visiblePlayers[1]]

    return [
        {
            player: leftPlayer,
            scale: 1,
            x: TWO_PLAYERS_HORIZONTAL_GUTTER,
            y: PLAY_AREA_Y,
        },
        {
            player: rightPlayer,
            scale: 1,
            x: WORLD_WIDTH / 2 + TWO_PLAYERS_HORIZONTAL_GUTTER,
            y: PLAY_AREA_Y,
        },
    ]
}

const playerSeats = computed(() => {
    if (!players.centralPlayer) {
        return []
    }

    // All visible players, starting with the central player
    let visiblePlayers: Player[] = []

    // Focus Mode
    if (gameBus.focusMode) {
        // Use the duel display, even in focus mode
        if (players.competingPlayers.length == 2) {
            visiblePlayers = players.competingPlayers
        } else {
            return playerSeatsFocusMode()
        }
    }
    // Non focus mode
    else {
        for (let i = 0; i < gameState.orderedPlayers.length; i++) {
            const player = players.getNthNeighbour(i)
            if (!players.hiddenPlayers.has(player.oid)) {
                visiblePlayers.push(player)
            }
        }
    }

    // Special layout for 2 players
    if (visiblePlayers.length == 2) {
        return playerSeatsDuel(visiblePlayers)
    }

    // Normal layout for 3+ players
    return playerSeatsNormalMode(visiblePlayers)
})

/**
 * Arrows
 */

function getWorldPosition(objectId?: CardOid | PlayerOid): Point2D | null {
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
