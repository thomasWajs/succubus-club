<template>
    <dialog
        ref="dialogRef"
        class="welcome-modal"
    >
        <div class="modal-content">
            <h2>Welcome Kindred !</h2>
            <p>We're thrilled to have you join our V:TES community.</p>
            <p>
                This is your first time here, would you like to learn more about what we offer here
                at the Succubus Club ?
            </p>
            <div class="modal-buttons">
                <button
                    class="about-button"
                    @click="goToAbout"
                >
                    Learn More
                </button>
                <button
                    class="close-button"
                    @click="closeModal"
                >
                    No Thanks
                </button>
            </div>
        </div>
    </dialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ROUTES } from '@/client/ui/router.ts'
import { screenBigEnough } from '@/client/game/display.ts'

const router = useRouter()
const dialogRef = ref<HTMLDialogElement | null>(null)

const LOCAL_STORAGE_KEY = 'succubus-club-visited'

function checkFirstVisit() {
    if (!screenBigEnough) {
        return
    }

    // Check if user has visited before
    const hasVisitedBefore = localStorage.getItem(LOCAL_STORAGE_KEY)

    if (!hasVisitedBefore) {
        dialogRef.value?.showModal()
    }
}

function markAsVisited() {
    localStorage.setItem(LOCAL_STORAGE_KEY, 'true')
    dialogRef.value?.close()
}

function goToAbout() {
    markAsVisited()
    router.push({ name: ROUTES.About })
}

function closeModal() {
    markAsVisited()
}

// Check for first visit when component mounts
onMounted(() => {
    checkFirstVisit()
})
</script>

<style lang="scss" scoped>
.welcome-modal {
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

.about-button {
    @include button-purple;
}

.close-button {
    @include button-dark-grey;
}
</style>
