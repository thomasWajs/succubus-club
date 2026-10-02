<template>
    <CentralPanel
        v-if="engine.played.length > 0"
        class="engine-played"
        title="Played during the action"
    >
        <div
            v-for="(play, i) in engine.played"
            :key="i"
            class="engine-played-line"
            @mouseenter="gameBus.hoveredCard = engineOptionCards(play.option)[0] ?? null"
            @mouseleave="gameBus.hoveredCard = null"
        >
            <strong>{{ play.player }}</strong> : {{ play.text }}
        </div>
    </CentralPanel>
</template>

<script setup lang="ts">
/**
 * A game with the rules engine : the cards played during the action under way, by whom, until
 * the action is over. They are in the ash heap already ; this is what happened.
 */
import CentralPanel from '@/client/ui/ingame/topArea/central/CentralPanel.vue'
import { useEngineStore } from '@/client/store/engine.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { engineOptionCards } from '@/client/engine/driver.ts'

const engine = useEngineStore()
const gameBus = useGameBusStore()
</script>

<style lang="scss">
.central-panel.engine-played {
    gap: 2px;
    font-size: 0.8rem;

    .engine-played-line {
        color: $pearl-grey;
    }
}
</style>
