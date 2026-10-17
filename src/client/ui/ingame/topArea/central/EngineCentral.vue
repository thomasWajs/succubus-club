<template>
    <div class="central-box engine-central">
        <!-- The phase, the bleed, whose decision -->
        <EngineHeader />

        <!-- The choice under way on the table, the decision's other options -->
        <EngineStaging />
        <EngineChoices />

        <!-- Not in a combat : the cards played then show the more -->
        <ActionInfos
            v-if="gameState.action && !gameState.referendum && !engine.inCombat"
            :action="gameState.action"
        />

        <!-- The cards played during the action -->
        <EnginePlayed />

        <ReferendumInfos
            v-if="gameState.referendum"
            :referendum="gameState.referendum"
        />

        <!-- The game over, every option as a last resort -->
        <EngineFallback />
    </div>
</template>

<script setup lang="ts">
/**
 * The central box of a game played with the rules engine : the decision under way, the action and
 * the referendum as SC shows them, the cards played.
 */
import { useGameStateStore } from '@/client/store/gameState.ts'
import { useEngineStore } from '@/client/store/engine.ts'
import ActionInfos from '@/client/ui/ingame/topArea/central/ActionInfos.vue'
import ReferendumInfos from '@/client/ui/ingame/topArea/central/ReferendumInfos.vue'
import EngineHeader from '@/client/ui/ingame/topArea/central/EngineHeader.vue'
import EngineStaging from '@/client/ui/ingame/topArea/central/EngineStaging.vue'
import EngineChoices from '@/client/ui/ingame/topArea/central/EngineChoices.vue'
import EnginePlayed from '@/client/ui/ingame/topArea/central/EnginePlayed.vue'
import EngineFallback from '@/client/ui/ingame/topArea/central/EngineFallback.vue'

const gameState = useGameStateStore()
const engine = useEngineStore()
</script>

<style lang="scss">
// Stacked from the top, its panels close ( the decision, the action or the referendum, the cards
// played share it ) ; taller than the top area ( a referendum's terms, votes and pass ) : it
// scrolls, its top kept in sight
.central-box.engine-central {
    justify-content: flex-start;
    gap: 0.25rem;
    min-height: 0;
    overflow-y: auto;
}
</style>
