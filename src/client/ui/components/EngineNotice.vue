<template>
    <dialog
        ref="dialogRef"
        class="engine-notice-modal"
    >
        <div class="modal-content">
            <h2>Playing against the rules engine</h2>
            <p>
                The game runs on the zero-vtes engine, at <strong>engine.krcg.org</strong> : it
                enforces the rules and plays the bots. Your moves on the table are read as its
                decisions ; what the table can't express is offered in the central box.
            </p>
            <p>
                Every game is <strong>recorded and kept for 2 years</strong>, to train and test the
                engine : the decks and every decision, without your name.
            </p>

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

const LOCAL_STORAGE_KEY = 'engine-notice-dismissed'

// Store the resolve function for the current promise
let currentResolve: VoidFunction | null = null

function checkShouldShowNotice(): boolean {
    // Check if user has dismissed the notice before
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
    showNotice: (): Promise<void> => {
        return new Promise<void>(resolve => {
            if (!checkShouldShowNotice()) {
                // If the notice was already dismissed, resolve immediately
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
.engine-notice-modal {
    @include modal-dialog;
    max-width: 600px;
    width: 90%;
}

.modal-content {
    @include modal-content;
    color: $ghost-white;
    text-align: center;
}

.modal-content h2 {
    @include modal-title;
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
    @include custom-checkbox;
}

.understood-button {
    @include button-purple;
}
</style>
