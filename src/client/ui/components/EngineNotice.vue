<template>
    <dialog
        ref="dialogRef"
        class="engine-notice-modal"
        @close="onClose"
    >
        <div class="modal-content">
            <h2>Playing against the rules engine</h2>
            <p>
                The game runs on the zero-vtes engine, at <strong>engine.krcg.org</strong> : it
                enforces the rules and plays the bots. Your moves on the table are read as its
                decisions ; what the table can't express is offered in the central box.
            </p>
            <p>
                Every game is <strong>recorded, anonymously, and kept for 2 years</strong>, to train
                and test the engine : the decks and every decision, without your name.
            </p>
            <p>
                Something wrong, or an idea ? Tell us on
                <a
                    href="https://github.com/lionel-panhaleux/succubus-club/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    >GitHub</a
                >.
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
                    @click="dialogRef?.close()"
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

let currentResolve: VoidFunction | null = null

// Escape closes a modal dialog without the button: resolve on close, or the game never starts
function onClose() {
    if (dontShowAgain.value) {
        localStorage.setItem(LOCAL_STORAGE_KEY, 'true')
    }
    currentResolve?.()
    currentResolve = null
}

defineExpose({
    showNotice: (): Promise<void> => {
        return new Promise<void>(resolve => {
            if (localStorage.getItem(LOCAL_STORAGE_KEY)) {
                resolve()
                return
            }
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

.modal-content a {
    color: $pearl-grey;
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
