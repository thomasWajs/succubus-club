<template>
    <div class="chat-panel">
        <div
            v-if="title || $slots['title-actions']"
            class="chat-header"
        >
            <h3
                v-if="title"
                class="panel-title no-margin"
            >
                {{ title }}
            </h3>
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
            <div
                v-for="(message, index) in messages"
                :key="index"
                class="chat-message"
            >
                <span class="chat-author">{{ message.authorName }}</span>
                <span class="chat-text">{{ message.text }}</span>
            </div>
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
import { nextTick, onUnmounted, ref, watch } from 'vue'

// A minimal chat entry : the component only needs the author name and the text.
// Callers can pass richer objects ( e.g. history log entries ), which are compatible.
interface ChatEntry {
    authorName: string
    text: string
}

const props = defineProps<{
    title?: string
    messages: ChatEntry[]
    disabled?: boolean
    disabledMessage?: string
    // When set, the send button is disabled for this many ms after each send, to
    // mirror a server-side rate limit ( used by the lobby chat ).
    cooldownMs?: number
}>()

const emit = defineEmits<{
    send: [text: string]
}>()

const draft = ref('')
const logEl = ref<HTMLElement | null>(null)
const onCooldown = ref(false)
let cooldownTimer: ReturnType<typeof setTimeout> | null = null

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
@use '../../styles/base' as *;

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
    margin: 0 0 1rem 0;
    font-size: 1.25rem;
    font-weight: 300;
    font-family: serif;
    letter-spacing: 0.5px;

    &.no-margin {
        margin: 0;
    }
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
    @include flex-center;
    margin-top: 0.75rem;
    padding: 0.6rem;
    color: $silver-grey;
    font-style: italic;
    font-size: 0.9rem;
    background: rgba(black, 0.2);
    border: 1px solid $ash-grey;
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
