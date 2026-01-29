<template>
    <div
        class="log-line"
        :class="{ 'most-recent': index === history.logEntries.length - 1 }"
        @mouseover="onLogLineMouseOver(logEntry)"
        @mouseout="onLogLineMouseOut()"
        @click="onLogLineClick(logEntry)"
    >
        <span
            v-if="logEntry.mutationId && logEntry.mutationId == history.nextCancellableMutation?.id"
            class="cancel-arrow"
            @click="cancelMutation(history.nextCancellableMutation)"
        >
            ↩
        </span>
        <span class="time">
            [{{ logEntry.timestamp.getHours().toString().padStart(2, '0') }}:{{
                logEntry.timestamp.getMinutes().toString().padStart(2, '0')
            }}]
        </span>
        <span
            class="author"
            :style="{ background: logEntry.authorColorRgba }"
        >
            {{ logEntry.authorName }}
        </span>
        <span v-if="!logEntry.mutationId"> 🗩 </span>
        <span
            v-if="logEntry.cancelText"
            class="cancel-text"
        >
            [Cancels <span v-html="logEntry.cancelText" />]
        </span>
        <span
            v-if="logEntry.mutationId && history.cancelledMutations.has(logEntry.mutationId)"
            class="cancel-text"
        >
            [CANCELLED]
        </span>
        <!-- Use v-html only with mutation logs -->
        <span
            v-if="logEntry.mutationId"
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
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useHistoryStore } from '@/client/store/history.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { CARD_LOG_PLACEHOLDER } from '@/shared/const/game.ts'
import { LogEntry } from '@/shared/types/history.ts'
import { cancelMutation } from '@/client/state/gameMutations.ts'

const gameState = useGameStateStore()
const gameBus = useGameBusStore()
const history = useHistoryStore()

const { logEntry, index } = defineProps<{
    logEntry: LogEntry
    index: number
}>()

const selfHasVision = computed(() => {
    const vision = logEntry.playerVision
    if (!logEntry.card || !vision) {
        return false
    }
    return vision.public || (gameState.selfPlayerOid && vision[gameState.selfPlayerOid])
})

const mutationLogHtml = computed(() => {
    let cardText
    if (selfHasVision.value && logEntry.card) {
        const cssClass = logEntry.card.isCrypt ? 'cryptCard' : 'libCard'
        cardText = `<span class="${cssClass}">${logEntry.card.name}</span>`
    } else {
        cardText = `<span class="hidden">hidden card</span>`
    }
    return logEntry.text.replace(CARD_LOG_PLACEHOLDER, cardText)
})

function onLogLineMouseOver(logEntry: LogEntry) {
    if (selfHasVision.value && logEntry.card) {
        // If there was a player vision at the time of the view,
        // we force canView = true, even if it's not visible anymore
        gameBus.setCloseUpCard(logEntry.card, { canView: true })
    }
}

function onLogLineMouseOut() {
    gameBus.assignPinnedCloseUpCard()
}

function onLogLineClick(logEntry: LogEntry) {
    if (selfHasVision.value && logEntry.card) {
        // If there was a player vision at the time of the view,
        // we force canView = true, even if it's not visible anymore
        gameBus.setCloseUpCard(logEntry.card, { canView: true, pinned: true })
    }
}
</script>

<style lang="scss" scoped>
.log-line {
    margin-bottom: 2px;

    &.most-recent {
        animation: logAppear 1s linear;
    }

    .cancel-arrow {
        font-weight: bold;
        color: $blood-red;
        cursor: pointer;
    }

    .time {
        margin: 0;
    }

    .author {
        margin: 0 2px;
        padding: 0 1px;
        font-weight: bold;
    }

    .cancel-text {
        font-style: italic;
        color: $dark-blood;
    }

    .mutation {
        display: inline;
    }

    :is(.cryptCard) {
        color: $crypt-orange;
        font-weight: bold;
    }

    :is(.libCard) {
        color: $library-green;
        font-weight: bold;
    }

    :is(.hidden) {
        color: $royal-purple;
        font-weight: bold;
    }
}
</style>
