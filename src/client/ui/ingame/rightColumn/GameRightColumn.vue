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

        <!-- The close-up zone and its tab bar. The resize handle sits on its bottom edge -->
        <div class="close-up-panel">
            <!-- Tabs on the left, buttons on the right -->
            <div class="card-tab-bar">
                <div class="card-tabs">
                    <button
                        class="tab-button"
                        :class="{ active: cardTab === 'card' }"
                        @click="cardTab = 'card'"
                    >
                        Card
                    </button>
                    <button
                        class="tab-button"
                        :class="{
                            active: cardTab === 'rulings',
                            empty: closeUpCardRulings.length === 0,
                        }"
                        @click="cardTab = 'rulings'"
                    >
                        Rulings
                    </button>
                </div>

                <div class="bar-buttons">
                    <button
                        class="bar-button"
                        :title="themeButtonTitle"
                        @click="cycleUiTheme"
                    >
                        <Icon :name="THEME_ICONS[uiThemeChoice]" />
                    </button>

                    <button
                        class="bar-button"
                        title="User preferences"
                        @click="openPreferences"
                    >
                        <Icon name="preferences" />
                    </button>

                    <button
                        class="bar-button"
                        title="Menu"
                        @click="gameMenu?.open()"
                    >
                        <Icon name="menu" />
                    </button>
                </div>
            </div>

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
                    <Icon name="pin" />
                </div>

                <div
                    v-if="cardTab === 'rulings'"
                    class="rulings"
                >
                    <div
                        v-if="closeUpCardRulings.length === 0"
                        class="no-rulings"
                    >
                        No rulings for this card
                    </div>
                    <div
                        v-for="ruling in closeUpCardRulings"
                        :key="ruling.text"
                        class="ruling-text"
                    >
                        <span v-html="rulingHtml(ruling.text)" />
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

                <template v-else>
                    <img
                        v-if="closeUpCardImage"
                        :src="closeUpCardImage"
                    />
                    <img
                        v-else
                        src="/assets/cardbackLibrary.webp"
                    />

                    <!-- On the card's top-right corner : the card shown is the pinned one -->
                    <button
                        v-if="closeUpIsPinned"
                        class="pinned-marker"
                        :style="{ left: `${closeUpCardWidth}px` }"
                        title="Pinned card. Click to unpin"
                        @click="gameBus.unpinCloseUpCard()"
                    >
                        <Icon name="pin" />
                    </button>
                </template>
            </div>

            <ResizeHandle
                orientation="horizontal"
                :style="{ top: '100%' }"
                @resize="onHeightResize"
                @reset="resetLayout"
            />
        </div>

        <RightColumnTabs />

        <GameMenu ref="gameMenu" />
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useBusStore, useGameBusStore } from '@/client/store/bus.ts'
import RightColumnTabs from '@/client/ui/ingame/rightColumn/RightColumnTabs.vue'
import GameMenu from '@/client/ui/ingame/rightColumn/GameMenu.vue'
import ResizeHandle from '@/client/ui/ingame/rightColumn/ResizeHandle.vue'
import Icon from '@/client/ui/components/Icon.vue'
import { useCoreStore } from '@/client/store/core.ts'
import { useCardTexture } from '@/client/game/composables/useCardTexture.ts'
import {
    closeUpCardWidth,
    layout,
    resetLayout,
    setCloseUpHeight,
    setRightColumnWidth,
} from '@/client/game/display.ts'
import { DisciplineCode, DisciplineLevel } from '@/shared/const/model.ts'
import { disciplineIconImg } from '@/shared/disciplineIcons.ts'
import { simpleEscapeHtml } from '@/shared/utils.ts'
import {
    setUiThemeChoice,
    UI_THEME_CHOICES,
    uiThemeChoice,
    UiThemeChoice,
} from '@/client/gateway/uiTheme.ts'
import { IconName } from '@/client/resources/icons.ts'

const core = useCoreStore()
const gameBus = useGameBusStore()

// Rulings use the card-text discipline codes ( [pot] inferior, [POT] superior ).
// Render those as icons ; escape the rest, since rulings come from external data.
function rulingHtml(text: string): string {
    return simpleEscapeHtml(text).replace(/\[([A-Za-z]{3})\]/g, (whole, code: string) => {
        const discipline = DisciplineCode[code.toLowerCase()]
        if (!discipline) {
            return whole
        }
        const level =
            code === code.toUpperCase() ? DisciplineLevel.SUPERIOR : DisciplineLevel.INFERIOR
        return disciplineIconImg(discipline, level)
    })
}

// The tab persists across hovered cards, like the former rulings switch
const cardTab = ref<'card' | 'rulings'>('card')

const gameMenu = ref<InstanceType<typeof GameMenu>>()

const bus = useBusStore()

function openPreferences() {
    bus.userPanelInitialTab = 'preferences'
    bus.isUserProfilePanelOpen = true
}

/**
 * Theme button : each click moves to the next choice ( dark, light, system )
 */

const THEME_ICONS: Record<UiThemeChoice, IconName> = {
    [UiThemeChoice.Dark]: 'theme-dark',
    [UiThemeChoice.Light]: 'theme-light',
    [UiThemeChoice.System]: 'theme-system',
}

function themeChoiceIndex() {
    return UI_THEME_CHOICES.findIndex(option => option.value === uiThemeChoice.value)
}

function nextThemeChoice() {
    return UI_THEME_CHOICES[(themeChoiceIndex() + 1) % UI_THEME_CHOICES.length]
}

const themeButtonTitle = computed(() => {
    const current = UI_THEME_CHOICES[themeChoiceIndex()]
    return `Theme : ${current?.label}. Click for ${nextThemeChoice()?.label}`
})

function cycleUiTheme() {
    const next = nextThemeChoice()
    if (next) {
        setUiThemeChoice(next.value)
    }
}

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

// Shown when the pointer is on no card ( or on the pinned one ), not during a hover preview
const closeUpIsPinned = computed(() => {
    const closeUp = gameBus.closeUpCard
    return closeUp.card !== null && closeUp.card === gameBus.pinnedCloseUpCard.card
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

    // Light theme : one gradient across the whole column, under its bars and tab contents.
    // The dark theme keeps one flat surface
    background-color: var(--ui-column-bg);
    background-image: linear-gradient(
        150deg,
        $right-column-gradient-top,
        $right-column-gradient-bottom
    );
    @include dark-ui {
        background-image: none;
    }
    border-left: solid 4px var(--ui-column-border);
    display: flex;
    flex-direction: column;
    position: relative;
}

.close-up-panel {
    flex-shrink: 0;
    position: relative;
}

.card-tab-bar {
    @include column-tab-bar;
    justify-content: space-between;
    padding-top: 4px;

    .card-tabs {
        display: flex;
        align-items: flex-end;
        flex-shrink: 0;
    }

    // Theme, preferences and menu
    .bar-buttons {
        display: flex;
        flex-shrink: 0;
        gap: 4px;
        margin-right: 5px;
    }

    .bar-button {
        @include column-bar-button;
    }
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
        // Over the card image : the red of a pushpin
        color: $rose-red;

        background: rgba(white, 0.15);

        animation: pinFlash 0.7s ease-out forwards;
        pointer-events: none;
        user-select: none;
        z-index: 3;
    }

    // Over the card art : a dark plate keeps it readable on any card, in both themes.
    // `left` is the card's right edge, set inline
    .pinned-marker {
        @include icon-button;
        position: absolute;
        top: 6px;
        transform: translateX(calc(-100% - 6px));
        width: 26px;
        height: 26px;
        background: rgba(black, 0.55);
        color: $rose-red;
        font-size: 16px;
        z-index: 2;
        transition: background 0.2s ease;

        &:hover {
            background: rgba(black, 0.8);
        }
    }

    .rulings {
        box-sizing: border-box;
        height: 100%;
        padding: 1rem;
        overflow-y: auto;
        overflow-x: hidden;

        // On the column's gradient
        color: var(--ui-panel-text);
        font-size: 16px;
    }

    .no-rulings {
        color: var(--ui-panel-text-muted);
        font-style: italic;
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
