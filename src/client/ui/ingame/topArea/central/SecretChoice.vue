<template>
    <CentralPanel
        title="Secret Choice"
        @pointerdown.stop
        @pointerup.stop
        @pointermove.stop
        @click.stop
        @keydown.stop
        @keyup.stop
    >
        <div class="secret-interface">
            <input
                v-model="secretInput"
                class="secret-input"
                type="text"
                placeholder="Type your secret..."
                @keyup.enter="validateSecret"
            />

            <div class="secret-buttons">
                <button
                    class="game-button"
                    :disabled="!secretInput.trim()"
                    @click="validateSecret"
                >
                    Validate
                </button>
                <button
                    class="game-button"
                    :disabled="storedSecret === null"
                    @click="revealSecret"
                >
                    Reveal
                </button>
                <button
                    class="game-button is-danger"
                    @click="$emit('close')"
                >
                    Close
                </button>
            </div>

            <span
                class="secret-status"
                :class="{ visible: storedSecret !== null }"
            >
                Secret locked in, waiting to reveal.
            </span>
        </div>
    </CentralPanel>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import CentralPanel from '@/client/ui/ingame/topArea/central/CentralPanel.vue'

defineEmits<{
    (e: 'close'): void
}>()

/**
 * Secret Choice
 *
 * Let a player secretly type a choice, lock it in, then reveal it to everyone
 * at once ( like a bid or rock/paper/scissor ). The secret is kept locally
 * until revealed. This is not cheat-proof in SCS mode, but that's acceptable.
 */

const secretInput = ref('')
const storedSecret = ref<string | null>(null)

function validateSecret() {
    const value = secretInput.value.trim()
    if (!value) {
        return
    }
    storedSecret.value = value
    gameMutations.secretAnnounce.actSelf({})
}

function revealSecret() {
    if (storedSecret.value === null) {
        return
    }
    gameMutations.secretReveal.actSelf({ secret: storedSecret.value })
    secretInput.value = ''
    storedSecret.value = null
}
</script>

<style lang="scss">
.secret-interface {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
    min-width: 260px;

    .secret-input {
        padding: 5px 6px;
        font-size: 14px;
        border: solid 1px $shadow-grey;
        background: white;
        color: black;
    }

    .secret-buttons {
        display: flex;
        justify-content: center;
        gap: 0.5rem;

        .game-button {
            padding: 0.25rem 1rem;
        }
    }

    .secret-status {
        text-align: center;
        font-size: 12px;
        font-style: italic;
        color: $shadow-grey;
        // Always reserve the space so the input/buttons don't move when it appears
        visibility: hidden;

        &.visible {
            visibility: visible;
        }
    }
}
</style>
