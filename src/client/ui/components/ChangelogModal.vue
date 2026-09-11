<template>
    <dialog
        ref="dialogRef"
        class="changelog-modal"
    >
        <div class="modal-content">
            <h2>What's New in v{{ latestChangelog.version }}</h2>
            <p class="release-date">Released on {{ latestChangelog.date }}</p>

            <div class="changelog-content">
                <div
                    v-if="latestChangelog.features && latestChangelog.features.length > 0"
                    class="changelog-section"
                >
                    <div
                        v-for="(feature, index) in latestChangelog.features"
                        :key="'feature-' + index"
                        class="changelog-item"
                    >
                        <span class="changelog-type changelog-type-feature">Feature</span>
                        <span class="changelog-text">{{ feature }}</span>
                    </div>
                </div>

                <div
                    v-if="latestChangelog.bugfixes && latestChangelog.bugfixes.length > 0"
                    class="changelog-section"
                >
                    <div
                        v-for="(bugfix, index) in latestChangelog.bugfixes"
                        :key="'bugfix-' + index"
                        class="changelog-item"
                    >
                        <span class="changelog-type changelog-type-bugfix">Bugfix</span>
                        <span class="changelog-text">{{ bugfix }}</span>
                    </div>
                </div>
            </div>

            <div class="modal-footer">
                <a
                    href="https://github.com/thomasWajs/succubus-club/blob/master/CHANGELOG.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="changelog-link"
                >
                    Full changelog at GitHub →
                </a>
                <button
                    class="close-button"
                    @click="closeModal"
                >
                    Got it!
                </button>
            </div>
        </div>
    </dialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { latestChangelog } from '@/client/changelog.ts'

const dialogRef = ref<HTMLDialogElement | null>(null)

const LOCAL_STORAGE_KEY = 'succubus-club-changelog-version'
const WELCOME_MODAL_KEY = 'succubus-club-visited'

function checkAndShowChangelog() {
    if (!latestChangelog.version) {
        return
    }

    // Don't show changelog if WelcomeModal will be shown (first visit)
    const hasVisitedBefore = localStorage.getItem(WELCOME_MODAL_KEY)
    if (!hasVisitedBefore) {
        localStorage.setItem(LOCAL_STORAGE_KEY, latestChangelog.version)
        return
    }

    // Get the last seen version from localStorage
    const lastSeenVersion = localStorage.getItem(LOCAL_STORAGE_KEY)

    // Show modal if this is a new version
    if (lastSeenVersion !== latestChangelog.version) {
        dialogRef.value?.showModal()
    }
}

function closeModal() {
    // Save the current version as seen
    localStorage.setItem(LOCAL_STORAGE_KEY, latestChangelog.version)
    dialogRef.value?.close()
}

// Check for new changelog when component mounts
onMounted(() => {
    checkAndShowChangelog()
})
</script>

<style lang="scss" scoped>
.changelog-modal {
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
    background: $ash-grey;
    color: $ghost-white;
    padding: 1rem;
}

.modal-content h2 {
    color: $pearl-grey;
    margin: 1rem 0;
    font-size: 1.5rem;
    text-align: center;
}

.release-date {
    text-align: center;
    color: $pearl-grey;
    font-size: 0.9rem;
    margin-bottom: 1.5rem;
    opacity: 0.8;
}

.changelog-content {
    max-height: 400px;
    overflow-y: auto;
}

.changelog-section {
    margin-bottom: 1rem;
}

.changelog-item {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
    line-height: 1.5;
    align-items: flex-start;
}

.changelog-type {
    width: 50px;
    font-weight: bold;
    text-transform: uppercase;
    text-align: center;
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    white-space: nowrap;
    flex-shrink: 0;
}

.changelog-type-feature {
    color: $silver-grey;
    background: $royal-purple;
}

.changelog-type-bugfix {
    color: $vibrant-emerald;
    background: $dark-forest;
}

.changelog-text {
    flex: 1;
}

.modal-footer {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: center;
    padding-top: 1rem;
    border-top: 1px solid rgba($pearl-grey, 0.2);
}

.changelog-link {
    color: $pearl-grey;
    text-decoration: none;
    font-size: 0.9rem;
    transition: color 0.2s;

    &:hover {
        color: $ghost-white;
    }
}

.close-button {
    @include button-purple;
}
</style>
