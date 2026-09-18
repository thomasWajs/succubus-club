<template>
    <div class="chat-panel">
        <div
            v-if="title || language || $slots['title-actions']"
            class="chat-header"
        >
            <h3
                v-if="title"
                class="panel-title no-margin"
            >
                {{ title }}
            </h3>
            <span
                v-if="language"
                class="active-language"
                >{{ language }}</span
            >
            <slot name="title-actions" />
        </div>

        <div
            ref="logEl"
            class="chat-log"
        >
            <div
                v-if="messages.length === 0"
                class="chat-empty"
            >
                No messages yet. Say hello!
            </div>
            <template
                v-for="(item, index) in chatItems"
                :key="index"
            >
                <div
                    v-if="item.type === 'date-separator'"
                    class="chat-date-separator"
                >
                    <span class="chat-date-separator-text">{{ item.dateLabel }}</span>
                </div>
                <div
                    v-else
                    class="chat-message"
                >
                    <span
                        v-if="item.message.timestamp"
                        class="chat-timestamp"
                        >{{ formatTimestamp(item.message.timestamp) }}</span
                    >
                    <span class="chat-author">{{ item.message.authorName }}</span>
                    <span class="chat-text">{{ item.message.text }}</span>
                </div>
            </template>
        </div>

        <div
            v-if="disabled"
            class="chat-disabled-note"
        >
            {{ disabledMessage ?? 'You cannot send messages here.' }}
        </div>
        <div
            v-else
            class="chat-input-row"
        >
            <input
                v-model="draft"
                class="chat-input"
                placeholder="Type a message..."
                @keydown.enter="send"
            />
            <button
                class="chat-send-btn"
                :disabled="!draft.trim() || onCooldown"
                @click="send"
            >
                Send
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

// A minimal chat entry : the component only needs the author name and the text.
// Callers can pass richer objects ( e.g. history log entries ), which are compatible.
interface ChatEntry {
    authorName: string
    text: string
    timestamp?: Date
}

type ChatItem =
    | { type: 'message'; message: ChatEntry }
    | { type: 'date-separator'; dateLabel: string }

const props = defineProps<{
    title?: string
    // Full name of the active chat language, shown as a badge next to the title.
    language?: string
    messages: ChatEntry[]
    disabled?: boolean
    disabledMessage?: string
    // When set, the send button is disabled for this many ms after each send, to
    // mirror a server-side rate limit ( used by the lobby chat ).
    cooldownMs?: number
    // When set, a horizontal separator with the new date is inserted whenever a
    // message's calendar day differs from the previous one ( Discord-style ).
    showDateSeparators?: boolean
}>()

const emit = defineEmits<{
    send: [text: string]
}>()

const draft = ref('')
const logEl = ref<HTMLElement | null>(null)
const onCooldown = ref(false)
let cooldownTimer: ReturnType<typeof setTimeout> | null = null

function formatTimestamp(timestamp: Date) {
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(timestamp: Date) {
    return timestamp.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

function isSameDay(a: Date, b: Date) {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    )
}

const chatItems = computed<ChatItem[]>(() => {
    if (!props.showDateSeparators) {
        return props.messages.map(message => ({ type: 'message', message }))
    }

    const items: ChatItem[] = []
    let previousTimestamp: Date | undefined
    for (const message of props.messages) {
        if (
            message.timestamp &&
            (!previousTimestamp || !isSameDay(previousTimestamp, message.timestamp))
        ) {
            items.push({ type: 'date-separator', dateLabel: formatDate(message.timestamp) })
            previousTimestamp = message.timestamp
        }
        items.push({ type: 'message', message })
    }
    return items
})

async function scrollToBottom() {
    await nextTick()
    if (logEl.value) {
        logEl.value.scrollTop = logEl.value.scrollHeight
    }
}

function send() {
    const text = draft.value.trim()
    if (props.disabled || onCooldown.value || !text) {
        return
    }

    emit('send', text)
    draft.value = ''

    if (props.cooldownMs) {
        onCooldown.value = true
        cooldownTimer = setTimeout(() => {
            onCooldown.value = false
            cooldownTimer = null
        }, props.cooldownMs)
    }
}

// Keep the log pinned to the bottom as new messages arrive ( sent or received ).
watch(() => props.messages.length, scrollToBottom)

onUnmounted(() => {
    if (cooldownTimer) {
        clearTimeout(cooldownTimer)
    }
})
</script>

<style lang="scss" scoped>
.chat-panel {
    @include panel;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
}

.chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
}

.panel-title {
    @include serif-heading(1.25rem);
    margin-bottom: 1rem;

    &.no-margin {
        margin: 0;
    }
}

.active-language {
    @include active-language;
}

.chat-log {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    overflow-y: auto;
    padding: 0.5rem;
    background: rgba(black, 0.2);
    border: 1px solid $ash-grey;
    border-radius: 0.25rem;
    min-height: 0;
}

.chat-empty {
    @include flex-center;
    flex: 1;
    color: $silver-grey;
    font-style: italic;
    font-size: 0.9rem;
}

.chat-message {
    display: flex;
    gap: 0.5rem;
    font-size: 0.9rem;
    line-height: 1.3;
}

.chat-date-separator {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0.4rem 0;
    color: $mist-grey;
    font-size: 0.75rem;

    &::before,
    &::after {
        content: '';
        flex: 1;
        height: 1px;
        background: $ash-grey;
    }
}

.chat-timestamp {
    color: $mist-grey;
    font-size: 0.8rem;
    flex-shrink: 0;
}

.chat-author {
    color: $light-teal;
    font-weight: 500;
    font-family: serif;
    flex-shrink: 0;

    &::after {
        content: ' :';
    }
}

.chat-text {
    color: $pearl-grey;
    word-break: break-word;
}

.chat-disabled-note {
    @include list-item;
    @include flex-center;
    margin-top: 0.75rem;
    padding: 0.6rem;
    color: $silver-grey;
    font-style: italic;
    font-size: 0.9rem;
    border-radius: 0.25rem;
}

.chat-input-row {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.75rem;
}

.chat-input {
    @include input-base;
}

.chat-send-btn {
    @include button-purple;
    padding: 0.5rem 1.25rem;
}
</style>
