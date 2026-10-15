<template>
    <div class="engine-header">
        <!-- The game over ( the phase is on the turn line above ) -->
        <span
            v-if="!gameState.turnPhase"
            class="engine-header-over"
        >
            Game over
        </span>

        <!-- During a bleed, its amount -->
        <span
            v-if="bleed !== null && !engine.result"
            class="engine-header-bleed"
        >
            Bleed {{ bleed }}
        </span>

        <!-- During an influence phase, the transfers left -->
        <span
            v-if="engine.transfers !== null"
            class="engine-header-bleed"
        >
            {{ engine.transfers }} {{ engine.transfers == 1 ? 'transfer' : 'transfers' }} left
        </span>

        <!-- A minion phase that cannot end yet : who must hunt first ( the other minions wait ) -->
        <span
            v-if="mustHunt"
            class="engine-header-bleed"
        >
            {{ mustHunt }}
        </span>

        <!-- The user's decision, or who the engine waits for -->
        <span
            class="engine-header-state"
            :class="{ yours: !!engine.pending && !engine.rejoining }"
        >
            {{
                engine.rejoining ? 'Connection lost : joining the game again…'
                : engine.pending ? `Your decision : ${windowName(engine.pending.window)}`
                : engine.status
            }}
        </span>
    </div>
</template>

<script setup lang="ts">
/**
 * The top line of the central box in a game with the rules engine : the bleed amount during a
 * bleed, and whether the decision is the user's ( its window ) or whom the engine waits for ( the
 * phase is on the turn line, beside the active player ). One line, always there : the panels below
 * change, it does not.
 */
import { windowName } from '@/client/engine/labels.ts'
import { engineCard } from '@/client/engine/driver.ts'
import { computed } from 'vue'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { useEngineStore } from '@/client/store/engine.ts'

const gameState = useGameStateStore()
const engine = useEngineStore()

// The engine's bleed amount, through the whole bleed : a minion's, an action card's too
const bleed = computed(() => engine.bleed)

// The minion phase offering no end : a vampire with no blood ( or one that must hunt ) hunts before
// any other action ( rules-qa 17.2 ), its hunts the only actions offered
const mustHunt = computed(() => {
    const pending = engine.pending
    if (pending?.window != 'minion_phase' || pending.options.some(o => o.kind == 'pass')) {
        return null
    }
    const names = new Set(
        pending.options
            .filter(o => o.kind == 'take_action' && o.action == 'hunt')
            .map(o => engineCard(o.actor)?.name)
            .filter(name => !!name),
    )
    return names.size > 0 ? `${[...names].join(' and ')} must hunt first` : null
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

    .engine-header-over {
        padding: 2px 8px;
        background: $lighter-teal;
        color: white;
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
