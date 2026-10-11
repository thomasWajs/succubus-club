<template>
    <div class="engine-header">
        <!-- The phase, and whose turn it is -->
        <span
            class="engine-header-phase"
            :style="{ backgroundColor: gameState.activePlayer?.rgbaColor }"
        >
            {{
                gameState.turnPhase ?
                    `${gameState.activePlayer?.shortName} · ${gameState.turnPhase} phase`
                :   'Game over'
            }}
        </span>

        <!-- During a bleed, its amount -->
        <span
            v-if="bleed !== null"
            class="engine-header-bleed"
        >
            Bleed {{ bleed }}
        </span>

        <!-- The user's decision, or who the engine waits for -->
        <span
            class="engine-header-state"
            :class="{ yours: !!engine.pending }"
        >
            {{ engine.pending ? `Your decision : ${engine.pending.window}` : engine.status }}
        </span>
    </div>
</template>

<script setup lang="ts">
/**
 * The top line of the central box in a game with the rules engine : the phase and the active
 * player, the bleed amount during a bleed, and whether the decision is the user's ( its window )
 * or whom the engine waits for. One line, always there : the panels below change, it does not.
 */
import { computed } from 'vue'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { useEngineStore } from '@/client/store/engine.ts'
import * as actions from '@/shared/state/minionActions.ts'

const gameState = useGameStateStore()
const engine = useEngineStore()

const bleed = computed(() => {
    const action = gameState.action
    return action && actions.isBleed(action.minionAction) ? action.bleed : null
})
</script>

<style lang="scss">
.engine-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    align-self: stretch;
    min-height: 24px;
    font-size: 13px;

    .engine-header-phase {
        padding: 2px 8px;
        color: black;
        font-weight: bold;
        white-space: nowrap;
    }

    .engine-header-bleed {
        padding: 2px 8px;
        background: $lighter-teal;
        color: white;
        font-weight: bold;
        font-size: 15px;
        white-space: nowrap;
    }

    .engine-header-state {
        margin-left: auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: $shadow-grey;

        &.yours {
            font-weight: bold;
        }
    }
}
</style>
