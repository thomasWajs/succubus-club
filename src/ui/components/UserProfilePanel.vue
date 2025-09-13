<template>
    <TopPanel
        :isOpen="bus.isUserProfilePanelOpen"
        @close="bus.isUserProfilePanelOpen = false"
    >
        <template #title> User Profile </template>

        <div class="user-profile">
            <div class="avatar-section">
                <UserAvatar
                    :avatar="core.userProfile.avatar"
                    :playerName="core.userProfile.playerName"
                    width="120px"
                    height="120px"
                    fontSize="16px"
                    :canEdit="true"
                    @click="triggerFileUpload"
                />

                <!-- Hidden file input -->
                <input
                    ref="fileInput"
                    type="file"
                    accept="image/*"
                    style="display: none"
                    @change="handleFileUpload"
                />
            </div>

            <div class="label-container">
                <div class="input-label">My username</div>
                <div
                    v-if="showPlayerNameSaveSuccess"
                    class="save-feedback success"
                >
                    ✓ Saved
                </div>
            </div>
            <div class="username-input-container">
                <input
                    class="username-input"
                    :value="core.userProfile.playerName"
                    @input="updatePlayerName"
                />
            </div>
        </div>
    </TopPanel>
</template>

<script setup lang="ts">
import TopPanel from './TopPanel.vue'
import { useBusStore } from '@/store/bus.ts'
import { useCoreStore } from '@/store/core.ts'
import { ref } from 'vue'
import UserAvatar from '@/ui/components/UserAvatar.vue'

const core = useCoreStore()
const bus = useBusStore()

const showPlayerNameSaveSuccess = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function updatePlayerName(event: Event) {
    const target = event.target as HTMLInputElement
    core.userProfile.playerName = target.value
    core.userProfile.save()

    // Show success feedback
    showPlayerNameSaveSuccess.value = true
    setTimeout(() => {
        showPlayerNameSaveSuccess.value = false
    }, 2000) // Hide after 2 seconds
}

function triggerFileUpload() {
    fileInput.value?.click()
}

function handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement
    const file = target.files?.[0]

    if (file) {
        const reader = new FileReader()
        reader.onload = e => {
            const img = new Image()
            img.onload = () => {
                // Create canvas to resize the image
                const canvas = document.createElement('canvas')
                const ctx = canvas.getContext('2d')

                if (ctx) {
                    // Set canvas size to 120x120
                    canvas.width = 120
                    canvas.height = 120

                    // Draw and resize image to fit 120x120 (cover behavior)
                    const { sx, sy, sw, sh } = calculateCropDimensions(
                        img.width,
                        img.height,
                        120,
                        120,
                    )
                    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 120, 120)

                    // Convert to data URL with good quality
                    core.userProfile.avatar = canvas.toDataURL('image/jpeg', 0.85)
                    core.userProfile.save()
                }
            }
            img.src = e.target?.result as string
        }
        reader.readAsDataURL(file)
    }
}

// Helper function to calculate crop dimensions for object-fit: cover behavior
function calculateCropDimensions(
    imgWidth: number,
    imgHeight: number,
    targetWidth: number,
    targetHeight: number,
) {
    const imgAspect = imgWidth / imgHeight
    const targetAspect = targetWidth / targetHeight

    let sx = 0,
        sy = 0,
        sw = imgWidth,
        sh = imgHeight

    if (imgAspect > targetAspect) {
        // Image is wider than target - crop sides
        sw = imgHeight * targetAspect
        sx = (imgWidth - sw) / 2
    } else {
        // Image is taller than target - crop top/bottom
        sh = imgWidth / targetAspect
        sy = (imgHeight - sh) / 2
    }

    return { sx, sy, sw, sh }
}
</script>

<style lang="scss" scoped>
.user-profile {
    margin: auto;
    max-width: 400px;
}

.avatar-section {
    display: flex;
    justify-content: center;
    margin-bottom: 24px;
}

.label-container {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
}

.username-input-container {
    width: 100%;
    position: relative;
    display: inline-block;
}

.username-input {
    @include input-base;
    width: 100%;
}

.save-feedback {
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 4px;
    transition: opacity 0.3s ease;
    white-space: nowrap;

    &.success {
        color: $vibrant-emerald;
        background-color: rgba($vibrant-emerald, 0.2);
    }
}
</style>
