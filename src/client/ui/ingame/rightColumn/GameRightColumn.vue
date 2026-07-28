<template>
    <div
        id="GameRightColumn"
        :style="{ width: `${layout.rightColumnWidth}px` }"
    >
        <ResizeHandle
            orientation="vertical"
            @resize="onWidthResize"
            @reset="resetLayout"
        />

        <div
            class="card-close-up"
            :style="{ height: `${layout.closeUpHeight}px` }"
        >
            <div
                v-if="showPinFlash"
                :key="pinFlashKey"
                class="pin-flash"
                @animationend="showPinFlash = false"
            >
                📌
            </div>

            <div
                v-if="closeUpCardImage"
                class="rulings-switch"
                :class="{ active: showRuling }"
                @click="showRuling = !showRuling"
            >
                <template v-if="showRuling">Hide </template>Rulings
            </div>

            <div
                v-if="showRuling"
                class="rulings-overlay"
            >
                <div
                    v-for="ruling in closeUpCardRulings"
                    :key="ruling.text"
                    class="ruling-text"
                >
                    {{ ruling.text }}
                    <br />
                    <a
                        v-for="(refUrl, refName) of ruling.refs"
                        :key="refName"
                        class="ruling-reference"
                        :href="refUrl"
                        target="_blank"
                    >
                        [{{ refName }}]
                    </a>
                </div>
            </div>

            <img
                v-if="closeUpCardImage"
                :src="closeUpCardImage"
            />
            <img
                v-else
                src="/assets/cardbackLibrary.webp"
            />
        </div>

        <ResizeHandle
            orientation="horizontal"
            :style="{ top: `${layout.closeUpHeight}px` }"
            @resize="onHeightResize"
            @reset="resetLayout"
        />

        <RightColumnPlayers />
        <RightColumnTabs />
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import RightColumnPlayers from '@/client/ui/ingame/rightColumn/RightColumnPlayers.vue'
import RightColumnTabs from '@/client/ui/ingame/rightColumn/RightColumnTabs.vue'
import ResizeHandle from '@/client/ui/ingame/rightColumn/ResizeHandle.vue'
import { useCoreStore } from '@/client/store/core.ts'
import { useCardTexture } from '@/client/game/composables/useCardTexture.ts'
import {
    layout,
    resetLayout,
    setCloseUpHeight,
    setRightColumnWidth,
} from '@/client/game/display.ts'

const core = useCoreStore()
const gameBus = useGameBusStore()

const showRuling = ref(false)

// The vertical handle sits on the column's left edge : dragging left (negative
// delta) widens the column, dragging right narrows it.
function onWidthResize(delta: number) {
    setRightColumnWidth(layout.rightColumnWidth - delta)
}

// The horizontal handle sits at the bottom of the close-up zone : dragging down
// (positive delta) grows the zone, dragging up shrinks it.
function onHeightResize(delta: number) {
    setCloseUpHeight(layout.closeUpHeight + delta)
}

const closeUpCardImage = computed(() => {
    const closeUp = gameBus.closeUpCard

    if (!closeUp.card) {
        return null
    }

    const cardTexture = useCardTexture(closeUp.card)
    const texture = closeUp.canView ? cardTexture.texture.value : cardTexture.backTexture
    return core.phaserGame.textures.getBase64(texture.textureName, texture.frameName)
})

const closeUpCardRulings = computed(() => {
    const closeUp = gameBus.closeUpCard
    return closeUp.card && closeUp.canView ? closeUp.card.rulings : []
})

/**
 * Transient visual clue when a card gets pinned from a log line
 */

const showPinFlash = ref(false)
// Changing the key restarts the animation when re-pinning during a flash
const pinFlashKey = ref(0)

watch(
    () => gameBus.closeUpCardPinFlash,
    () => {
        pinFlashKey.value++
        showPinFlash.value = true
    },
)
</script>

<style lang="scss" scoped>
#GameRightColumn {
    // The width is set inline from the resizable layout state. box-sizing is
    // border-box so that width includes the 4px border, matching display.actualWidth.
    box-sizing: border-box;
    // The sibling play area (#PhavuerGame) has width:100% (a full-width flex
    // basis), so without this the flex row shrinks the column below its set
    // width. Previously the column's min-content floor came from the removed
    // fixed-size .card-close-up ; now we pin it explicitly.
    flex-shrink: 0;
    height: 100vh;

    background-color: $purple-grey;
    border-left: solid 4px $purple-grey;
    display: flex;
    flex-direction: column;
    position: relative;
}

.card-close-up {
    // The height is set inline from the resizable layout state.
    width: 100%;
    flex-shrink: 0;
    margin: 0;
    padding: 0;
    overflow: hidden;
    position: relative;

    .pin-flash {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 48px;

        background: rgba(white, 0.15);

        animation: pinFlash 0.7s ease-out forwards;
        pointer-events: none;
        user-select: none;
        z-index: 3;
    }

    .rulings-switch {
        position: absolute;
        bottom: 0;
        left: 0;
        background: rgba(black, 0.75);
        color: $pearl-grey;
        padding: 2px 1px;
        font-size: 15px;
        cursor: pointer;
        user-select: none;

        z-index: 2;

        &:hover {
            filter: brightness(150%);
        }
        &.active {
            background: rgba($purple-grey, 1);
        }
    }

    .rulings-overlay {
        position: absolute;
        left: 0;
        top: 0;
        height: calc(100% - 2rem);
        width: calc(100% - 2rem);
        padding: 1rem;
        overflow: auto;
        overflow-x: hidden;

        background: rgba($shadow-grey, 0.97);
        color: $ghost-white;
        font-size: 16px;

        z-index: 1;
    }

    .ruling-text {
        margin-bottom: 1rem;
    }

    .ruling-reference {
        margin-right: 0.75rem;
        display: inline-block;
    }

    img {
        // Take the most space possible in the zone while keeping the card
        // aspect ratio, pushed to the top-left corner. display:block avoids the
        // inline-image descender gap.
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        object-position: top left;
    }
}

@keyframes pinFlash {
    0% {
        opacity: 1;
        transform: scale(1.4);
    }
    30% {
        transform: scale(1);
    }
    60% {
        opacity: 1;
    }
    100% {
        opacity: 0;
        transform: scale(1);
    }
}
</style>
