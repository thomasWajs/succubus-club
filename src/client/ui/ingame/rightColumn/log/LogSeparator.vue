<template>
    <div
        class="log-separator"
        :class="[
            row.kind,
            {
                rewind: row.kind === 'turn' && row.isRewind,
                'joins-block': row.kind === 'phase' && row.joinsBlock,
                cancelled: isCancelled,
                highlighted: isHighlighted,
            },
        ]"
        :style="barColor ? { '--author-color': barColor } : undefined"
        :data-mutation-ids="row.entry?.mutationId"
        :title="authorTitle"
    >
        <span class="rule start" />
        <span class="label">
            {{ row.kind === 'turn' ? `Turn ${row.turnNumber}` : `${row.phaseName} phase` }}
            <!-- Whose turn it is, in their seat color -->
            <template v-if="activePlayer">
                <span class="label-dot">·</span>
                <span
                    class="active-player"
                    :style="{ color: activePlayer.color }"
                >
                    {{ activePlayer.name }}
                </span>
            </template>
        </span>
        <!-- An undone turn change : hovering it highlights the undone one -->
        <span
            v-if="cancelsMutationId !== undefined"
            class="info-tag"
            title="Undoes a turn change, highlighted above"
            @mouseenter="emit('link', cancelsMutationId)"
            @mouseleave="emit('link', null)"
        >
            Undo
        </span>
        <span
            v-else-if="row.kind === 'turn' && row.isRewind"
            class="info-tag"
            title="Back to a previous turn"
        >
            Back
        </span>
        <span class="rule end" />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useHistoryStore } from '@/client/store/history.ts'
import { GameMutationId } from '@/shared/state/gameMutations.ts'
import { PhaseRow, TurnRow } from '@/client/ui/ingame/rightColumn/log/logRows.ts'
import { logAuthorBarColor, logPlayerName } from '@/client/ui/ingame/rightColumn/log/logText.ts'

const { row } = defineProps<{
    row: TurnRow | PhaseRow
    // Linked to the hovered undo
    isHighlighted: boolean
}>()

const emit = defineEmits<{
    link: [mutationId: GameMutationId | null]
}>()

const history = useHistoryStore()

// A phase the author's bar goes through
const barColor = computed(() =>
    row.kind === 'phase' && row.joinsBlock && row.entry ? logAuthorBarColor(row.entry) : undefined,
)

const activePlayer = computed(() =>
    row.kind === 'turn' && row.activePlayerOid ? logPlayerName(row.activePlayerOid) : null,
)

const cancelsMutationId = computed(() => row.entry?.cancelsMutationId)

const isCancelled = computed(() => {
    const mutationId = row.entry?.mutationId
    return mutationId !== undefined && history.cancelledMutations.has(mutationId)
})

// Who changed the turn or phase
const authorTitle = computed(() =>
    row.entry ? `${row.entry.authorName} : ${row.entry.text}` : undefined,
)
</script>

<style lang="scss" scoped>
.log-separator {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px;
    user-select: none;

    .rule {
        flex-grow: 1;
        height: 0;
        border-top: solid 1px light-dark(rgba($shadow-grey, 0.45), $ui-border);
    }

    .label {
        white-space: nowrap;
    }

    .label-dot {
        margin: 0 2px;
        opacity: 0.6;
    }

    .info-tag {
        @include log-info-tag;
    }

    // A turn : centered title between two rules
    &.turn {
        margin: 12px 0 4px;

        .label {
            @include ui-title;
            font-size: 16px;
            color: var(--ui-panel-text);
        }

        .rule {
            border-top-color: light-dark(rgba($shadow-grey, 0.6), $ui-accent-light);
            opacity: 0.6;
        }
    }

    &.rewind .rule {
        border-top-style: dashed;
    }

    // A phase : centered like a turn, smaller and lighter
    // The bar's place is kept when it doesn't go through : same width either way
    &.phase {
        margin: 6px 0 2px;
        padding-left: 7px;
        border-left: solid 3px transparent;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--ui-panel-text-muted);

        .label {
            opacity: 0.75;
        }

        // In the bar of the author block around it : paddings rather than margins, so the bar
        // doesn't break, even above and below so the label sits in the middle, and the same
        // indent as the lines
        &.joins-block {
            margin: 0;
            padding-top: 4px;
            padding-bottom: 4px;
            border-left-color: var(--author-color);
        }

        .rule.start {
            margin-left: 20px;
        }
        .rule.end {
            margin-right: 20px;
        }
    }

    &.cancelled {
        .label {
            opacity: 0.5;
            text-decoration: line-through;
        }
    }

    &.highlighted {
        background: light-dark(rgba($light-teal, 0.45), rgba($ui-accent, 0.6));
    }
}
</style>
