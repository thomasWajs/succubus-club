<template>
    <div
        v-if="engine.pending || engine.status || engine.result"
        class="engine-decision-panel"
        :class="{ 'on-table': onTable }"
        :style="style"
    >
        <template v-if="engine.result">
            <div class="engine-window">Game over</div>
            <div
                v-for="player in players.orderedPlayers"
                :key="player.oid"
                class="engine-result"
            >
                {{ player.name }} : {{ player.victoryPoints }} VP
            </div>
        </template>

        <template v-else-if="engine.pending">
            <div class="engine-window">Your decision : {{ engine.pending.window }}</div>
            <div
                v-if="engine.pending.prompt"
                class="engine-prompt"
            >
                <EngineText :text="engine.pending.prompt" />
            </div>
            <div
                v-if="elsewhere.length > 0"
                class="engine-hint"
            >
                Act on the table{{ shown.length > 0 ? ', or :' : '' }}
            </div>
            <button
                v-for="option in shown"
                :key="option.index"
                class="engine-option"
                :class="{ pass: option.kind == 'pass', relevant: relevant.has(option.index) }"
                @click="choose(option)"
                @mouseenter="hover(option)"
                @mouseleave="hoverEngineCard(null)"
            >
                {{ option.text }}
            </button>

            <!-- Every option, as a fallback : those answered on the table too -->
            <template v-if="elsewhere.length > 0">
                <a
                    class="engine-all"
                    @click="showAll = !showAll"
                >
                    {{ showAll ? 'Hide the other options' : `All options ( ${options.length} )` }}
                </a>
                <template v-if="showAll">
                    <button
                        v-for="option in elsewhere"
                        :key="option.index"
                        class="engine-option elsewhere"
                        :class="{ pass: option.kind == 'pass' }"
                        @click="choose(option)"
                        @mouseenter="hover(option)"
                        @mouseleave="hoverEngineCard(null)"
                    >
                        {{ option.text }}
                    </button>
                </template>
            </template>
        </template>

        <div
            v-else
            class="engine-status"
        >
            {{ engine.status }}
        </div>

        <button
            v-if="engine.pending?.undo"
            class="engine-option undo"
            @click="undoEngineStep()"
        >
            Take back my last decision ( ⟵ )
        </button>

        <a
            class="engine-replay"
            @click="exportReplay()"
        >
            Export replay
        </a>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { hoverEngineCard } from '@/client/engine/cardNames.ts'
import EngineText from '@/client/ui/ingame/EngineText.vue'
import { useEngineStore } from '@/client/store/engine.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import {
    chooseEngineOption,
    engineOptionCards,
    engineReplay,
    undoEngineStep,
} from '@/client/engine/driver.ts'
import { answeredOnTable } from '@/client/engine/interaction.ts'
import { display } from '@/client/game/display.ts'
import { WorldAlignment } from '@/client/gateway/db.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import {
    BOTTOM_PLAYERS_Y,
    HAND_Y,
    OTHER_PLAYERS_HORIZONTAL_GUTTER,
    RIGHT_PLAYERS_X,
    WORLD_WIDTH,
} from '@/shared/const/game.ts'
import { EngineOption } from '@/client/engine/protocol.ts'

const engine = useEngineStore()
const gameBus = useGameBusStore()
const players = usePlayersStore()
const { worldAlignment } = useUIFeatures()

/**
 * Where the panel sits : on the table, in the seat left free at the bottom
 * right by a table of 4 players or less ( placed and scaled like the top
 * area ). Floating at the top right otherwise ( 5 players, focus mode ).
 */
const PANEL_WIDTH = WORLD_WIDTH - RIGHT_PLAYERS_X - OTHER_PLAYERS_HORIZONTAL_GUTTER
const PANEL_HEIGHT = HAND_Y - BOTTOM_PLAYERS_Y - 2 * OTHER_PLAYERS_HORIZONTAL_GUTTER

const onTable = computed(() => display.rightColumnVisible && players.orderedPlayers.length <= 4)

const style = computed(() => {
    if (!onTable.value) {
        return {}
    }
    const topRight = worldAlignment.value == WorldAlignment.TopRight
    const offsetLeft =
        topRight ?
            display.actualWidth - (WORLD_WIDTH + display.horizontalPadding) * display.scale
        :   display.horizontalSpaceAvailable / 2
    const offsetTop = topRight ? 0 : display.verticalSpaceAvailable / 2
    return {
        left: `${RIGHT_PLAYERS_X * display.scale + offsetLeft}px`,
        top: `${(BOTTOM_PLAYERS_Y + OTHER_PLAYERS_HORIZONTAL_GUTTER) * display.scale + offsetTop}px`,
        width: `${PANEL_WIDTH}px`,
        maxHeight: `${PANEL_HEIGHT}px`,
        transform: `scale(${display.scale})`,
    }
})

// The options the user's last move can mean, and those about the selected cards
const relevant = computed(() => {
    const indexes = new Set(engine.focus)
    const selected = new Set(gameBus.selectedCards.map(card => card.oid))
    if (selected.size > 0) {
        for (const option of engine.pending?.options ?? []) {
            if (engineOptionCards(option).some(card => selected.has(card.oid))) {
                indexes.add(option.index)
            }
        }
    }
    return indexes
})

const options = computed(() => engine.pending?.options ?? [])

// Shown : the options with no place on the table ( or the central box ), and those the user's
// last move can mean, first. The others on demand.
const shown = computed(() => [
    ...options.value.filter(option => relevant.value.has(option.index)),
    ...options.value.filter(
        option => !relevant.value.has(option.index) && !answeredOnTable(option),
    ),
])
const elsewhere = computed(() => {
    const listed = new Set(shown.value.map(option => option.index))
    return options.value.filter(option => !listed.has(option.index))
})
const showAll = ref(false)
watch(
    () => engine.pending?.decision,
    () => (showAll.value = false),
)

// Show on the table the card an option is about
function hover(option: EngineOption) {
    hoverEngineCard(engineOptionCards(option)[0])
}

// The replay ( the game's setup and every decision ) reproduces the game in the engine : to report a bug
async function exportReplay() {
    const replay = await engineReplay()
    if (!replay) {
        return
    }
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([replay], { type: 'application/json' }))
    link.download = `zero-vtes-replay-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    link.click()
    URL.revokeObjectURL(link.href)
}

function choose(option: EngineOption) {
    hoverEngineCard(null)
    chooseEngineOption(option.index)
}
</script>

<style lang="scss">
.engine-decision-panel {
    // Floating at the top right, unless it sits on the table ( see `style` )
    position: absolute;
    top: 70px;
    right: 10px;
    z-index: 5;
    width: 300px;
    max-height: 60vh;
    box-sizing: border-box;
    overflow-y: auto;
    background: $ash-grey;
    border: 2px solid $lighter-teal;

    &.on-table {
        right: auto;
        transform-origin: top left;
    }

    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    color: $ghost-white;

    .engine-window {
        font-weight: bold;
        padding-bottom: 4px;
        border-bottom: 1px solid $slate-grey;
        margin-bottom: 4px;
    }

    // What the choice is for : the question itself, above its answers
    .engine-prompt {
        font-size: 14px;
        font-weight: bold;
        color: $ghost-white;
        background: $bone-grey;
        padding: 4px 6px;

        .engine-card-name {
            color: inherit;
            text-decoration: underline dotted;
        }
    }

    .engine-hint {
        color: $silver-grey;
        font-size: 12px;
    }

    .engine-status,
    .engine-result {
        color: $pearl-grey;
        font-size: 14px;
    }

    .engine-all {
        align-self: flex-start;
        font-size: 12px;
        color: $silver-grey;
        cursor: pointer;
        text-decoration: underline;
        margin-top: 4px;
    }

    .engine-replay {
        align-self: flex-end;
        font-size: 12px;
        color: $silver-grey;
        cursor: pointer;
        text-decoration: underline;
    }

    .engine-option {
        @include button-base;
        @include button-purple;
        text-align: left;
        font-size: 14px;
        padding: 6px 10px;

        &.pass {
            @include button-grey;
        }

        &.undo {
            @include button-grey;
            margin-top: 6px;
        }

        &.elsewhere {
            opacity: 0.8;
        }

        &.relevant {
            outline: 2px solid $status-amber;
        }

        &:disabled {
            opacity: 0.6;
            cursor: default;
        }
    }
}
</style>
