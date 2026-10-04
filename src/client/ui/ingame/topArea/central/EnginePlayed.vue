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
            @mouseenter="hoverEngineCard(engineOptionCards(play.option)[0])"
            @mouseleave="hoverEngineCard(null)"
        >
            <strong>{{ play.player }}</strong> : <EngineText :text="play.text" />
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
import { engineOptionCards } from '@/client/engine/driver.ts'
import { hoverEngineCard } from '@/client/engine/cardNames.ts'
import EngineText from '@/client/ui/ingame/EngineText.vue'

const engine = useEngineStore()
</script>

<style lang="scss">
.central-panel.engine-played {
    // As legible as the other panels : their dark text on the panel's light ground
    gap: 2px;
    font-size: 14px;

    .engine-played-line {
        cursor: default;
    }
}
</style>
