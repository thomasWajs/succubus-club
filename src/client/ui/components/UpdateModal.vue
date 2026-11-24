<template>
    <!-- Not dismissable : an outdated client must reload, it can't play with the others. -->
    <dialog
        ref="dialogRef"
        class="update-modal"
        @cancel.prevent
    >
        <div class="modal-content">
            <h2>A New Version Is Available</h2>
            <p>Succubus Club has been updated since you opened this page.</p>
            <p>Please reload to get the latest version, and to continue.</p>
            <div class="modal-buttons">
                <button
                    class="refresh-button"
                    @click="refresh"
                >
                    Reload Now
                </button>
            </div>
        </div>
    </dialog>
</template>

<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { useBusStore } from '@/client/store/bus.ts'

const busStore = useBusStore()
const dialogRef = ref<HTMLDialogElement | null>(null)

function refresh() {
    window.location.reload()
}

// 'post' : the first run waits for the mount, so the dialog element exists even when
// the update is already required by then.
watchEffect(
    () => {
        if (busStore.updateRequired && !dialogRef.value?.open) {
            dialogRef.value?.showModal()
        }
    },
    { flush: 'post' },
)
</script>

<style lang="scss" scoped>
.update-modal {
    @include modal-dialog;
    max-width: 500px;
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

.modal-buttons {
    @include modal-actions;
}

.refresh-button {
    @include button-purple;
}
</style>
