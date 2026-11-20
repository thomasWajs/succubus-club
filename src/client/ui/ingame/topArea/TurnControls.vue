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
                :style="playerTagStyle(gameState.activePlayer)"
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
import { playerTagStyle } from '@/client/colors.ts'

const gameState = useGameStateStore()
const players = usePlayersStore()
const commands = useCommands()
</script>

<style lang="scss">
.turn-controls {
    color: var(--ui-panel-text);
    font-weight: bold;
    font-size: 14px;

    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    align-items: center;
    justify-items: center;

    .turn {
        height: 35px;
        // Same width as .game-mutations below : both blocks share their left and right edges
        width: $game-mutations-width;
        justify-self: left;
        @include flex-center;
        align-items: stretch;

        .turn-number {
            @include flex-center;
            // Same fill as the active phase box. Muted purple on the dark theme = the current state
            // ( turn, phase ), apart from the grey name cell and buttons
            background: var(--ui-current-bg);
            color: var(--ui-contrast-text);
            border: solid 1px var(--ui-border);
            padding: 0 5px;
            white-space: nowrap;
        }

        // Light : filled with the seat color ( inline background ). Dark : the name colored ( inline
        // color ), in a raised cell. Wide for longer names, still within the block width.
        .active-player {
            background: light-dark(transparent, $ui-surface-raised);
            display: block;
            text-align: center;
            line-height: 35px;
            width: 119px;
            max-width: 119px;
            padding: 0 5px;
            border: solid 1px var(--ui-border);
            border-left: none;
            border-right: none;
            box-sizing: border-box;
            font-weight: bold;
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
            border: solid 1px var(--ui-border);
            background: light-dark($silver-grey, $ui-surface);
            color: var(--ui-label-text);
            box-sizing: border-box;

            &:not(.active) {
                cursor: pointer;
            }

            &:not(.active):hover {
                color: light-dark(black, $ui-text);
                background: light-dark($pearl-grey, $ui-surface-raised);
            }

            &.active {
                background: var(--ui-current-bg);
                border-bottom: solid 2px var(--ui-current-marker);
                color: var(--ui-contrast-text);
                width: 70px;
            }
        }
    }
}
</style>
