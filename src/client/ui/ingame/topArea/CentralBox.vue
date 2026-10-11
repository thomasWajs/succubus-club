<template>
    <!-- With the rules engine : stacked from the top, the header in one place -->
    <div
        class="central-box"
        :class="{ engine: gameState.gameType == GameType.Engine }"
    >
        <!-- The Edge Hint -->
        <!-- Not with the rules engine : the Edge glows when its pool can be gained -->
        <TheEdgeHint
            v-if="aidsEnabled && centralContent.theEdge && gameState.gameType != GameType.Engine"
        />

        <!-- Declaration hint -->
        <DeclarationHint />

        <!-- Secret Choice -->
        <SecretChoice
            v-if="gameBus.secretInterfaceShown"
            @close="gameBus.secretInterfaceShown = false"
        />

        <!-- The phase, the bleed, whose decision ( a game with the rules engine ) -->
        <EngineHeader v-if="gameState.gameType == GameType.Engine" />

        <!-- The choice under way on the table ( a game with the rules engine ) -->
        <EngineStaging v-if="gameState.gameType == GameType.Engine" />
        <EngineChoices v-if="gameState.gameType == GameType.Engine" />

        <!-- Action Infos -->
        <!-- Not in an engine's combat : the cards played then show the more -->
        <ActionInfos
            v-if="gameState.action && !gameState.referendum && !engineCombat"
            :action="gameState.action"
        />

        <!-- The cards played during the action ( a game with the rules engine ) -->
        <EnginePlayed v-if="gameState.gameType == GameType.Engine" />

        <!-- Referendum Infos -->
        <ReferendumInfos
            v-if="gameState.referendum"
            :referendum="gameState.referendum"
        />

        <!-- Combat Infos -->
        <!--
        <div v-if="gameState.combat">
            <strong>Combat</strong>

            Acting Minion : {{ gameState.combat?.acting?.minion?.name }} <br />
            Strength : {{ gameState.combat?.acting?.strength }} <br />

            Defending Minion : {{ gameState.combat?.defending?.minion?.name }}
            <br />
            Strength : {{ gameState.combat?.defending?.strength }} <br />
        </div>
        -->

        <!-- The game over, every option as a last resort ( a game with the rules engine ) -->
        <EngineFallback v-if="gameState.gameType == GameType.Engine" />

        <!-- Timer Setup -->
        <TimerSetup v-if="centralContent.timer" />

        <!-- Next Turn -->
        <NextTurn v-if="centralContent.nextTurn" />

        <!-- New Turn Notification -->
        <TurnNotification v-if="centralContent.turnNotification" />
    </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { TurnPhase } from '@/shared/const/model.ts'
import { useTimer } from '@/shared/state/useTimer.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import TheEdgeHint from '@/client/ui/ingame/topArea/central/TheEdgeHint.vue'
import DeclarationHint from '@/client/ui/ingame/topArea/central/DeclarationHint.vue'
import SecretChoice from '@/client/ui/ingame/topArea/central/SecretChoice.vue'
import ActionInfos from '@/client/ui/ingame/topArea/central/ActionInfos.vue'
import ReferendumInfos from '@/client/ui/ingame/topArea/central/ReferendumInfos.vue'
import TimerSetup from '@/client/ui/ingame/topArea/central/TimerSetup.vue'
import NextTurn from '@/client/ui/ingame/topArea/central/NextTurn.vue'
import TurnNotification from '@/client/ui/ingame/topArea/central/TurnNotification.vue'
import EngineStaging from '@/client/ui/ingame/topArea/central/EngineStaging.vue'
import EngineChoices from '@/client/ui/ingame/topArea/central/EngineChoices.vue'
import EngineHeader from '@/client/ui/ingame/topArea/central/EngineHeader.vue'
import EngineFallback from '@/client/ui/ingame/topArea/central/EngineFallback.vue'
import EnginePlayed from '@/client/ui/ingame/topArea/central/EnginePlayed.vue'
import { GameType } from '@/shared/types/state.ts'
import { useEngineStore } from '@/client/store/engine.ts'

const gameState = useGameStateStore()
const gameBus = useGameBusStore()
const engine = useEngineStore()
// A block's combat, in a game with the rules engine
const engineCombat = computed(() => gameState.gameType == GameType.Engine && engine.inCombat)
const players = usePlayersStore()
const multiplayer = useMultiplayerStore()
const timer = useTimer(gameState.gameId)

const { aidsEnabled, turnNotificationEnabled } = useUIFeatures()

/**
 * New turn notification
 *
 * When a new turn begins (turnNumber increases by 1), we briefly show an
 * eye-catching notification with the new active player. While it's visible it
 * takes over the central box, so timer-setup and TheEdgeHint are hidden.
 */

const TURN_NOTIFICATION_DURATION_LONG = 3500
const TURN_NOTIFICATION_DURATION_SHORT = 1000
const turnNotificationVisible = ref(false)
let turnNotificationTimeout: ReturnType<typeof setTimeout> | undefined

watch(
    () => gameState.turnNumber,
    (newTurn, oldTurn) => {
        // Only trigger when advancing to the next turn, not on rewind or resync jumps.
        // With the rules engine the turn line flashes instead ( see TurnControls )
        if (
            !turnNotificationEnabled.value ||
            gameState.gameType == GameType.Engine ||
            (oldTurn && newTurn !== oldTurn + 1)
        ) {
            return
        }

        const duration =
            gameState.gameType == GameType.TrainBot ?
                TURN_NOTIFICATION_DURATION_SHORT
            :   TURN_NOTIFICATION_DURATION_LONG

        turnNotificationVisible.value = true
        clearTimeout(turnNotificationTimeout)
        turnNotificationTimeout = setTimeout(() => {
            turnNotificationVisible.value = false
        }, duration)
    },
    { immediate: true },
)

onUnmounted(() => clearTimeout(turnNotificationTimeout))

/**
 * What is displayed in the central box ?
 */

const centralContent = computed(() => ({
    turnNotification: turnNotificationVisible.value,
    timer:
        !turnNotificationVisible.value &&
        multiplayer.selfIsHost &&
        !timer.timerChosen.value &&
        gameState.timerStartTime === null,
    nextTurn: gameState.turnPhase == TurnPhase.Discard && players.selfIsActive,
    theEdge:
        !turnNotificationVisible.value &&
        gameState.turnPhase == TurnPhase.Unlock &&
        gameState.theEdgeController &&
        gameState.theEdgeController == gameState.activePlayer,
}))
</script>

<style lang="scss">
.central-box {
    @include flex-center;
    flex-grow: 1;
    flex-direction: column;
    gap: 0.5rem;
    position: relative;

    margin: 15px 0;
    padding: 0;

    // Taller than the top area ( a referendum's terms, votes and pass ) : it scrolls, its top
    // kept in sight
    min-height: 0;
    overflow-y: auto;
    justify-content: safe center;

    &.engine {
        justify-content: flex-start;
    }
}
</style>
