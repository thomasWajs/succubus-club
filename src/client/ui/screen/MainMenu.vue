<template>
    <TopBar />

    <div
        id="MainMenu"
        class="main-content"
    >
        <div
            v-if="showWebGLBanner"
            class="webgl-banner"
        >
            <p>
                WebGL is disabled in this browser. The game can still run, but you will experience
                degraded performances.
                <br /><br />
                It is highly recommanded to enable hardware acceleration and WebGL to enjoy Succubus
                Club.
            </p>
        </div>

        <div id="Beta">BETA</div>

        <img
            id="WelcomeSign"
            :class="{ isAnniversary }"
            :src="welcomeSignSrc"
            alt="Succubus Club"
        />

        <div
            v-if="showMobileMessage"
            id="MobileMessage"
        >
            <p>Unfortunately, this game does not run on mobile devices. Please use a desktop.</p>

            <p>
                You can learn more about the platform and its requirements on the
                <RouterLink :to="{ name: ROUTES.About }"> About Page </RouterLink>
            </p>
        </div>

        <template v-else>
            <button
                class="main-menu-button"
                @click="startEngineGame()"
            >
                Play against Bots (rules engine)
            </button>
        </template>
    </div>

    <a
        v-if="!showMobileMessage"
        id="DarkPackLogo"
        href="https://www.paradoxinteractive.com/games/world-of-darkness/community/dark-pack-agreement"
        target="_blank"
    >
        <img
            src="/assets/darkpackLogo.png"
            alt="dark pack logo"
        />
    </a>

    <WelcomeModal />
</template>

<script setup lang="ts">
import { useCoreStore } from '@/client/store/core.ts'
import { startGame } from '@/client/state/setup.ts'
import { resumeEngineGame, setupEngineGame } from '@/client/engine/setup.ts'
import { EngineGone, EngineTaken, savedEngineSeat } from '@/client/engine/host.ts'
import TopBar from '@/client/ui/components/TopBar.vue'
import { waitUntil } from '@/shared/utils.ts'
import { useBusStore } from '@/client/store/bus.ts'
import { ROUTES } from '@/client/ui/router.ts'
import WelcomeModal from '@/client/ui/components/WelcomeModal.vue'
import { computed, ref } from 'vue'
import * as logging from '@/client/logging.ts'
import { isCrawler, screenBigEnough } from '@/client/game/display.ts'
import { hasWebGL } from '@/client/initClient.ts'

import { InvalidDeck } from '@/shared/types/errors.ts'

const core = useCoreStore()
const bus = useBusStore()

/**
 *  Welcome Sign
 */

const welcomeSignSrc = computed(() =>
    isAnniversary.value ? '/assets/1year.jpg' : '/assets/welcomeSign.png',
)

// Show the anniversary illustration from Sept 13th 2026 00:00 until Sept 29th 2026 23:59 UTC (inclusive)
const isAnniversary = computed(() => {
    const now = Date.now()
    const start = Date.UTC(2026, 8, 13, 0, 0, 0)
    const end = Date.UTC(2026, 8, 29, 23, 59, 59, 999)
    return now >= start && now <= end
})

/**
 *  Menu
 */

async function startEngineGame() {
    if (core.gameIsStarted) {
        throw new Error(`Game is already started`)
    }
    // The tab's game being joined again : it is the game
    if (resuming) {
        return
    }

    if (!core.selfDeck) {
        bus.alertWarning('You must select a deck before starting a game')
        return
    }

    try {
        const runEngine = await setupEngineGame()
        startGame()
        runEngine()
    } catch (error) {
        let message = 'An error occurred while starting the game'
        if (error instanceof Error) {
            message = `${message} : ${error.message}`
        }
        bus.alertError(message)
        if (!(error instanceof InvalidDeck)) {
            logging.captureException(error)
        }
    }
}

// The engine game this tab was playing before the page refreshed, joined again
let resuming = false
async function resumeEngine() {
    if (core.gameIsStarted) {
        return
    }

    resuming = true
    try {
        const runEngine = await resumeEngineGame()
        if (!runEngine) {
            return
        }
        startGame()
        runEngine()
    } catch (error) {
        if (error instanceof EngineGone) {
            bus.alertWarning('The engine game is over : the server no longer has it')
            return
        }
        if (error instanceof EngineTaken) {
            bus.alertWarning(error.message)
            return
        }
        let message = 'An error occurred while joining the engine game again'
        if (error instanceof Error) {
            message = `${message} : ${error.message}`
        }
        bus.alertError(message)
        logging.captureException(error)
    } finally {
        resuming = false
    }
}

if (savedEngineSeat()) {
    waitUntil(() => core.resourcesAreReady, 500).then(() => {
        resumeEngine()
    })
} else if (import.meta.env.VITE_FAST_TRACK_ENGINE_GAME) {
    waitUntil(() => core.resourcesAreReady, 500).then(() => {
        startEngineGame()
    })
}

/**
 *  WebGL Message
 */

const showWebGLBanner = ref(false)
setTimeout(() => {
    showWebGLBanner.value = !hasWebGL()
})

/**
 *  Mobile Message
 */

// Combined check: hide game if mobile device OR screen too small (but not if crawler)
const showMobileMessage = !screenBigEnough && !isCrawler()
</script>

<style lang="scss" scoped>
.webgl-banner {
    @include flex-center;
    background: $wine-crimson;
    border-bottom: 1px solid $warm-coral;
    padding: 0.5rem 1rem;
    margin: 1rem 0;
    color: $ghost-white;
    font-size: 1.05rem;
    font-weight: 500;
    line-height: 1.4;
    z-index: 850;
    max-width: 750px;
}

#Beta {
    position: absolute;
    top: 80px;
    left: -95px;
    font-size: 35px;
    line-height: 40px;
    padding: 5px 100px;
    transform: rotate(-45deg);
    background: $royal-purple;
    font-family:
        Verdana,
        Tahoma,
        sans serif;
}

#MainMenu {
    @include flex-center-column;
    text-align: center;
}

#WelcomeSign {
    height: 400px;
    width: 400px;

    @media (max-height: 750px) or (max-width: 720px) {
        height: 300px;
        width: 300px;
    }

    &.isAnniversary {
        $fade: radial-gradient(ellipse 65% 85% at center, black 35%, transparent 84%);
        mask-image: $fade;
        -webkit-mask-image: $fade;

        height: 450px;
        width: 450px;
    }
}

.main-menu-button {
    width: 350px;
    height: 60px;
    margin-top: 20px;

    background: linear-gradient(145deg, $shadow-grey 0%, $ash-grey 50%, $shadow-grey 100%);
    color: $ghost-white;
    border: 1px solid $royal-purple;
    border-radius: 0.25rem;

    font-size: 16px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;

    cursor: pointer;
    position: relative;
    overflow: hidden;

    box-shadow:
        0 4px 8px rgba(black, 0.6),
        inset 0 1px 0 rgba(white, 0.1),
        0 0 20px rgba($royal-purple, 0.1);

    transition: all 0.3s ease;

    &::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba($royal-purple, 0.2), transparent);
        transition: left 0.5s ease;
    }

    &:hover {
        background: linear-gradient(145deg, $ash-grey 0%, $royal-purple 50%, $ash-grey 100%);
        border-color: $neon-purple;
        color: white;
        text-shadow: 0 0 8px rgba($royal-purple, 0.6);

        box-shadow:
            0 6px 12px rgba(black, 0.8),
            inset 0 1px 0 rgba(white, 0.15),
            0 0 20px rgba($royal-purple, 0.3),
            inset 0 0 15px rgba($royal-purple, 0.2);

        &::before {
            left: 100%;
        }
    }

    &:active {
        transform: translateY(0);
        box-shadow:
            0 2px 4px rgba(black, 0.8),
            inset 0 2px 4px rgba(black, 0.3),
            0 0 10px rgba($royal-purple, 0.2);
    }

    &::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        right: 2px;
        bottom: 2px;
        border: 1px solid rgba($royal-purple, 0.2);
        border-radius: 6px;
        pointer-events: none;
    }
}

#DarkPackLogo {
    position: absolute;
    bottom: 5px;
    left: 5px;
}

#MobileMessage {
    @include panel;
    margin: 1.5rem 1rem;
    padding: 1rem;
    font-size: 1.1rem;
    line-height: 1.6;
}
</style>
