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
                    <div
                        v-for="preference in preferences"
                        :key="preference.key"
                        class="preference"
                    >
                        <!-- Checkbox Preference -->
                        <label
                            v-if="preference.type === UserPreferenceType.Checkbox"
                            class="checkbox-label"
                        >
                            <input
                                v-model="(preference as CheckboxPreference).value.value"
                                type="checkbox"
                            />
                            <span class="input-label preference-label">{{ preference.label }}</span>
                            <span
                                v-if="savedFeedbacks.preferences[preference.key]"
                                class="save-feedback success"
                            >
                                ✓ Saved
                            </span>
                        </label>

                        <!-- Select Preference -->
                        <div v-else-if="preference.type === UserPreferenceType.Select">
                            <div class="label-container">
                                <div class="input-label preference-label">
                                    {{ preference.label }}
                                </div>
                                <div
                                    v-if="savedFeedbacks.preferences[preference.key]"
                                    class="save-feedback success"
                                >
                                    ✓ Saved
                                </div>
                            </div>

                            <select
                                v-model="(preference as SelectPreference).value.value"
                                class="preference-select"
                            >
                                <option
                                    v-for="option in (preference as SelectPreference).options"
                                    :key="option.value"
                                    :value="option.value"
                                >
                                    {{ option.label }}
                                </option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Key bindings Tab -->
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

                <!-- Tabletop Background Tab -->
                <div
                    v-if="activeTab === 'tabletopBackground'"
                    class="tab-content"
                >
                    <div class="background-panel">
                        <div class="label-container">
                            <div class="input-label preference-label">
                                Customize tabletop background :
                            </div>
                            <div
                                v-if="savedFeedbacks.tabletopBackground.image"
                                class="save-feedback success"
                            >
                                ✓ Saved
                            </div>
                        </div>

                        <div
                            class="background-dropzone"
                            :class="{ 'drag-over': isDraggingBackground }"
                            :style="{ backgroundImage: `url(${tabletopBackgroundUrl})` }"
                            @click="triggerBackgroundUpload"
                            @dragover.prevent="isDraggingBackground = true"
                            @dragleave.prevent="isDraggingBackground = false"
                            @drop.prevent="handleBackgroundDrop"
                        >
                            <div class="background-dropzone-overlay">
                                <span>Click or drop an image here</span>
                            </div>
                        </div>

                        <!-- Hidden file input -->
                        <input
                            ref="backgroundInput"
                            type="file"
                            accept="image/*"
                            style="display: none"
                            @change="handleBackgroundFileInput"
                        />

                        <div class="input-label builtin-label">Built-in backgrounds</div>
                        <div class="builtin-backgrounds">
                            <button
                                v-for="name in BUILTIN_BACKGROUNDS"
                                :key="name"
                                class="builtin-thumbnail"
                                :class="{ active: activeBuiltinBackground === name }"
                                :style="{ backgroundImage: `url(${builtinBackgroundUrl(name)})` }"
                                :title="name"
                                @click="selectBuiltinBackground(name)"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </TopPanel>
</template>

<script setup lang="ts">
import TopPanel from '@/client/ui/components/TopPanel.vue'
import { useBusStore } from '@/client/store/bus.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { computed, ref } from 'vue'
import UserAvatar from '@/client/ui/components/UserAvatar.vue'
import { storeAvatar } from '@/client/gateway/user.ts'
import { DbUserProfile, UserPreferences, WorldAlignment } from '@/client/gateway/db.ts'
import { updateCommands, useCommands } from '@/client/game/composables/useCommands.ts'
import { setupKeyboardHandlers } from '@/client/game/input.ts'
import {
    activeBuiltinBackground,
    BUILTIN_BACKGROUNDS,
    BuiltinBackground,
    builtinBackgroundUrl,
    setBuiltinBackground,
    setTabletopBackground,
    tabletopBackgroundUrl,
} from '@/client/gateway/background.ts'

const core = useCoreStore()
const bus = useBusStore()

/** Tab Management **/

const activeTab = ref('userProfile')

const tabs = [
    { id: 'userProfile', title: 'User Profile' },
    { id: 'preferences', title: 'Preferences' },
    { id: 'keyBindings', title: 'Keyboard bindings' },
    { id: 'tabletopBackground', title: 'Tabletop background' },
]

/** Save Feedbacks **/

const savedFeedbacks = ref({
    userProfile: {} as Record<string, boolean>,
    preferences: {} as Record<string, boolean>,
    keyBindings: {} as Record<string, boolean>,
    tabletopBackground: {} as Record<string, boolean>,
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

/** Tabletop Background **/

const backgroundInput = ref<HTMLInputElement | null>(null)
const isDraggingBackground = ref(false)

function triggerBackgroundUpload() {
    backgroundInput.value?.click()
}

async function applyBackgroundFile(file: File | null | undefined) {
    if (!file || !file.type.startsWith('image/')) {
        return
    }
    await setTabletopBackground(file)
    showSaveFeedback('tabletopBackground', 'image')
}

async function handleBackgroundFileInput(event: Event) {
    const target = event.target as HTMLInputElement
    await applyBackgroundFile(target.files?.[0])
    // Reset so selecting the same file again still triggers a change event
    target.value = ''
}

async function handleBackgroundDrop(event: DragEvent) {
    isDraggingBackground.value = false
    await applyBackgroundFile(event.dataTransfer?.files?.[0])
}

async function selectBuiltinBackground(name: BuiltinBackground) {
    await setBuiltinBackground(name)
    showSaveFeedback('tabletopBackground', 'image')
}

/** Preferences **/

type PreferenceKey = keyof Omit<UserPreferences, 'keyBindings'>

enum UserPreferenceType {
    Checkbox = 'Checkbox',
    Select = 'Select',
}

interface BasePreference {
    type: UserPreferenceType
    key: PreferenceKey
    label: string
}

interface CheckboxPreference extends BasePreference {
    type: UserPreferenceType.Checkbox
    value: ReturnType<typeof computed<boolean>>
}

interface SelectPreference extends BasePreference {
    type: UserPreferenceType.Select
    options: Array<{ value: string; label: string }>
    value: ReturnType<typeof computed<string>>
}

type Preference = CheckboxPreference | SelectPreference

function createCheckboxPreference(key: PreferenceKey, label: string): CheckboxPreference {
    return {
        type: UserPreferenceType.Checkbox,
        key,
        label,
        value: computed({
            get: () => (core.userProfile.preferences[key] ?? 1) === 1,
            set: async (value: boolean) => {
                core.userProfile.preferences[key] = (value ? 1 : 0) as any
                await core.userProfile.save()
                showSaveFeedback('preferences', key)
            },
        }),
    }
}

function createSelectPreference(
    key: PreferenceKey,
    label: string,
    options: Array<{ value: string; label: string }>,
): SelectPreference {
    return {
        type: UserPreferenceType.Select,
        key,
        label,
        options,
        value: computed({
            get: () => (core.userProfile.preferences[key] as string) ?? options[0].value,
            set: async (value: string) => {
                core.userProfile.preferences[key] = value as any
                await core.userProfile.save()
                showSaveFeedback('preferences', key)
            },
        }),
    }
}

const preferences: Preference[] = [
    createSelectPreference('worldAlignment', 'Tabletop Alignment', [
        { value: WorldAlignment.Center, label: 'Center' },
        { value: WorldAlignment.TopRight, label: 'Top Right' },
    ]),
    createCheckboxPreference('glowInHand', 'Highlight playable cards in hand'),
    createCheckboxPreference('glowInPlay', 'Highlight cards in play with a "during X do Y" effect'),
    createCheckboxPreference('alignmentGuides', 'Show alignment guides'),
    createCheckboxPreference('cardGrouping', 'Enable card grouping'),
    createCheckboxPreference('actionDeclaration', 'Enable action declaration'),
    createCheckboxPreference('turnNotification', 'Show new turn notification'),
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
    max-width: 550px;
    padding-bottom: 20px;
    margin-bottom: 20px;
    border-bottom: 1px solid $bone-grey;
}

.preference-label {
    font-size: 17px;
}

.preference-select {
    min-width: 150px;
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

/** Tabletop Background **/

.background-panel {
    max-width: 550px;
}

.background-dropzone {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    border: 2px dashed $bone-grey;
    border-radius: 6px;
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    cursor: pointer;
    overflow: hidden;
    transition: border-color 0.15s ease;

    &:hover,
    &.drag-over {
        border-color: $vibrant-emerald;
    }
}

.background-dropzone-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 1rem;
    color: #fff;
    background-color: rgba($shadow-grey, 0.55);
    opacity: 0;
    transition: opacity 0.15s ease;

    .background-dropzone:hover &,
    .background-dropzone.drag-over & {
        opacity: 1;
    }
}

.builtin-label {
    display: block;
    margin-top: 20px;
    margin-bottom: 8px;
}

.builtin-backgrounds {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

.builtin-thumbnail {
    width: 80px;
    height: 45px;
    padding: 0;
    border: 2px solid $bone-grey;
    border-radius: 4px;
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    cursor: pointer;
    transition:
        border-color 0.15s ease,
        transform 0.15s ease;

    &:hover {
        transform: scale(1.05);
        border-color: $vibrant-emerald;
    }

    &.active {
        border-color: $vibrant-emerald;
        box-shadow: 0 0 0 2px rgba($vibrant-emerald, 0.4);
    }
}
</style>
