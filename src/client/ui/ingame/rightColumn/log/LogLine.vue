<template>
    <!-- The author and time are written above the first line of their block, where the bar
    starts -->
    <div
        v-if="showAuthor"
        class="log-author"
    >
        <span
            class="author-name"
            :style="{ color: authorTextColor }"
        >
            {{ logEntry.authorName }}
        </span>
        <span
            v-if="timeVisible"
            class="time"
        >
            {{ logTime(firstEntry.timestamp) }}
        </span>
    </div>
    <div
        class="log-line"
        :class="{
            chat: isChat,
            cancelled: isCancelled,
            neutral: isNeutral,
            clickable: isClickable,
            'most-recent': isMostRecent,
            highlighted: isHighlighted,
        }"
        :style="{ '--author-color': authorColor }"
        :data-mutation-ids="mutationIds.join(' ')"
        @mouseover="onLogLineMouseOver($event)"
        @mouseout="onLogLineMouseOut()"
        @click="onLogLineClick($event)"
    >
        <div class="content">
            <span class="text">
                <Icon
                    v-if="isChat"
                    name="chat"
                    class="chat-icon"
                />

                <!-- An undo logs what it did ( "-1 blood" for an undone "+1 blood" ), tagged -->
                <span
                    v-if="isCancel"
                    class="undo-tag"
                    :class="{ conflict: logEntry.resolvesConflict }"
                    :title="undoTagTitle"
                    @mouseenter="emit('link', logEntry.cancelsMutationId ?? null)"
                    @mouseleave="emit('link', null)"
                >
                    {{ logEntry.resolvesConflict ? 'Conflict' : 'Undo' }}
                </span>
                <!-- Use v-html only with mutation logs -->
                <span
                    v-if="!isChat"
                    class="mutation"
                    v-html="mutationLogHtml"
                />
                <!-- Escape text from chat to avoid XSS -->
                <span
                    v-else
                    class="mutation"
                >
                    {{ logEntry.text }}
                </span>
                <!-- Inline, after the last word : the details, right-aligned, don't move when it
                goes -->
                <LogUndoButton :mutationIds="mutationIds" />
            </span>

            <!-- State infos : pool, hand size, unlocked cards... -->
            <span
                v-if="detailsHtml.length > 0"
                class="details"
            >
                <!-- Use v-html only with mutation logs -->
                <span
                    v-for="(detail, index) in detailsHtml"
                    :key="index"
                    class="detail"
                    :title="detail.icon ? detail.label : undefined"
                >
                    <Icon
                        v-if="detail.icon"
                        :name="detail.icon.name"
                        class="detail-icon"
                        :class="detail.icon.name"
                        :style="{ color: detail.icon.color }"
                    />
                    <span
                        v-else-if="detail.label"
                        class="detail-label"
                    >
                        {{ detail.label }}
                    </span>
                    <template v-if="detail.from !== undefined">
                        <span class="detail-from">{{ detail.from }}</span>
                        <span class="detail-arrow">→</span>
                    </template>
                    <span
                        class="detail-value"
                        v-html="detail.valueHtml"
                    />
                </span>
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { useHistoryStore } from '@/client/store/history.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { Card } from '@/shared/model/Card.ts'
import { LogEntry } from '@/shared/types/history.ts'
import { CardOid } from '@/shared/types/model.ts'
import { GameMutationId } from '@/shared/state/gameMutations.ts'
import { logAuthorRgba } from '@/client/colors.ts'
import Icon from '@/client/ui/components/Icon.vue'
import LogUndoButton from '@/client/ui/ingame/rightColumn/log/LogUndoButton.vue'
import {
    groupLineText,
    groupTotal,
    isCancelEntry,
    isChatEntry,
} from '@/client/ui/ingame/rightColumn/log/logRows.ts'
import {
    findLogCard,
    logAuthorBarColor,
    logDetailIcon,
    logEntryCard,
    logTextHtml,
    logTime,
    logUnlockedCards,
} from '@/client/ui/ingame/rightColumn/log/logText.ts'

const gameBus = useGameBusStore()
const history = useHistoryStore()

const { entries, folded, showAuthor, timeVisible, isMostRecent, isHighlighted } = defineProps<{
    // Several entries for grouped counter changes, oldest first
    entries: LogEntry[]
    // The entries completing an action declaration, oldest first
    folded: LogEntry[]
    // Heads a block of consecutive lines of the same author
    showAuthor: boolean
    // The time toggle of the log bar
    timeVisible: boolean
    isMostRecent: boolean
    // Linked to the hovered undo
    isHighlighted: boolean
}>()

const emit = defineEmits<{
    // Hovering an undo highlights the undone entry
    link: [mutationId: GameMutationId | null]
}>()

// The most recent entry of the row : its text, with the total of the group
const logEntry = computed(() => entries[entries.length - 1])
const firstEntry = computed(() => entries[0])
const isGroup = computed(() => entries.length > 1)

const mutationIds = computed(() =>
    [...entries, ...folded]
        .map(entry => entry.mutationId)
        .filter(mutationId => mutationId !== undefined),
)

// The text of an action declaration is the one of the latest entry logging it again, unless
// undone
const textEntry = computed(() => {
    const declarations = [logEntry.value, ...folded.filter(entry => !entry.fold?.isSilent)]
    const current = declarations.findLast(
        entry =>
            entry.mutationId === undefined || !history.cancelledMutations.has(entry.mutationId),
    )
    return current ?? logEntry.value
})

const isChat = computed(() => isChatEntry(logEntry.value))
const isCancel = computed(() => isCancelEntry(logEntry.value))
// The entries of a row are all undone, or none ( see buildLogRows )
const isCancelled = computed(() => {
    const mutationId = logEntry.value.mutationId
    return mutationId !== undefined && history.cancelledMutations.has(mutationId)
})

/** Author **/

// The seat color, for the bar on the left and the name. Authors without a seat keep their
// pastel for the bar, and the text color for the name
const authorColor = computed(() => logAuthorBarColor(logEntry.value))
const authorTextColor = computed(() => logAuthorRgba(logEntry.value.authorColorRgba) ?? undefined)

/** Texts **/

const entryCard = computed(() => logEntryCard(textEntry.value))

const mutationLogHtml = computed(() =>
    logTextHtml(groupLineText(isGroup.value ? entries : [textEntry.value]), entryCard.value),
)

const undoTagTitle = computed(() =>
    logEntry.value.resolvesConflict ?
        'Undone automatically, to resolve a conflict between players. The undone action is highlighted above'
    :   'Undoes an earlier action, highlighted above',
)

/** Details **/

// The state after the most recent entry of the row. A group goes from the value before its
// first entry
const detailsHtml = computed(() => {
    const firstDetails = firstEntry.value.details ?? []
    return (logEntry.value.details ?? []).map((detail, index) => ({
        label: detail.label,
        icon: detail.icon ? logDetailIcon(detail.icon) : undefined,
        from: isGroup.value ? (firstDetails[index]?.from ?? detail.from) : detail.from,
        valueHtml: logTextHtml(detail.value, entryCard.value),
    }))
})

// Changes that cancel out ( "+1" then "-1" ) : logged, but muted
const isNeutral = computed(() => isGroup.value && groupTotal(entries) === 0)

// The cards of an Unlock All, to ping from the log
const unlockedCards = computed(() => logUnlockedCards(logEntry.value))

/** Line over **/

// The card under the pointer : a card named in the text, or else the card of the entry
function pointedCard(event: MouseEvent): Card | null {
    const target = event.target instanceof Element ? event.target : null
    const cardOid = target?.closest<HTMLElement>('[data-card-oid]')?.dataset.cardOid
    const namedCard = cardOid ? findLogCard(cardOid as CardOid) : undefined
    if (namedCard && namedCard !== logEntry.value.card) {
        // Named in clear in the text : the reader can view it
        return namedCard
    }
    return entryCard.value
}

let isPointerOver = false

// The card is also outlined where it is on the table, or in the hand
function onLogLineMouseOver(event: MouseEvent) {
    const card = pointedCard(event)
    isPointerOver = true
    gameBus.logHoveredCard = card?.oid ?? null
    if (card) {
        // If there was a player vision at the time of the view,
        // we force canView = true, even if it's not visible anymore
        gameBus.setCloseUpCard(card, { canView: true })
    }
}

function onLogLineMouseOut() {
    isPointerOver = false
    gameBus.logHoveredCard = null
    gameBus.assignPinnedCloseUpCard()
}

// Archived or filtered out while hovered : no mouseout then
onBeforeUnmount(() => {
    if (isPointerOver) {
        gameBus.logHoveredCard = null
    }
})

/** Line click **/

const isClickable = computed(() => !!entryCard.value || unlockedCards.value.length > 0)

function onLogLineClick(event: MouseEvent) {
    const card = pointedCard(event)
    if (card) {
        gameBus.setCloseUpCard(card, { canView: true, pinned: true, flash: true })
    } else if (unlockedCards.value.length > 0) {
        for (const unlockedCard of unlockedCards.value) {
            gameBus.pingCard(unlockedCard.oid)
        }
    }
}
</script>

<style lang="scss" scoped>
// Heads the bar of an author block, aligned on it
.log-author {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-top: 5px;
    padding-left: 1px;
    font-size: 12px;
    line-height: 1.3;

    .author-name {
        font-weight: 600;
    }

    .time {
        color: var(--ui-panel-text-muted);
        opacity: 0.7;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        user-select: none;
    }
}

// The author color as a bar on the left : consecutive lines of an author make one bar
.log-line {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 2px 4px 2px 7px;
    border-left: solid 3px var(--author-color);
    line-height: 1.5;

    &:hover {
        background: light-dark(rgba(black, 0.06), rgba(white, 0.05));
    }

    &.clickable {
        cursor: pointer;
    }

    &.most-recent {
        animation: logAppear 1s linear;
    }

    &.highlighted {
        background: light-dark(rgba($light-teal, 0.45), rgba($ui-accent, 0.6));
    }

    // Chat stands out from the game actions
    &.chat {
        background: light-dark(rgba(white, 0.35), rgba(white, 0.04));
    }

    // Undone : faded and struck through
    &.cancelled {
        .mutation {
            opacity: 0.5;
            text-decoration: line-through;
        }

        .details {
            opacity: 0.5;
        }
    }

    // Changes that cancel out : nothing changed in the end
    &.neutral {
        .mutation,
        .details {
            opacity: 0.6;
        }

        .mutation {
            font-style: italic;
        }
    }

    // The text, then the details on the right : on the same line when they fit, else
    // right-aligned below
    .content {
        display: flex;
        flex-grow: 1;
        flex-wrap: wrap;
        align-items: baseline;
        column-gap: 8px;
        min-width: 0;
        overflow-wrap: anywhere;
    }

    .text {
        min-width: 0;
    }

    .chat-icon {
        margin-right: 0.3em;
        opacity: 0.6;
    }

    // Undo : a tag, then what the undo did
    .undo-tag {
        @include log-info-tag;
        margin-right: 5px;
        vertical-align: 1px;
        cursor: default;

        &.conflict {
            color: var(--ui-danger-text);
        }
    }

    // Inline after the last word ( the root of LogUndoButton gets the scope of this component )
    .undo-button {
        display: inline-flex;
        margin-left: 6px;
        vertical-align: -3px;
    }

    .details {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 3px;
        margin-left: auto;
        font-size: 12px;
        line-height: 16px;
    }

    .detail {
        display: inline-flex;
        gap: 3px;
        padding: 0 4px;
        background: light-dark(rgba(black, 0.07), rgba(white, 0.07));
        white-space: nowrap;

        .detail-label,
        .detail-arrow {
            color: var(--ui-panel-text-muted);
        }

        // Instead of the label : blood, pool, a counter, a die...
        .detail-icon {
            align-self: center;

            // Lighter on the dark theme, where blood red is too dark
            &.blood {
                color: light-dark($blood-red, $icon-red);
            }
        }

        // The value before a change : plain, the value after stands out
        .detail-from {
            font-variant-numeric: tabular-nums;
        }

        .detail-value {
            font-weight: 600;
            font-variant-numeric: tabular-nums;
            // A revealed secret can be long
            white-space: normal;
            overflow-wrap: anywhere;
        }
    }

    :deep(.cryptCard) {
        color: var(--ui-crypt-card);
        font-weight: bold;
    }

    :deep(.libCard) {
        color: var(--ui-library-card);
        font-weight: bold;
    }

    :deep(.player-name) {
        font-weight: 600;
    }

    :deep(.hidden) {
        color: light-dark($royal-purple, $ui-text-muted);
        font-style: italic;
    }
}

@keyframes logAppear {
    0% {
        background-color: transparent;
    }
    10% {
        background-color: light-dark($light-teal, $ui-accent);
    }
    100% {
        background-color: transparent;
    }
}
</style>
