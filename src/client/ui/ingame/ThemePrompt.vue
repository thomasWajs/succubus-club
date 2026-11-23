<template>
    <dialog
        ref="dialogRef"
        class="theme-prompt-modal"
    >
        <div class="modal-content">
            <h2>New dark mode</h2>
            <p>The in-game interface now has a dark mode, the new default for new players.</p>
            <p>
                Do you want to switch to it? Its dark tabletop background replaces your current one.
            </p>
            <p class="hint">You can change both at any time in your profile preferences.</p>

            <div class="modal-footer">
                <button
                    class="light-button"
                    @click="answer(false)"
                >
                    Keep light mode
                </button>
                <button
                    class="dark-button"
                    @click="answer(true)"
                >
                    Switch to dark mode
                </button>
            </div>
        </div>
    </dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { answerThemePrompt } from '@/client/gateway/themePrompt.ts'

const dialogRef = ref<HTMLDialogElement | null>(null)

async function answer(dark: boolean) {
    dialogRef.value?.close()
    await answerThemePrompt(dark)
}

// Closed with Escape : no answer, offered again with the next game
defineExpose({
    show: () => dialogRef.value?.showModal(),
})
</script>

<style lang="scss" scoped>
.theme-prompt-modal {
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

.hint {
    font-size: 0.9rem;
    opacity: 0.8;
}

.modal-footer {
    display: flex;
    justify-content: center;
    margin-top: 1.5rem;
    gap: 1rem;
}

.light-button {
    @include button-grey;
}

.dark-button {
    @include button-purple;
}
</style>
