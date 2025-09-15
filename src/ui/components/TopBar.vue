<template>
    <div class="topbar">
        <div class="topbar-content">
            <div class="topbar-left">
                <RouterLink to="/">
                    <img
                        class="sc-logo"
                        src="/assets/logo.png"
                    />
                </RouterLink>

                <RouterLink
                    to="/about"
                    class="about-link"
                >
                    <span class="about-icon">?</span>
                    About
                </RouterLink>
            </div>

            <div
                v-if="screenBigEnough"
                class="topbar-center"
            >
                <div
                    class="deck-display"
                    :class="{ 'no-deck': !core.selfDeck }"
                    @click="bus.isDeckPanelOpen = true"
                >
                    <DeckIcon class="deck-icon" />
                    <span class="deck-name">{{ core.selfDeck?.name ?? 'No Deck selected' }}</span>
                </div>
            </div>

            <div
                v-if="screenBigEnough"
                class="topbar-right"
            >
                <span
                    class="fullscreen-button"
                    :class="{ 'show-hint-arrow': showFullscreenHint }"
                    @click="isFullscreen ? exitFullscreen() : requestFullscreen()"
                >
                    ⛶
                </span>

                <div
                    class="user-profile-display"
                    @click="bus.isUserProfilePanelOpen = true"
                >
                    {{ core.userProfile.playerName ?? 'User' }}
                    <UserAvatar
                        :avatar="core.userProfile.avatar"
                        :playerName="core.userProfile.playerName"
                        width="40px"
                        height="40px"
                        fontSize="12px"
                    />
                </div>
            </div>
        </div>
    </div>

    <div
        v-if="showFullscreenHint"
        class="fullscreen-hint"
    >
        For a better experience, play in fullscreen mode
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useBusStore } from '@/store/bus.ts'
import { useCoreStore } from '@/store/core.ts'
import UserAvatar from '@/ui/components/UserAvatar.vue'
import DeckIcon from '@/ui/components/DeckIcon.vue'
import router, { ROUTES } from '@/ui/router.ts'
import { display, screenBigEnough } from '@/game/display.ts'

const core = useCoreStore()
const bus = useBusStore()

/**
 * Full Screen handling
 */

function requestFullscreen() {
    document.documentElement.requestFullscreen()
}

function exitFullscreen() {
    document.exitFullscreen()
}

const isFullscreen = ref(!!document.fullscreenElement)
const updateFullscreenState = () => {
    isFullscreen.value = !!document.fullscreenElement
}
onMounted(() => document.addEventListener('fullscreenchange', updateFullscreenState))
onUnmounted(() => document.removeEventListener('fullscreenchange', updateFullscreenState))

/* This function could get collapsed into a single return statements, but then it gets illegible */
const showFullscreenHint = computed(() => {
    if (
        isFullscreen.value ||
        router.currentRoute.value.name != ROUTES.MainMenu ||
        !screenBigEnough
    ) {
        return false
    }
    return (
        (display.actualWidth < display.targetWidth && window.screen.width > window.innerWidth) ||
        (display.actualHeight < display.targetHeight && window.screen.height > window.innerHeight)
    )
})
</script>

<style lang="scss">
.topbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: $topbar-height;
    background: radial-gradient(ellipse at top center, $midnight-purple 30%, black 90%);

    border-bottom: 1px solid rgba($royal-purple, 0.2);
    z-index: 900;
    display: flex;
    align-items: center;
}

.topbar-content {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 1rem;
    padding: 0 1rem;
    width: 100%;

    font-size: 1rem;
    font-weight: 500;
}

.topbar-left,
.topbar-center,
.topbar-right {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.topbar-left {
    justify-self: start;
    position: relative;

    display: flex;
    gap: 2rem;
}

.topbar-center {
    justify-self: center;
}

.topbar-right {
    justify-self: end;
    display: flex;
    gap: 2rem;
    position: relative; // Add this to create positioning context
}

.sc-logo {
    width: 40px;
    height: 40px;
}

.fullscreen-button,
.about-link,
.user-profile-display,
.deck-display {
    @include flex-center;
    white-space: nowrap;
    gap: 0.5rem;
    cursor: pointer;
    color: $silver-grey;
    font-size: 1.1rem;

    &:hover {
        filter: brightness(125%);
    }
}

.about-link {
    @include flex-center;

    text-decoration: none;
    gap: 0.5rem;
}

.about-icon {
    margin-top: -1px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1px solid $pearl-grey;
    font-size: 14px;
    font-weight: bold;
}

.deck-display.no-deck {
    color: $blood-red;
}

.deck-icon {
    width: 40px;
    height: 40px;
    flex-shrink: 0;

    // Compensate for the gap inside the svg icon
    margin-bottom: -0.5rem;
}

.fullscreen-button {
    width: 40px;
    height: 40px;

    font-size: 1.6rem;
    font-weight: 600;
    position: relative;

    &.show-hint-arrow::after {
        content: '🠹';
        position: absolute;
        top: calc(100%); // Position below the button
        left: 50%;
        transform: translateX(-50%);
        font-size: 2.5rem;
        color: $pearl-grey;
        z-index: 800;
    }
}

.fullscreen-hint {
    position: absolute;
    top: 85px;
    right: 0;
    padding: 16px 16px;
    background: radial-gradient(ellipse at center, rgba($royal-purple, 0.7) 60%, transparent 80%);
    font-size: 1.1rem;
    white-space: nowrap;
    z-index: 800;
}
</style>
