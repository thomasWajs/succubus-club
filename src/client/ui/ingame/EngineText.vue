<template>
    <!-- Text only : the line is escaped, never v-html -->
    <template
        v-for="(segment, i) in segments"
        :key="i"
    >
        <span
            v-if="segment.seat != null"
            class="engine-seat"
            :style="{ background: engine.seatColors[segment.seat] }"
            >{{ segment.text }}</span
        >
        <span
            v-else-if="segment.krcgId"
            :class="['engine-card-name', segment.isCrypt ? 'crypt' : 'library']"
            @mouseenter="hoverEngineCard(cardWithId(segment.krcgId), true)"
            @mouseleave="hoverEngineCard(null)"
            @click.stop="pinEngineCard(cardWithId(segment.krcgId))"
            >{{ segment.text }}</span
        >
        <template v-else>{{ segment.text }}</template>
    </template>
</template>

<script setup lang="ts">
/**
 * A line of the rules engine ( the log, the cards played during an action, a referendum's
 * terms ) : the cards it names are shown when hovered, pinned when clicked, as in SC's log.
 * Its text, or its pieces composed already ( the log's, a seat in its color ).
 */
import { computed } from 'vue'
import {
    cardSegments,
    cardWithId,
    hoverEngineCard,
    pinEngineCard,
} from '@/client/engine/cardNames.ts'
import type { LogSegment } from '@/client/engine/log.ts'
import { useEngineStore } from '@/client/store/engine.ts'

const { text = '', pieces } = defineProps<{ text?: string; pieces?: LogSegment[] }>()

const engine = useEngineStore()

const segments = computed<LogSegment[]>(() => pieces ?? cardSegments(text))
</script>

<style lang="scss">
.engine-seat {
    padding: 0 1px;
    font-weight: bold;
}

.engine-card-name {
    font-weight: bold;
    cursor: pointer;

    &.crypt {
        color: $crypt-orange;
    }

    &.library {
        color: $library-green;
    }

    &:hover {
        text-decoration: underline;
    }
}
</style>
