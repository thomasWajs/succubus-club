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
            src="/assets/welcomeSign.png"
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
                @click="goToLobby()"
            >
                Join Multiplayer Lobby
            </button>

            <button
                class="main-menu-button"
                @click="startTrainGame()"
            >
                Start A Training Game
            </button>

            <button
                class="main-menu-button"
                @click="startPuppeteerGame()"
            >
                Start a Puppeteer Game
            </button>

            <button
                class="main-menu-button"
                @click="bus.isSavedGamesPanelOpen = true"
            >
                Load a saved game
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

    <IdleModal />
    <ChangelogModal />
    <WelcomeModal />
    <TrainBotDisclaimer ref="trainBotDisclaimerRef" />
    <PuppeteerModal ref="puppeteerModalRef" />
</template>

<script setup lang="ts">
import { useCoreStore } from '@/client/store/core.ts'
import { GameType } from '@/shared/types/state.ts'
import { joinLobby } from '@/client/multiplayer/lobby.ts'
import { setupPuppeteerGame, setupTrainGame, startGame } from '@/client/state/setup.ts'
import { useRouter } from 'vue-router'
import TopBar from '@/client/ui/components/TopBar.vue'
import { waitUntil } from '@/shared/utils.ts'
import { useBusStore } from '@/client/store/bus.ts'
import { ROUTES } from '@/client/ui/router.ts'
import WelcomeModal from '@/client/ui/components/WelcomeModal.vue'
import ChangelogModal from '@/client/ui/components/ChangelogModal.vue'
import TrainBotDisclaimer from '@/client/ui/components/TrainBotDisclaimer.vue'
import PuppeteerModal from '@/client/ui/components/PuppeteerModal.vue'
import IdleModal from '@/client/ui/components/IdleModal.vue'
import { ref } from 'vue'
import * as logging from '@/client/logging.ts'
import { isCrawler, screenBigEnough } from '@/client/game/display.ts'
import { hasWebGL } from '@/client/initClient.ts'

const core = useCoreStore()
const bus = useBusStore()
const router = useRouter()
const trainBotDisclaimerRef = ref<InstanceType<typeof TrainBotDisclaimer> | null>(null)
const puppeteerModalRef = ref<InstanceType<typeof PuppeteerModal> | null>(null)

/**
 *  Menu
 */

async function goToLobby() {
    joinLobby()
    router.push({ name: ROUTES.Lobby })
}

async function startTrainGame() {
    if (core.gameIsStarted) {
        throw new Error(`Game is already started`)
    }

    if (!core.selfDeck) {
        bus.alertWarning('You must select a deck before starting a game')
        return
    }

    // Show disclaimer modal and wait for user to acknowledge
    if (trainBotDisclaimerRef.value) {
        await trainBotDisclaimerRef.value.showDisclaimer()
    }

    try {
        setupTrainGame()
        startGame(GameType.TrainBot)
        // Trigger first bot turn manually
        setTimeout(() => core.conductor?.runDecisionMaking(), 2000)
    } catch (error) {
        let message = 'An error occurred while starting the game'
        if (error instanceof Error) {
            message = `${message} : ${error.message}`
        }
        bus.alertError(message)
        logging.captureException(error)
    }
}

async function startPuppeteerGame() {
    if (core.gameIsStarted) {
        throw new Error(`Game is already started`)
    }

    const puppets = await puppeteerModalRef.value?.open()
    if (!puppets) {
        return
    }

    try {
        setupPuppeteerGame(puppets)
        startGame(GameType.Puppeteer)
    } catch (error) {
        let message = 'An error occurred while starting the Puppeteer game'
        if (error instanceof Error) {
            message = `${message} : ${error.message}`
        }
        bus.alertError(message)
        logging.captureException(error)
    }
}

if (import.meta.env.VITE_FAST_TRACK_TRAIN_GAME) {
    waitUntil(() => core.resourcesAreReady, 500).then(() => {
        startTrainGame()
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
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: start;
    text-align: center;
}

#WelcomeSign {
    height: 400px;
    width: 400px;

    @media (max-height: 750px) or (max-width: 720px) {
        height: 300px;
        width: 300px;
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
