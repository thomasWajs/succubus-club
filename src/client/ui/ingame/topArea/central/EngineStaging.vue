<template>
    <CentralPanel
        v-if="current"
        class="engine-staging"
        :title="current.card ? current.card.name : 'Your choice'"
    >
        <div class="engine-staging-prompt">{{ prompt(current.step) }}</div>

        <div class="engine-staging-choices">
            <button
                v-for="choice in buttons"
                :key="choice.key"
                class="game-button small"
                @click="narrowStaging(choice.options)"
                @mouseenter="hoverEngineCard(choice.card)"
                @mouseleave="hoverEngineCard(null)"
            >
                <span
                    v-if="current.step.ask == 'mode' && icons(choice).length > 0"
                    class="engine-staging-mode"
                >
                    <DisciplineIcon
                        v-for="icon in icons(choice)"
                        :key="`${icon.discipline}:${icon.level}`"
                        :discipline="icon.discipline"
                        :level="icon.level"
                    />
                    {{ levelName(choice) }}
                </span>
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
        <div
            v-if="engine.pending?.prompt"
            class="engine-staging-question"
        >
            <EngineText :text="engine.pending.prompt" />
        </div>
        <div class="engine-staging-prompt">Click a glowing card, or :</div>
        <div class="engine-staging-choices">
            <button
                v-for="option in picks"
                :key="option.index"
                class="game-button small"
                @click="pick(option)"
                @mouseenter="hoverEngineCard(engineOptionCards(option)[0])"
                @mouseleave="hoverEngineCard(null)"
            >
                {{ option.text }}
            </button>
        </div>
    </CentralPanel>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { hoverEngineCard } from '@/client/engine/cardNames.ts'
import EngineText from '@/client/ui/ingame/EngineText.vue'
import CentralPanel from '@/client/ui/ingame/topArea/central/CentralPanel.vue'
import DisciplineIcon from '@/client/ui/components/DisciplineIcon.vue'
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

const engine = useEngineStore()

const picks = computed(() => engine.pending?.options.filter(isPick) ?? [])
const picking = computed(() => picks.value.length > 0)

function pick(option: EngineOption) {
    hoverEngineCard(null)
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

// The target step names what the target is for, when the card chooses two minions
function prompt(step: StagingStep): string {
    return step.role ?
            `${step.role[0].toUpperCase()}${step.role.slice(1)} ? Click a glowing card`
        :   PROMPTS[step.ask]
}

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

// A mode's level, in words, when its Disciplines are all at one level
function levelName(choice: StagingChoice): string {
    const levels = new Set(icons(choice).map(icon => icon.level))
    return (
        levels.size != 1 ? ''
        : levels.has(DisciplineLevel.SUPERIOR) ? 'superior'
        : 'inferior'
    )
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
    // What the pick is for : the panel's question
    .engine-staging-question {
        font-size: 15px;
        font-weight: bold;
        text-align: center;
    }

    .engine-staging-prompt {
        font-size: 14px;
        margin-bottom: 6px;
    }

    // A mode : its Disciplines, large enough to tell apart, and its level
    .engine-staging-mode {
        display: inline-flex;
        align-items: center;
        gap: 4px;

        .discipline-icon {
            height: 1.8em;
            width: 1.8em;
        }
    }

    .engine-staging-choices {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 6px;
    }
}
</style>
