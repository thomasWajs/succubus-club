<template>
    <TopBar />

    <div
        id="MainMenu"
        class="main-content"
    >
        <img
            id="WelcomeSign"
            src="/assets/welcomeSign.png"
            alt="Succubus Club"
        />

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
            @click="bus.isSavedGamesPanelOpen = true"
        >
            Load a saved game
        </button>
    </div>

    <a
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
    <TrainBotDisclaimer ref="trainBotDisclaimerRef" />
</template>

<script setup lang="ts">
import { useCoreStore } from '@/store/core.ts'
import { GameType } from '@/state/types.ts'
import { joinLobby } from '@/multiplayer/lobby.ts'
import { setupTrainGame, startGame } from '@/game/setup.ts'
import { useRouter } from 'vue-router'
import TopBar from '@/ui/components/TopBar.vue'
import { waitUntil } from '@/utils.ts'
import { useBusStore } from '@/store/bus.ts'
import { ROUTES } from '@/ui/router.ts'
import WelcomeModal from '@/ui/components/WelcomeModal.vue'
import TrainBotDisclaimer from '@/ui/components/TrainBotDisclaimer.vue'
import { ref } from 'vue'
import * as logging from '@/logging.ts'

const core = useCoreStore()
const bus = useBusStore()
const router = useRouter()
const trainBotDisclaimerRef = ref<InstanceType<typeof TrainBotDisclaimer> | null>(null)

/**
 *  Menu
 */

function goToLobby() {
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
    } catch (error) {
        let message = 'An error occurred while starting the game'
        if (error instanceof Error) {
            message = `${message} : ${error.message}`
        }
        bus.alertError(message)
        logging.captureException(error)
    }
}

if (import.meta.env.VITE_FAST_TRACK_TRAIN_GAME) {
    waitUntil(() => core.resourcesAreReady, 1000).then(() => {
        startTrainGame()
    })
}
</script>

<style lang="scss" scoped>
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

    @media (max-height: 750px) {
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
</style>
