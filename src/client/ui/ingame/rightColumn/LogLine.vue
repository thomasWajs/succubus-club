<template>
    <div
        class="log-line"
        :class="{ 'most-recent': index === history.logEntries.length - 1, clickable: isClickable }"
        @mouseover="onLogLineMouseOver(logEntry)"
        @mousemove="onLogLineMouseMove($event)"
        @mouseout="onLogLineMouseOut()"
        @mouseleave="onLogLineMouseLeave()"
        @click="onLogLineClick(logEntry)"
    >
        <span
            v-if="logEntry.mutationId && logEntry.mutationId == history.nextCancellableMutation?.id"
            class="cancel-arrow"
            @click="cancelMutation(history.nextCancellableMutation)"
        >
            ↩
        </span>
        <span
            v-if="showTime"
            class="time"
        >
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
    <Teleport to="body">
        <div
            v-if="unlockedCardsPopupPosition"
            class="unlocked-cards-popup"
            :style="{
                left: `${unlockedCardsPopupPosition.x}px`,
                top: `${unlockedCardsPopupPosition.y}px`,
            }"
        >
            <div class="popup-title">Unlocked cards</div>
            <div
                v-for="card in unlockedCards"
                :key="card.oid"
                :class="
                    selfCanSeeOrPeek(card) ?
                        card.isCrypt ?
                            'cryptCard'
                        :   'libCard'
                    :   'hidden'
                "
            >
                {{ selfCanSeeOrPeek(card) ? card.name : 'Hidden card' }}
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useHistoryStore } from '@/client/store/history.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { selfCanSeeOrPeek, selfIsJudge } from '@/client/state/self.ts'
import { Card } from '@/shared/model/Card.ts'
import { CARD_LOG_PLACEHOLDER } from '@/shared/const/game.ts'
import { OID_PREFIX } from '@/shared/const/multiplayer.ts'
import { LogEntry } from '@/shared/types/history.ts'
import { CardOid } from '@/shared/types/model.ts'
import { cancelMutation } from '@/client/state/gameMutations.ts'

const players = usePlayersStore()
const gameBus = useGameBusStore()
const history = useHistoryStore()
const gameState = useGameStateStore()

const { logEntry, index, showTime } = defineProps<{
    logEntry: LogEntry
    index: number
    showTime: boolean
}>()

const selfHasVision = computed(() => {
    const vision = logEntry.playerVision
    if (!logEntry.card || !vision) {
        return false
    }
    // A judge oversees the game : they see every logged card
    if (selfIsJudge()) {
        return true
    }
    return vision.public || (players.selfPlayerOid && vision[players.selfPlayerOid])
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

/** Unlock All helpers **/

// Cards unlocked by an UnlockAll mutation, so they can be pinged from the log
const unlockedCards = computed<Card[]>(() => {
    if (!logEntry.mutationId) {
        return []
    }
    const mutationEntry = history.gameMutationsMap[logEntry.mutationId]
    if (mutationEntry?.serializedMutation.name !== 'unlockAll') {
        return []
    }
    const cards = mutationEntry.serializedMutation.previousState?.cards
    if (!Array.isArray(cards)) {
        return []
    }
    return cards.map(card => {
        const cardOid = card.substring(OID_PREFIX.length) as CardOid
        return gameState.cards[cardOid] ?? gameState.staleCards[cardOid]
    })
})

const unlockedCardsPopupPosition = ref<{ x: number; y: number } | null>(null)

/** Line over **/

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

function onLogLineMouseMove(event: MouseEvent) {
    if (unlockedCards.value.length > 0) {
        unlockedCardsPopupPosition.value = { x: event.clientX, y: event.clientY }
    }
}

/** Line click **/

function onLogLineMouseLeave() {
    unlockedCardsPopupPosition.value = null
}

const isClickable = computed(
    () => (selfHasVision.value && !!logEntry.card) || unlockedCards.value.length > 0,
)

function onLogLineClick(logEntry: LogEntry) {
    if (selfHasVision.value && logEntry.card) {
        // If there was a player vision at the time of the view,
        // we force canView = true, even if it's not visible anymore
        gameBus.setCloseUpCard(logEntry.card, { canView: true, pinned: true, flash: true })
    } else if (unlockedCards.value.length > 0) {
        for (const card of unlockedCards.value) {
            gameBus.pingCard(card.oid)
        }
    }
}
</script>

<style lang="scss" scoped>
.log-line {
    margin-bottom: 2px;

    &.clickable {
        cursor: pointer;
    }

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

.unlocked-cards-popup {
    position: fixed;
    transform: translate(-50%, calc(-100% - 8px));

    background: $pearl-grey;
    color: $ash-grey;
    border: 2px solid $dark-blood;

    padding: 6px 10px;
    font-size: 13px;
    white-space: nowrap;

    pointer-events: none;
    user-select: none;
    z-index: 1100;

    .popup-title {
        font-weight: bold;
        margin-bottom: 4px;
    }

    .cryptCard {
        color: $crypt-orange;
        font-weight: bold;
    }

    .libCard {
        color: $library-green;
        font-weight: bold;
    }

    .hidden {
        color: $royal-purple;
        font-weight: bold;
    }
}
</style>
