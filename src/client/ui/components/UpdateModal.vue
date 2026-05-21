<template>
    <dialog
        ref="dialogRef"
        class="update-modal"
    >
        <div class="modal-content">
            <h2>A New Version Is Available</h2>
            <p>The Succubus Club has been updated since you opened this page.</p>
            <p>Please refresh to get the latest version.</p>
            <div class="modal-buttons">
                <button
                    class="refresh-button"
                    @click="refresh"
                >
                    Refresh Now
                </button>
                <button
                    class="close-button"
                    @click="closeModal"
                >
                    Later
                </button>
            </div>
        </div>
    </dialog>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useBusStore } from '@/client/store/bus.ts'

const busStore = useBusStore()
const { updateAvailable } = storeToRefs(busStore)
const dialogRef = ref<HTMLDialogElement | null>(null)

function refresh() {
    window.location.reload()
}

function closeModal() {
    busStore.updateAvailable = false
    dialogRef.value?.close()
}

watch(updateAvailable, available => {
    if (available && !dialogRef.value?.open) {
        dialogRef.value?.showModal()
    }
})

onMounted(() => {
    if (busStore.updateAvailable) {
        dialogRef.value?.showModal()
    }
})
</script>

<style lang="scss" scoped>
.update-modal {
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

.refresh-button {
    @include button-purple;
}

.close-button {
    @include button-dark-grey;
}
</style>
