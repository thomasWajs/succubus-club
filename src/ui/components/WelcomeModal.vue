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
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ROUTES } from '@/ui/router.ts'

const router = useRouter()
const dialogRef = ref<HTMLDialogElement | null>(null)

const LOCAL_STORAGE_KEY = 'succubus-club-visited'

function checkFirstVisit() {
    // Check if feature is disabled via environment variable
    if (import.meta.env.VITE_DISABLE_WELCOME_MODAL) {
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

.about-button {
    @include button-purple;
}

.close-button {
    @include button-dark-grey;
}
</style>
