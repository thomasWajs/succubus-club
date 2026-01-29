<template>
    <dialog
        ref="dialogRef"
        class="train-bot-disclaimer-modal"
    >
        <div class="modal-content">
            <h2>Training Bot Disclaimer</h2>
            <p>The training bot is currently in development and not ready for full use yet.</p>
            <p>
                Please note that <strong>combat mechanics are not handled</strong> and other logic
                are incomplete or missing.
            </p>
            <p>Use this training mode to practice basic game mechanics and deck building only.</p>

            <div class="modal-footer">
                <label class="dont-show-again">
                    <input
                        v-model="dontShowAgain"
                        type="checkbox"
                    />
                    Don't show again
                </label>

                <button
                    class="understood-button"
                    @click="closeModal"
                >
                    Understood
                </button>
            </div>
        </div>
    </dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const dialogRef = ref<HTMLDialogElement | null>(null)
const dontShowAgain = ref(false)

const LOCAL_STORAGE_KEY = 'train-bot-disclaimer-dismissed'

// Store the resolve function for the current promise
let currentResolve: (() => void) | null = null

function checkShouldShowDisclaimer(): boolean {
    // Check if user has dismissed the disclaimer before
    const hasDismissedBefore = localStorage.getItem(LOCAL_STORAGE_KEY)
    return !hasDismissedBefore
}

function closeModal() {
    if (dontShowAgain.value) {
        localStorage.setItem(LOCAL_STORAGE_KEY, 'true')
    }

    dialogRef.value?.close()

    // Resolve the promise if there's one waiting
    if (currentResolve) {
        currentResolve()
        currentResolve = null
    }
}

// Export function that returns a Promise
defineExpose({
    showDisclaimer: (): Promise<void> => {
        return new Promise<void>(resolve => {
            if (!checkShouldShowDisclaimer()) {
                // If disclaimer was already dismissed, resolve immediately
                resolve()
                return
            }

            // Store the resolve function and show the modal
            currentResolve = resolve
            dialogRef.value?.showModal()
        })
    },
})
</script>

<style lang="scss" scoped>
.train-bot-disclaimer-modal {
    border: none;
    padding: 0;
    max-width: 600px;
    width: 90%;
    z-index: 1200;

    &::backdrop {
        background: rgba(0, 0, 0, 0.8);
    }
}

.modal-content {
    background: $ash-grey;
    color: $ghost-white;
    padding: 2rem;
    text-align: center;
}

.modal-content h2 {
    color: $pearl-grey;
    margin-bottom: 1rem;
    font-size: 1.5rem;
}

.modal-content p {
    margin-bottom: 1rem;
    line-height: 1.5;
}

.modal-content strong {
    color: $pearl-grey;
    font-weight: bold;
}

.modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 1.5rem;
    gap: 1rem;
}

.dont-show-again {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: $ghost-white;
    cursor: pointer;
    font-size: 0.9rem;
}

.dont-show-again input[type='checkbox'] {
    appearance: none;
    width: 18px;
    height: 18px;
    border: 2px solid $pearl-grey;
    background: transparent;
    cursor: pointer;
    position: relative;

    &:checked {
        background: $royal-purple;
        border-color: $royal-purple;
    }

    &:checked::after {
        content: '✓';
        position: absolute;
        top: -2px;
        left: 2px;
        color: white;
        font-size: 14px;
        font-weight: bold;
    }
}

.understood-button {
    @include button-purple;
}
</style>
