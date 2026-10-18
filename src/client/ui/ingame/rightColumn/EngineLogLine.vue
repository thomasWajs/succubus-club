<template>
    <div
        class="engine-log-line"
        :class="{ foldable, table: entry.seat == null }"
        @click="toggle"
    >
        <span
            v-if="showTime"
            class="time"
        >
            [{{ entry.time.getHours().toString().padStart(2, '0') }}:{{
                entry.time.getMinutes().toString().padStart(2, '0')
            }}]
        </span>
        <span
            v-if="foldable"
            class="fold"
            >{{ open ? '▾' : '▸' }}</span
        >
        <span
            v-if="entry.seat != null"
            class="author"
            :style="{ background: engine.seatColors[entry.seat] }"
            >P{{ entry.seat + 1 }}</span
        >
        <EngineText :pieces="entry.segments" />
        <span
            v-if="foldable && !open"
            class="folded"
        >
            ( {{ entry.children.length }} )</span
        >
    </div>
    <div
        v-if="foldable && open"
        class="engine-log-children"
    >
        <EngineLogLine
            v-for="child in entry.children"
            :key="child.id"
            :entry="child"
            :showTime="false"
        />
    </div>
</template>

<script setup lang="ts">
/**
 * A line of an engine game's log ( see log.ts ) : its seat "P2" in its color, then what it tells ;
 * an action or a combat folds the lines during it, open while it is under way.
 */
import { computed } from 'vue'
import type { EngineLogEntry } from '@/client/engine/log.ts'
import { useEngineStore } from '@/client/store/engine.ts'
import EngineText from '@/client/ui/ingame/EngineText.vue'

const { entry, showTime } = defineProps<{ entry: EngineLogEntry; showTime: boolean }>()

const engine = useEngineStore()

const foldable = computed(() => entry.children.length > 0)
const open = computed(() => engine.logOpen[entry.key] ?? entry.live)

function toggle() {
    if (foldable.value) {
        engine.logOpen[entry.key] = !open.value
    }
}
</script>

<style lang="scss" scoped>
.engine-log-line {
    margin-bottom: 2px;
    font-size: 13px;

    &.foldable {
        cursor: pointer;
    }

    &.table {
        font-style: italic;
    }

    .time {
        margin: 0;
    }

    .fold {
        display: inline-block;
        width: 1em;
    }

    .author {
        margin: 0 4px 0 2px;
        padding: 0 1px;
        font-weight: bold;
    }

    .folded {
        opacity: 0.6;
    }
}

.engine-log-children {
    margin-left: 1em;
    padding-left: 4px;
    border-left: 1px solid $purple-grey;
}

// What an action or a combat folds : a step smaller than its line
.engine-log-children .engine-log-line {
    font-size: 12px;
}
</style>
