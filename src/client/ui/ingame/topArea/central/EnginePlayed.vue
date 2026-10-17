<template>
    <CentralPanel
        v-if="engine.played.length > 0"
        class="engine-played"
        title="Played during the action"
        :style="{ minHeight: minHeight }"
    >
        <div
            ref="lines"
            class="engine-played-lines"
            :style="{ clipPath: `inset(${clipTop}px 0 0 0)` }"
            @scroll="fitLines"
        >
            <div
                v-for="(play, i) in played"
                :key="i"
                class="engine-played-line"
                @mouseenter="hoverEngineCard(engineOptionCards(play.option)[0])"
                @mouseleave="hoverEngineCard(null)"
            >
                <template v-if="play.short">
                    <EngineText :text="play.short.text" />
                    <DisciplineIcon
                        v-for="icon in play.short.icons"
                        :key="`${icon.discipline}:${icon.level}`"
                        :discipline="icon.discipline"
                        :level="icon.level"
                    />
                </template>
                <template v-else>
                    <strong>{{ play.player }}</strong> : <EngineText :text="play.text" />
                </template>
            </div>
        </div>
    </CentralPanel>
</template>

<script setup lang="ts">
/**
 * A game with the rules engine : the cards played during the action under way, by whom, until
 * the action is over. They are in the ash heap already ; this is what happened.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
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

// The cards played, each with its short line when it has one
const played = computed(() =>
    engine.played.map(play => ({ ...play, short: short(play.option, play.player) })),
)

/**
 * Whole lines only : the panel gives way down to its title and the latest line ( one row or
 * two ), its lines scrolled a line at a time ( snapped to their bottom ), the part of a line
 * cut at the top of the scrolled lines hidden.
 */
const lines = ref<HTMLElement | null>(null)
// The panel's least height : its title and the latest line
const minHeight = ref<string | undefined>(undefined)
// The part of the lines' box over the first whole line in it
const clipTop = ref(0)

function fitLines() {
    const box = lines.value
    const panel = box?.parentElement
    const items = box ? [...box.children].filter(item => item instanceof HTMLElement) : []
    const latest = items.at(-1)
    // Not laid out ( a hidden tab ) : measured again when it is
    if (!box || !panel || !latest || latest.offsetHeight == 0) {
        return
    }
    const chrome = panel.offsetHeight - box.offsetHeight
    minHeight.value = `${chrome + latest.offsetHeight}px`
    const first = items.find(item => item.offsetTop >= box.scrollTop - 0.5)
    clipTop.value = first ? Math.max(0, first.offsetTop - box.scrollTop) : 0
}

// The latest card played in sight, the lines fitted again
watch(
    () => engine.played.length,
    async () => {
        await nextTick()
        if (lines.value) {
            lines.value.scrollTop = lines.value.scrollHeight
        }
        fitLines()
    },
    { immediate: true },
)

// The central box's room changes ( a panel above it comes or goes ) : the lines fitted again
const resizes = new ResizeObserver(() => fitLines())
watch(lines, (box, previous) => {
    if (previous) {
        resizes.unobserve(previous)
    }
    if (box) {
        resizes.observe(box)
    }
})
onBeforeUnmount(() => resizes.disconnect())

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

    padding-top: 0.25rem;
    padding-bottom: 0.25rem;

    // The one panel of the central box that gives way : the decision, the action and the
    // referendum above or below it stay whole, its lines scroll ( down to its title and the
    // latest line, whole : its least height set by fitLines )
    flex: 0 1 auto;
    overflow: hidden;

    .engine-played-lines {
        position: relative;
        align-self: stretch;
        min-height: 0;
        overflow-y: auto;
        scroll-snap-type: y mandatory;
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    .engine-played-line {
        flex-shrink: 0;
        scroll-snap-align: end;
        cursor: default;
    }
}
</style>
