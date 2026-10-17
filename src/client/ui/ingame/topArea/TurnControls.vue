<template>
    <div class="turn-controls">
        <!-- With the rules engine, a new turn flashes here ( no notification over the table ) -->
        <div
            :key="isEngine ? gameState.turnNumber : 0"
            class="turn"
            :class="{ engine: isEngine }"
        >
            <CommandButton
                v-if="players.isPlayer && manualControlsEnabled"
                :command="commands.BackTurn"
            >
                &lt;
            </CommandButton>

            <span class="turn-number"> Turn<br />#{{ gameState.turnNumber }} </span>
            <span
                :style="{ backgroundColor: gameState.activePlayer?.rgbaColor }"
                class="active-player inline-player-name"
            >
                {{ gameState.activePlayer?.shortName
                }}<template v-if="isEngine && gameState.turnPhase">
                    · {{ gameState.turnPhase }}</template
                >
            </span>

            <CommandButton
                v-if="players.isPlayer && manualControlsEnabled"
                :command="commands.AdvanceTurn"
            >
                &gt;
            </CommandButton>
        </div>

        <div class="timer">
            <TimerDisplay />
        </div>

        <div class="phases">
            <CommandButton
                v-if="players.isPlayer && manualControlsEnabled"
                :command="commands.BackTurnPhase"
            />

            <template
                v-for="(phase, index) of TurnSequence"
                :key="phase"
            >
                <span
                    v-if="phase == gameState.turnPhase"
                    class="phase-box active"
                    >{{ gameState.turnPhase }}</span
                >
                <span
                    v-else
                    class="phase-box"
                    :class="{ 'read-only': !manualControlsEnabled }"
                    @click="manualControlsEnabled && gameMutations.goToTurnPhase.actSelf({ index })"
                >
                    <!-- Disambiguate Master and Minion with the second letter -->
                    {{ phase.charAt(0).toUpperCase()
                    }}<template v-if="index == 1 || index == 2">{{ phase.charAt(1) }}</template>
                </span>
            </template>

            <CommandButton
                v-if="players.isPlayer && manualControlsEnabled"
                :command="commands.AdvanceTurnPhase"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { TurnSequence } from '@/shared/const/model.ts'
import { useCommands } from '@/client/game/composables/useCommands.ts'
import CommandButton from '@/client/ui/ingame/CommandButton.vue'
import TimerDisplay from '@/client/ui/ingame/topArea/TimerDisplay.vue'
import { useEngineMode } from '@/client/engine/mode.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'

const gameState = useGameStateStore()
const players = usePlayersStore()
const commands = useCommands()

// With the rules engine the phases are a read-only indicator : the fixed Pass ends them
const { isEngine } = useEngineMode()
const { manualControlsEnabled } = useUIFeatures()
</script>

<style lang="scss">
.turn-controls {
    color: $shadow-grey;
    font-weight: bold;
    font-size: 14px;

    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    align-items: center;
    justify-items: center;

    .turn {
        height: 35px;
        width: 225px;
        justify-self: left;
        @include flex-center;
        align-items: stretch;

        .turn-number {
            @include flex-center;
            background: $lighter-teal;
            padding: 0 5px;
            white-space: nowrap;
        }

        .active-player {
            display: block;
            text-align: center;
            line-height: 35px;
            width: 100px;
            max-width: 100px;
            padding: 0 5px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        // The phase beside the player's name : wider, the arrows hidden
        &.engine {
            animation: TurnStarts 1.5s ease-out;

            .active-player {
                width: auto;
                max-width: 180px;
                padding: 0 10px;
            }
        }

        .game-button {
            height: 35px;
            padding: 0 5px;
            font-size: 18px;

            kbd {
                font-size: 16px;
            }
        }
    }

    .phases {
        height: 35px;
        justify-self: right;
        display: flex;
        align-items: stretch;

        .game-button {
            padding: 0 5px;
            width: 32px;
            height: 35px;
        }

        .phase-box {
            @include flex-center;
            width: 32px;
            height: 35px;
            border: solid 1px $shadow-grey;
            background: $pearl-grey;
            color: $ash-grey;
            box-sizing: border-box;

            opacity: 0.7;

            &.active {
                background: $lighter-teal;
                color: black;
                width: 70px;
                opacity: 1;
            }
            &:not(.active):not(.read-only) {
                cursor: pointer;
            }
        }
    }
}

@keyframes TurnStarts {
    0%,
    40% {
        background-color: rgba($light-teal, 0.6);
    }
}
</style>
