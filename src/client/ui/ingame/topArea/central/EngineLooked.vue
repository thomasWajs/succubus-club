<template>
    <CentralPanel
        v-if="engine.looked"
        class="engine-looked"
        :title="`P${engine.looked.seat + 1}'s hand, as you looked at it`"
    >
        <div class="engine-looked-cards">
            <EngineText :pieces="cards" />
            <template v-if="cards.length == 0">No card</template>
        </div>
        <button
            class="game-button"
            @click="engine.looked = null"
        >
            Close
        </button>
    </CentralPanel>
</template>

<script setup lang="ts">
/**
 * A game with the rules engine : the hand the user looked at ( SchreckNET, Vaticination ), its
 * cards' names hovered and pinned like the log's, until closed. The look ends with its action :
 * the table hides that hand again at once.
 */
import { computed } from 'vue'
import CentralPanel from '@/client/ui/ingame/topArea/central/CentralPanel.vue'
import EngineText from '@/client/ui/ingame/EngineText.vue'
import { useEngineStore } from '@/client/store/engine.ts'
import type { LogSegment } from '@/client/engine/log.ts'
import { gameResources } from '@/shared/registries.ts'
import { isCryptId } from '@/shared/model/Card.ts'

const engine = useEngineStore()

const cards = computed<LogSegment[]>(() =>
    (engine.looked?.cards ?? []).flatMap((id, i) => [
        ...(i > 0 ? [{ text: ', ' }] : []),
        {
            text: gameResources.cardbase[String(id)]?.name ?? 'a card',
            krcgId: String(id),
            isCrypt: isCryptId(id),
        },
    ]),
)
</script>

<style lang="scss" scoped>
.engine-looked {
    gap: 6px;

    .engine-looked-cards {
        text-align: center;
    }
}
</style>
