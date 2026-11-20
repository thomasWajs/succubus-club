<template>
    <dialog
        ref="dialogRef"
        class="focus-mode-disclaimer-modal"
    >
        <div class="modal-content">
            <h2>Focus Mode</h2>
            <p>
                This mode keeps the active player on the center of the screen, with its prey on the
                left and its predator on the right.
            </p>
            <p>You can hit <strong>"Z"</strong> key when hovering a card to zoom in.</p>

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

const LOCAL_STORAGE_KEY = 'focus-mode-disclaimer-dismissed'

// Store the resolve function for the current promise
let currentResolve: VoidFunction | null = null

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
.focus-mode-disclaimer-modal {
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
    background: var(--ui-floating-bg);
    color: var(--ui-text-on-dark);
    padding: 2rem;
    text-align: center;
}

.modal-content h2 {
    color: light-dark($pearl-grey, $ui-text);
    margin-bottom: 1rem;
    font-size: 1.5rem;
}

.modal-content p {
    margin-bottom: 1rem;
    line-height: 1.5;
}

.modal-content strong {
    color: light-dark($pearl-grey, $ui-text);
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
    color: var(--ui-text-on-dark);
    cursor: pointer;
    font-size: 0.9rem;
}

.dont-show-again input[type='checkbox'] {
    appearance: none;
    width: 18px;
    height: 18px;
    border: 2px solid light-dark($pearl-grey, $ui-text-muted);
    background: transparent;
    cursor: pointer;
    position: relative;

    &:checked {
        background: light-dark($royal-purple, $ui-accent);
        border-color: light-dark($royal-purple, $ui-accent-light);
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
