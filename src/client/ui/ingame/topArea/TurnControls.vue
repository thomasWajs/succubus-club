<template>
    <div class="turn-controls">
        <div class="turn">
            <CommandButton
                v-if="players.isPlayer"
                :command="commands.BackTurn"
            >
                &lt;
            </CommandButton>

            <span class="turn-number"> Turn<br />#{{ gameState.turnNumber }} </span>
            <span
                :style="{ backgroundColor: gameState.activePlayer?.rgbaColor }"
                class="active-player inline-player-name"
            >
                {{ gameState.activePlayer?.shortName }}
            </span>

            <CommandButton
                v-if="players.isPlayer"
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
                v-if="players.isPlayer"
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
                    @click="gameMutations.goToTurnPhase.actSelf({ index })"
                >
                    <!-- Disambiguate Master and Minion with the second letter -->
                    {{ phase.charAt(0).toUpperCase()
                    }}<template v-if="index == 1 || index == 2">{{ phase.charAt(1) }}</template>
                </span>
            </template>

            <CommandButton
                v-if="players.isPlayer"
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

const gameState = useGameStateStore()
const players = usePlayersStore()
const commands = useCommands()
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
            &:not(.active) {
                cursor: pointer;
            }
        }
    }
}
</style>
