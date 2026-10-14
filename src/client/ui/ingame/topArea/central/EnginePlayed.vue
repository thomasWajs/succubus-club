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
            <template v-if="short(play.option, play.player)">
                <EngineText :text="short(play.option, play.player)!.text" />
                <DisciplineIcon
                    v-for="icon in short(play.option, play.player)!.icons"
                    :key="`${icon.discipline}:${icon.level}`"
                    :discipline="icon.discipline"
                    :level="icon.level"
                />
            </template>
            <template v-else>
                <strong>{{ play.player }}</strong> : <EngineText :text="play.text" />
            </template>
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
import { engineCard, engineOptionCards } from '@/client/engine/driver.ts'
import { hoverEngineCard } from '@/client/engine/cardNames.ts'
import EngineText from '@/client/ui/ingame/EngineText.vue'
import DisciplineIcon from '@/client/ui/components/DisciplineIcon.vue'
import { gameResources } from '@/shared/registries.ts'
import { type Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { disciplineUses } from '@/client/engine/projection.ts'
import type { OptionView } from '@/client/engine/api.ts'

const engine = useEngineStore()

// A card played, said short : "Dario Ziggler plays Deep Ecology" and the icons of the
// Disciplines it was played at ( lower case inferior, upper case superior ). Null for the rest,
// said by the log's line
function short(
    option: OptionView,
    player: string,
): { text: string; icons: { discipline: Discipline; level: DisciplineLevel }[] } | null {
    const card = option.card?.id ? gameResources.cardbase[option.card.id]?.name : undefined
    if (option.kind != 'play' || !card) {
        return null
    }
    const actor = engineActor(option)
    const who = actor ?? player
    if (!who) {
        return null
    }
    return { text: `${who} plays ${card}`, icons: disciplineUses(option.mode) }
}

// The name of the minion playing the card
function engineActor(option: OptionView): string | undefined {
    const krcgId = engineCard(option.actor)?.krcgId
    return krcgId ? gameResources.cardbase[krcgId]?.name : undefined
}
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
