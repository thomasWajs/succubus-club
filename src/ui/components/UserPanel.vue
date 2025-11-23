<template>
    <TopPanel
        :isOpen="bus.isUserProfilePanelOpen"
        @close="bus.isUserProfilePanelOpen = false"
    >
        <template #title> User </template>

        <div class="user-panel-content">
            <div class="tabs-section">
                <div class="tab-buttons">
                    <button
                        v-for="tab in tabs"
                        :key="tab.id"
                        :class="['tab-btn', { active: activeTab === tab.id }]"
                        @click="activeTab = tab.id"
                    >
                        {{ tab.title }}
                    </button>
                </div>
            </div>

            <div class="tab-content-section">
                <!-- User Profile Tab -->
                <div
                    v-if="activeTab === 'userProfile'"
                    class="tab-content"
                >
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
                                v-if="savedFeedbacks.userProfile.playerName"
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
                </div>

                <!-- Preferences Tab -->
                <div
                    v-if="activeTab === 'preferences'"
                    class="tab-content"
                >
                    <label
                        v-for="preference in preferences"
                        :key="preference.key"
                        class="preference"
                    >
                        <input
                            v-model="preference.value.value"
                            type="checkbox"
                        />
                        <span class="preference-label">{{ preference.label }}</span>
                        <span
                            v-if="savedFeedbacks.preferences[preference.key]"
                            class="save-feedback success"
                        >
                            ✓ Saved
                        </span>
                    </label>
                </div>

                <!-- User Profile Tab -->
                <div
                    v-if="activeTab === 'keyBindings'"
                    class="tab-content"
                >
                    <div class="key-binding-list">
                        <div class="key-binding-header">
                            <span>Default</span>
                            <span>Custom</span>
                        </div>

                        <div
                            v-for="keyBinding in assignableKeyBindings"
                            :key="keyBinding.name"
                            class="key-binding-item"
                        >
                            <div class="key-binding-label">
                                {{ keyBinding.label }}
                            </div>

                            <div class="key-binding-key">
                                <kbd>{{ keyBinding.defaultRepr }}</kbd>
                                <input
                                    class="input-field"
                                    :value="
                                        core.userProfile.preferences.keyBindings?.[keyBinding.name]
                                            ?.repr ?? ''
                                    "
                                    maxlength="1"
                                    @keydown="handleShortcutKeydown($event, keyBinding.name)"
                                    @paste.prevent
                                />
                            </div>

                            <span class="feedback-wrapper">
                                <span
                                    v-if="conflictingKeyBindings[keyBinding.name]"
                                    class="save-feedback alert"
                                >
                                    ☓ Conflict
                                </span>

                                <span
                                    v-if="savedFeedbacks.keyBindings[keyBinding.name]"
                                    class="save-feedback success"
                                >
                                    ✓ Saved
                                </span>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </TopPanel>
</template>

<script setup lang="ts">
import TopPanel from './TopPanel.vue'
import { useBusStore } from '@/store/bus.ts'
import { useCoreStore } from '@/store/core.ts'
import { ref, computed } from 'vue'
import UserAvatar from '@/ui/components/UserAvatar.vue'
import { storeAvatar } from '@/gateway/user.ts'
import { DbUserProfile, UserPreferences } from '@/gateway/db.ts'
import { updateCommands, useCommands } from '@/game/composables/useCommands.ts'
import { setupKeyboardHandlers } from '@/game/input.ts'

const core = useCoreStore()
const bus = useBusStore()

/** Tab Management **/

const activeTab = ref('userProfile')

const tabs = [
    { id: 'userProfile', title: 'User Profile' },
    { id: 'preferences', title: 'Preferences' },
    { id: 'keyBindings', title: 'Keyboard bindings' },
]

/** Save Feedbacks **/

const savedFeedbacks = ref({
    userProfile: {} as Record<string, boolean>,
    preferences: {} as Record<string, boolean>,
    keyBindings: {} as Record<string, boolean>,
})

function showSaveFeedback(category: keyof typeof savedFeedbacks.value, name: string) {
    savedFeedbacks.value[category][name] = true
    setTimeout(() => {
        savedFeedbacks.value[category][name] = false
    }, 2000)
}

/** User Profile **/

const fileInput = ref<HTMLInputElement | null>(null)

function updatePlayerName(event: Event) {
    const target = event.target as HTMLInputElement
    core.userProfile.playerName = target.value
    core.userProfile.save()
    showSaveFeedback('userProfile', 'playerName')
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
            img.onload = async () => {
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
                    await core.userProfile.save()
                    await storeAvatar(core.userProfile as DbUserProfile)
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

/** Preferences **/

type PreferenceKey = keyof Omit<UserPreferences, 'keyBindings'>

function createPreference(key: PreferenceKey, label: string) {
    return {
        key,
        label,
        value: computed({
            get: () => (core.userProfile.preferences[key] ?? 1) === 1,
            set: async (value: boolean) => {
                core.userProfile.preferences[key] = value ? 1 : 0
                await core.userProfile.save()
                showSaveFeedback('preferences', key)
            },
        }),
    }
}

const preferences = [
    createPreference('glow', 'Highlight usable cards'),
    createPreference('alignmentGuides', 'Use alignment guides'),
]

/** Keyboard shortcuts **/

const commands = useCommands()
const assignableKeyBindings = computed(() => {
    return Object.values(commands).filter(command => command.label)
})

// Track conflicting key bindings
const conflictingKeyBindings = computed(() => {
    const conflicts: Record<string, boolean> = {}
    const keyBindings = core.userProfile.preferences.keyBindings ?? {}

    // Create a map of key representations to command names
    const keyToCommands: Record<string, string[]> = {}

    // Check all assignable key bindings
    assignableKeyBindings.value.forEach(command => {
        // Use custom binding if exists, otherwise use default
        const customBinding = keyBindings[command.name]
        const key = customBinding ? customBinding.repr.toUpperCase() : command.repr.toUpperCase()

        if (!keyToCommands[key]) {
            keyToCommands[key] = []
        }
        keyToCommands[key].push(command.name)
    })

    // Mark commands that have conflicts
    Object.values(keyToCommands).forEach(commandNames => {
        if (commandNames.length > 1) {
            commandNames.forEach(name => {
                conflicts[name] = true
            })
        }
    })

    return conflicts
})

async function handleShortcutKeydown(event: KeyboardEvent, keyBindingName: string) {
    event.preventDefault()

    // Get the key that was pressed
    const key = event.key

    // Ignore modifier keys
    if (['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape'].includes(key)) {
        return
    }

    // keyBindings should always be initialized by useCommands()
    const keyBindings = core.userProfile.preferences.keyBindings ?? {}

    // Handle backspace to remove the shortcut
    if (key === 'Backspace' || key == 'Delete') {
        delete keyBindings[keyBindingName]
    } else {
        keyBindings[keyBindingName] = {
            keyCode: event.keyCode,
            // Store the new key in uppercase
            repr: key.toUpperCase(),
        }
    }

    await core.userProfile.save()
    updateCommands()
    // update phaser key listeners if the game is started
    if (core.gameIsReady) {
        const scene = core.phaserGame.scene.getScene('Tabletop')
        if (scene) {
            setupKeyboardHandlers(scene)
        }
    }
    showSaveFeedback('keyBindings', keyBindingName)
}
</script>

<style lang="scss" scoped>
$max-width: 1200px;

.user-panel-content {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 2rem;
    max-width: $max-width;
    margin: 0 auto;
}

.save-feedback {
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;

    &.success {
        color: $vibrant-emerald;
        background-color: rgba($vibrant-emerald, 0.2);
    }

    &.alert {
        color: $warm-coral;
        background-color: rgba($warm-coral, 0.2);
    }
}

/** User Profile **/

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
    box-sizing: border-box;
}

.username-input {
    @include input-base;
    width: 100%;
    box-sizing: border-box;
}

/** Preferences **/

.preference {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px;
    margin-bottom: 8px;
    cursor: pointer;

    input {
        cursor: pointer;
    }
}

.preference-label {
    font-size: 20px;
}

/** Shortcuts **/

.key-binding-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 500px;
    margin: auto;
}

.key-binding-header {
    text-align: right;
    padding: 0.5rem 0.35rem;

    span:last-child {
        margin-left: 30px;
    }
}

.key-binding-item {
    @include list-item;
    padding: 0.5rem;
    position: relative;
    display: flex;
    align-items: center;
}

.key-binding-key {
    kbd {
        font-size: 20px;
    }

    input {
        font-size: 18px;
        padding: 0.25rem;
        width: 40px;
        text-transform: uppercase;
        text-align: center;
        margin-left: 50px;
    }
}

.feedback-wrapper {
    position: absolute;
    left: 100%;
    margin-left: 12px;
    display: flex;
    flex-direction: row;
    gap: 8px;
    align-items: center;
}
</style>
