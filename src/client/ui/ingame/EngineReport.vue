<template>
    <!-- Keys typed here are the report's, not the table's commands ( Space passes ) -->
    <dialog
        ref="dialogRef"
        class="engine-report-modal"
        @keydown.stop
        @keyup.stop
    >
        <div class="modal-content">
            <h2>Report a problem</h2>
            <p>
                Something wrong, or an idea ? What you write is kept with this game's record, at the
                decision under way, for the engine's authors. To talk it over, open an issue on
                <a
                    href="https://github.com/lionel-panhaleux/succubus-club/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    >GitHub</a
                >.
            </p>
            <textarea
                v-model="text"
                class="report-text"
                :maxlength="MAX_CHARS"
                :disabled="sending"
                placeholder="What happened, and what you expected..."
            />
            <div class="report-status">
                <span
                    v-if="status"
                    :class="{ alert: failed }"
                    >{{ status }}</span
                >
                <span class="report-count">{{ text.length }} / {{ MAX_CHARS }}</span>
            </div>

            <div class="modal-actions">
                <button
                    class="close-button"
                    @click="dialogRef?.close()"
                >
                    Close
                </button>
                <button
                    class="send-button"
                    :disabled="sending || !text.trim()"
                    @click="send"
                >
                    Send
                </button>
            </div>
        </div>
    </dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { engineFeedback } from '@/client/engine/driver.ts'

// The server's cap ( docs/protocol.md of zero-vtes : `feedback` )
const MAX_CHARS = 4000

const dialogRef = ref<HTMLDialogElement | null>(null)
const text = ref('')
const sending = ref(false)
const status = ref('')
const failed = ref(false)

// Kept until sent : a report that fails is sent again as it is
async function send() {
    sending.value = true
    status.value = 'Sending...'
    failed.value = false
    try {
        const noted = await engineFeedback(text.value.trim())
        if (noted == null) {
            throw new Error('No game under way')
        }
        text.value = ''
        status.value = 'Sent, thank you.'
    } catch (e) {
        failed.value = true
        status.value = `Not sent : ${e instanceof Error ? e.message : e}. Try again.`
    } finally {
        sending.value = false
    }
}

defineExpose({
    show: () => {
        if (!sending.value) {
            status.value = ''
            failed.value = false
        }
        dialogRef.value?.showModal()
    },
})
</script>

<style lang="scss" scoped>
.engine-report-modal {
    @include modal-dialog;
    max-width: 600px;
    width: 90%;
}

.modal-content {
    @include modal-content;
    color: $ghost-white;
}

.modal-content h2 {
    @include modal-title;
    text-align: center;
}

.modal-content p {
    margin-bottom: 1rem;
    line-height: 1.5;
}

.modal-content a {
    color: $pearl-grey;
}

.report-text {
    @include input-base;
    min-height: 10rem;
    resize: vertical;
    font-family: inherit;
}

.report-status {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 0.5rem;
    min-height: 1.2rem;
    font-size: 0.9rem;

    .alert {
        color: $status-amber;
    }

    .report-count {
        margin-left: auto;
        color: $silver-grey;
    }
}

.modal-actions {
    @include modal-actions;
}

.close-button {
    @include button-grey;
}

.send-button {
    @include button-purple;
}
</style>
