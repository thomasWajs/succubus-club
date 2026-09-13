<template>
    <Scene
        key="FreeTable"
        name="FreeTable"
        :autoStart="false"
        @init="init"
        @update="update"
    >
        <!-- Menus -->
        <template v-if="players.isPlayer">
            <ChangePoolMenu v-show="sceneReady" />
            <ContextMenu v-show="sceneReady" />
            <ContextSubmenu v-show="sceneReady" />
            <ActionDropTooltip />
            <FloatingActionsCloud />
            <ReferendumVoteBoxes v-if="gameState.referendum" />
        </template>

        <!-- World : everything on the table, panned/zoomed by the main
        camera. Ignored by the pinned UI camera, see camera.ts. -->
        <Container ref="worldContainer">
            <!-- Table cards live in their own Container, isolated from the arrows
            below : CardGO.bringToTop() reorders within `image.value.parentContainer`,
            and without this wrapper that container is worldContainer itself - the same
            one the arrows live in - so hovering/dragging a card would raise it above
            the arrows ( see PlayAreaGO.vue, which isolates cards the same way in
            standard mode ). -->
            <Container>
                <RegionGO
                    v-if="gameState.table"
                    :x="0"
                    :y="0"
                    :width="FREE_TABLE_WIDTH"
                    :height="FREE_TABLE_HEIGHT"
                    :cardRegion="gameState.table"
                />
            </Container>

            <!-- Player widgets, at their shared, deterministically-computed anchor
            ( see freeTableLayout.ts ) : read from state, never recomputed here. -->
            <PlayerWidget
                v-for="player in gameState.orderedPlayers"
                :key="player.oid"
                :player="player"
            />

            <TheEdgeWidget />

            <!-- Arrows -->
            <ArrowGO
                v-for="(arrow, index) in arrows"
                :key="'arrow' + index"
                :arrow="arrow"
            />

            <!-- Card grouping : also works on the shared table, see useCardDragDrop.ts -->
            <CardGroupGO v-if="players.isPlayer" />
        </Container>

        <!-- Pinned UI : rendered exclusively through the Free Table UI camera,
        so it stays fixed on screen regardless of the main camera's pan/zoom.
        The stack browser also lives here ( not worldContainer ) : it has to
        stay put on screen rather than pan/zoom with the table. The selection
        area also lives here : it must stay screen-aligned, unaffected by the
        main camera's per-player rotation ( see SelectionArea.vue ). -->
        <Container ref="pinnedContainer">
            <HandGO
                v-if="players.selfPlayer"
                key="Hand"
                :x="handX"
                :y="handY"
                :width="handWidth"
            />

            <WieldCardStack
                v-if="gameBus.wieldCardStack.cardRegion"
                :cardRegion="gameBus.wieldCardStack.cardRegion"
            />

            <SelectionArea />
        </Container>
    </Scene>
</template>

<script setup lang="ts">
import Phaser, { GameObjects } from 'phaser'
import { Container, refObj, Scene } from 'phavuer'
import { computed, ref, watchEffect } from 'vue'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useCoreStore } from '@/client/store/core.ts'
import {
    FREE_TABLE_HEIGHT,
    FREE_TABLE_WIDTH,
    HAND_HEIGHT,
    HAND_WIDTH,
} from '@/shared/const/game.ts'
import { display, setupDisplayWatcher } from '@/client/game/display.ts'
import PlayerWidget from '@/client/game/objects/PlayerWidget.vue'
import TheEdgeWidget from '@/client/game/objects/TheEdgeWidget.vue'
import HandGO from '@/client/game/objects/HandGO.vue'
import ContextMenu from '@/client/ui/context/menu/ContextMenu.vue'
import ContextSubmenu from '@/client/ui/context/menu/ContextSubmenu.vue'
import ChangePoolMenu from '@/client/ui/ingame/ChangePoolMenu.vue'
import ActionDropTooltip from '@/client/ui/context/floating/ActionDropTooltip.vue'
import FloatingActionsCloud from '@/client/ui/context/floating/FloatingActionsCloud.vue'
import ReferendumVoteBoxes from '@/client/ui/context/floating/ReferendumVoteBoxes.vue'
import WieldCardStack from '@/client/game/objects/WieldCardStack.vue'
import ArrowGO from '@/client/game/objects/ArrowGO.vue'
import SelectionArea from '@/client/game/objects/SelectionArea.vue'
import CardGroupGO from '@/client/game/objects/CardGroupGO.vue'
import { createFreeTableUICamera, setupCamera } from '@/client/game/camera.ts'
import { setupKeyboardHandlers, setupPointerHandlers } from '@/client/game/input.ts'
import { useTargetArrows } from '@/client/game/composables/useTargetArrows.ts'
import RegionGO from '@/client/game/objects/RegionGO.vue'

const core = useCoreStore()
const gameState = useGameStateStore()
const players = usePlayersStore()
const gameBus = useGameBusStore()

const { arrows } = useTargetArrows()

// The Hand renders at a fixed zoom of 1 ( see getFreeTableUICamera ), unlike
// standard mode where the main camera's zoom shrinks the fixed-size
// WORLD_WIDTH-based HAND_WIDTH to fit narrower viewports. Anchor to the actual
// viewport instead, or a narrow window would overflow off-screen rather than
// packing cards tighter ( CardInHandGO.vue's overlap spacing ). Falls back to
// the raw window size before the reactive `display` watcher has run.
const handY = computed(() => (display.actualHeight || window.innerHeight) - HAND_HEIGHT)
const handWidth = computed(() =>
    Math.min(HAND_WIDTH, (display.actualWidth || window.innerWidth) * 0.99),
)
const handX = computed(() => ((display.actualWidth || window.innerWidth) - handWidth.value) / 2)

const sceneReady = ref(false)
let scene: Phaser.Scene | undefined
let uiCamera: Phaser.Cameras.Scene2D.Camera | undefined

function init(_scene: Phaser.Scene) {
    scene = _scene
    setupCamera(scene)
    uiCamera = createFreeTableUICamera(scene)
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
 * Pin the hand ( and any other HUD content in `pinnedContainer` ) to the
 * screen : rendered only through the UI camera, ignored by the main
 * ( pannable/zoomable ) one. Everything else ( the table, widgets, arrows... )
 * is the reverse : rendered only through the main camera. Wired reactively
 * since both Containers only exist once the scene's `create` lifecycle event
 * has run ( after `init` ), see Phavuer's `<Scene>` : `<slot v-if="show" />`.
 */
const worldContainer = refObj<GameObjects.Container>()
const pinnedContainer = refObj<GameObjects.Container>()

watchEffect(() => {
    // Read both refs unconditionally, before the guard, so Vue tracks them as
    // dependencies even on the first run ( before Scene `init` has fired and
    // `scene`/`uiCamera` are still unset ) - otherwise the effect never
    // re-triggers once the refs become ready.
    const world = worldContainer.value
    const pinned = pinnedContainer.value
    if (!scene || !uiCamera || !world || !pinned) {
        return
    }
    // Flag the Container itself rather than call camera.ignore(container) :
    // that only tags *existing* children at call time, so cards/widgets
    // mounting later would never be excluded. cameraFilter is instead checked
    // dynamically on every render/input pass, covering children added anytime.
    // No "wired once" latch : refObj() can hand us a fresh Container instance
    // later ( e.g. resync ) with cameraFilter reset to 0, so re-applying here
    // on every change is required, and idempotent.
    world.cameraFilter |= uiCamera.id
    pinned.cameraFilter |= scene.cameras.main.id
})
</script>

<style lang="scss"></style>
