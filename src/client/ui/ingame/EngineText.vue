<template>
    <!-- Text only : the line is escaped, never v-html -->
    <template
        v-for="(segment, i) in segments"
        :key="i"
    >
        <span
            v-if="segment.krcgId"
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
 */
import { computed } from 'vue'
import {
    cardSegments,
    cardWithId,
    hoverEngineCard,
    pinEngineCard,
} from '@/client/engine/cardNames.ts'

const { text } = defineProps<{ text: string }>()

const segments = computed(() => cardSegments(text))
</script>

<style lang="scss">
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
