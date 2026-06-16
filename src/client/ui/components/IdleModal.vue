<template>
    <dialog
        ref="dialogRef"
        class="idle-modal"
    >
        <div class="modal-content">
            <h2>Still there, Kindred?</h2>
            <p>You've been idle for a while.</p>
            <p>You have been automatically disconnected from the game to save resources.</p>
            <div class="modal-buttons">
                <button
                    class="close-button"
                    @click="closeModal"
                >
                    Continue Playing
                </button>
            </div>
        </div>
    </dialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useBusStore } from '@/client/store/bus.ts'
import { checkServerVersion } from '@/client/versionCheck.ts'

const busStore = useBusStore()
const dialogRef = ref<HTMLDialogElement | null>(null)

function closeModal() {
    busStore.hasBeenIdle = false
    dialogRef.value?.close()
    checkServerVersion()
}

onMounted(() => {
    if (busStore.hasBeenIdle) {
        dialogRef.value?.showModal()
    }
})
</script>

<style lang="scss" scoped>
.idle-modal {
    border: none;
    padding: 0;
    max-width: 500px;
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

.modal-buttons {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin-top: 1.5rem;
}

.close-button {
    @include button-purple;
}
</style>
