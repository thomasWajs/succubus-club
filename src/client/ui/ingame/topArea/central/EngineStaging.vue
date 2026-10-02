<template>
    <CentralPanel
        v-if="current"
        class="engine-staging"
        :title="current.card ? current.card.name : 'Your choice'"
    >
        <div class="engine-staging-prompt">{{ PROMPTS[current.step.ask] }}</div>

        <div class="engine-staging-choices">
            <button
                v-for="choice in buttons"
                :key="choice.key"
                class="game-button small"
                @click="narrowStaging(choice.options)"
                @mouseenter="gameBus.hoveredCard = choice.card ?? null"
                @mouseleave="gameBus.hoveredCard = null"
            >
                <template v-if="current.step.ask == 'mode' && icons(choice).length > 0">
                    <DisciplineIcon
                        v-for="icon in icons(choice)"
                        :key="`${icon.discipline}:${icon.level}`"
                        :discipline="icon.discipline"
                        :level="icon.level"
                    />
                </template>
                <template v-else>{{ choice.label }}</template>
            </button>

            <button
                class="game-button small is-danger"
                @click="cancelStaging()"
            >
                Cancel
            </button>
        </div>
    </CentralPanel>

    <!-- A decision that picks a card of the table : they glow -->
    <CentralPanel
        v-else-if="picking"
        class="engine-staging"
        :title="engine.pending?.window"
    >
        <div class="engine-staging-prompt">Click a glowing card, or :</div>
        <div class="engine-staging-choices">
            <button
                v-for="option in picks"
                :key="option.index"
                class="game-button small"
                @click="pick(option)"
                @mouseenter="gameBus.hoveredCard = engineOptionCards(option)[0] ?? null"
                @mouseleave="gameBus.hoveredCard = null"
            >
                {{ option.text }}
            </button>
        </div>
    </CentralPanel>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import CentralPanel from '@/client/ui/ingame/topArea/central/CentralPanel.vue'
import DisciplineIcon from '@/client/ui/components/DisciplineIcon.vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useEngineStore } from '@/client/store/engine.ts'
import { chooseEngineOption, engineOptionCards } from '@/client/engine/driver.ts'
import { EngineOption } from '@/client/engine/protocol.ts'
import {
    cancelStaging,
    isPick,
    narrowStaging,
    staging,
    StagingChoice,
    StagingStep,
} from '@/client/engine/interaction.ts'
import { Discipline, DisciplineCode, DisciplineLevel } from '@/shared/const/model.ts'

/**
 * The choice under way on the table, in a game with the rules engine ( see
 * engine/interaction.ts ) : what it asks next, the choices that are not cards
 * of the table ( those glow ), and a way out.
 */

const gameBus = useGameBusStore()
const engine = useEngineStore()

const picks = computed(() => engine.pending?.options.filter(isPick) ?? [])
const picking = computed(() => picks.value.length > 0)

function pick(option: EngineOption) {
    gameBus.hoveredCard = null
    chooseEngineOption(option.index)
}

const PROMPTS: Record<StagingStep['ask'], string> = {
    card: 'Which card ? Click it on the table, or :',
    actor: 'Who plays it ? Click a glowing minion',
    mode: 'Disciplines :',
    target: 'On what ? Click a glowing card',
    option: 'Which one ?',
}

const current = staging

// The choices not on the table : the others are clicked there. The card to play is a button too
// ( a card in hand among others is hard to tell )
const buttons = computed(
    () =>
        current.value?.step.choices.filter(
            choice => !choice.card || current.value?.step.ask == 'card',
        ) ?? [],
)

// A mode's Disciplines, as icons ( 'dom' basic, 'DOM' superior ) : none when a tag is not one
function icons(choice: StagingChoice): { discipline: Discipline; level: DisciplineLevel }[] {
    const tags = choice.options[0].mode?.tags ?? []
    const all = tags.map(tag => ({
        discipline: DisciplineCode[tag.toLowerCase()],
        level: tag == tag.toLowerCase() ? DisciplineLevel.INFERIOR : DisciplineLevel.SUPERIOR,
    }))
    return all.every(icon => icon.discipline) ? all : []
}

function onKey(event: KeyboardEvent) {
    if (event.key == 'Escape' && current.value) {
        cancelStaging()
    }
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<style lang="scss">
.engine-staging {
    .engine-staging-prompt {
        font-size: 14px;
        margin-bottom: 6px;
    }

    .engine-staging-choices {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 6px;
    }
}
</style>
