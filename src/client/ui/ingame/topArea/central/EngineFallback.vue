<template>
    <!-- The game over : each player's victory points -->
    <CentralPanel
        v-if="engine.result"
        class="engine-choices"
        title="Game over"
    >
        <div
            v-for="player in players.orderedPlayers"
            :key="player.oid"
        >
            {{ player.name }} : {{ player.victoryPoints }} VP
        </div>
    </CentralPanel>

    <!-- Every option of the decision, as a last resort : those answered on the table too -->
    <div
        v-else-if="engine.pending"
        class="engine-fallback"
    >
        <a
            class="engine-fallback-toggle"
            @click="showAll = !showAll"
        >
            {{ showAll ? 'Hide the options' : `All options ( ${engine.pending.options.length} )` }}
        </a>
        <div
            v-if="showAll"
            class="engine-choices-buttons"
        >
            <button
                v-for="option in engine.pending.options"
                :key="option.index"
                class="game-button small"
                @click="choose(option)"
                @mouseenter="hoverEngineCard(engineOptionCards(option)[0])"
                @mouseleave="hoverEngineCard(null)"
            >
                {{ option.text }}
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * The bottom of the central box in a game with the rules engine : the game over, or every option of
 * the decision under way behind a link ( the engine has odd windows : no option is ever out of
 * reach ). Everything else is answered on the table or in the panels above.
 */
import { ref, watch } from 'vue'
import { useEngineStore } from '@/client/store/engine.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { chooseEngineOption, engineOptionCards } from '@/client/engine/driver.ts'
import { hoverEngineCard } from '@/client/engine/cardNames.ts'
import { EngineOption } from '@/client/engine/protocol.ts'
import CentralPanel from '@/client/ui/ingame/topArea/central/CentralPanel.vue'

const engine = useEngineStore()
const players = usePlayersStore()

// Folded again at each decision
const showAll = ref(false)
watch(
    () => engine.pending?.decision,
    () => (showAll.value = false),
)

function choose(option: EngineOption) {
    hoverEngineCard(null)
    chooseEngineOption(option.index)
}
</script>

<style lang="scss">
.engine-fallback {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    align-self: stretch;

    .engine-fallback-toggle {
        font-size: 12px;
        color: $silver-grey;
        cursor: pointer;
        text-decoration: underline;
    }
}
</style>
