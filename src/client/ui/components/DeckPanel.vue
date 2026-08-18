<template>
    <TopPanel
        :isOpen="bus.isDeckPanelOpen"
        @close="bus.isDeckPanelOpen = false"
        @open="onOpen"
    >
        <template #title>Deck Selection</template>

        <div class="deck-panel-content">
            <div class="current-deck">
                <span class="current-deck-label">Currently&nbsp;:&nbsp;</span>
                <span
                    class="current-deck-name"
                    :class="{ loading: isLoading, clickable: core.selfDeck }"
                    @click="viewDeck(core.selfDeck as DbDeck)"
                >
                    {{ isLoading ? 'Loading...' : (core.selfDeck?.name ?? 'None') }}
                </span>
            </div>

            <div
                v-if="errorMessage"
                class="error-message"
            >
                <span class="error-text">{{ errorMessage }}</span>
                <button
                    class="error-close-btn"
                    @click="clearError"
                >
                    ×
                </button>
            </div>

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
                <!-- History Tab -->
                <div
                    v-if="activeTab === 'history'"
                    class="tab-content"
                >
                    <div class="deck-list">
                        <div
                            v-if="deckHistory.length === 0"
                            class="no-items-message"
                        >
                            No deck history available.
                        </div>

                        <div
                            v-for="deck in deckHistory"
                            :key="deck.id"
                            class="deck-item"
                        >
                            <div class="deck-info-left">
                                <span class="source-badge">{{ deck.source }}</span>
                                <input
                                    v-if="editingDeckId === deck.id"
                                    ref="editInput"
                                    v-model="editingDeckName"
                                    class="deck-name-input"
                                    @keyup.enter="saveEdit(deck as DbDeck)"
                                    @keyup.escape="cancelEdit"
                                />

                                <span
                                    v-else
                                    class="deck-name clickable"
                                    @click="viewDeck(deck as DbDeck)"
                                >
                                    {{ deck.name }}
                                </span>
                            </div>
                            <div class="deck-actions">
                                <button
                                    v-if="editingDeckId === deck.id"
                                    class="action-btn ok-btn"
                                    @click="saveEdit(deck as DbDeck)"
                                >
                                    OK
                                </button>
                                <button
                                    v-else
                                    class="action-btn edit-btn"
                                    @click="startEdit(deck as DbDeck)"
                                >
                                    Edit name
                                </button>
                                <button
                                    class="action-btn load-btn"
                                    @click="loadFromHistory(deck as DbDeck)"
                                >
                                    Load
                                </button>
                                <button
                                    class="action-btn remove-btn"
                                    @click="removeFromHistory(deck as DbDeck)"
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- VDB Import Tab -->
                <div
                    v-if="activeTab === 'vdb-import'"
                    class="tab-content"
                >
                    <div
                        v-if="isLoading"
                        class="loading-message"
                    >
                        Loading from VDB...
                    </div>
                    <div
                        v-else
                        class="import-form"
                    >
                        <div class="input-group">
                            <label class="input-label">VDB URL:</label>
                            <input
                                v-model="vdbDeckUrl"
                                class="input-field"
                                placeholder="https://vdb.im/decks/DECK_ID"
                            />
                        </div>
                        <button
                            class="action-btn primary"
                            @click="loadFromVdb"
                        >
                            Load from VDB
                        </button>
                    </div>
                </div>

                <!-- VtesDeck Import Tab -->
                <div
                    v-if="activeTab === 'vtesdecks-import'"
                    class="tab-content"
                >
                    <div
                        v-if="isLoading"
                        class="loading-message"
                    >
                        Loading from VTES Decks...
                    </div>
                    <div
                        v-else
                        class="import-form"
                    >
                        <div class="input-group">
                            <label class="input-label">VTES Decks URL:</label>
                            <input
                                v-model="vtesdecksDeckUrl"
                                class="input-field"
                                placeholder="https://vtesdecks.com/deck/DECK_ID"
                            />
                        </div>
                        <button
                            class="action-btn primary"
                            @click="loadFromVtesdecks"
                        >
                            Load from VTES Decks
                        </button>
                    </div>
                </div>

                <!-- Amaranth Import Tab -->
                <div
                    v-if="activeTab === 'amaranth-import'"
                    class="tab-content"
                >
                    <div
                        v-if="isLoading"
                        class="loading-message"
                    >
                        Loading from Amaranth...
                    </div>
                    <div
                        v-else
                        class="import-form"
                    >
                        <div class="input-group">
                            <label class="input-label">Amaranth URL:</label>
                            <input
                                v-model="amaranthDeckUrl"
                                class="input-field"
                                placeholder="https://amaranth.vtes.co.nz/#deck/DECK_ID"
                            />
                        </div>
                        <button
                            class="action-btn primary"
                            @click="loadFromAmaranth"
                        >
                            Load from Amaranth
                        </button>
                    </div>
                </div>

                <!-- Text Import Tab -->
                <div
                    v-if="activeTab === 'text'"
                    class="tab-content"
                >
                    <div
                        v-if="isLoading"
                        class="loading-message"
                    >
                        Loading from text...
                    </div>
                    <div
                        v-else
                        class="import-form"
                    >
                        <div class="input-group">
                            <label class="input-label">Deck List:</label>
                            <textarea
                                v-model="deckText"
                                class="text-input-area"
                                placeholder="Paste your deck list here..."
                            />
                        </div>
                        <button
                            class="action-btn primary"
                            @click="loadFromText"
                        >
                            Load from Text
                        </button>
                    </div>
                </div>

                <!-- Preconstructed Tab -->
                <div
                    v-if="activeTab === 'preconstructed'"
                    class="tab-content"
                >
                    <div
                        v-if="isLoading"
                        class="loading-message"
                    >
                        Loading preconstructed decks...
                    </div>
                    <div
                        v-else
                        class="precon-sets"
                    >
                        <div
                            v-for="preconSets in allPreconSets"
                            :key="preconSets.setId"
                            class="precon-set"
                        >
                            <h4 class="set-name">{{ preconSets.setName }}</h4>
                            <div class="precon-buttons">
                                <button
                                    v-for="precon in preconSets.precons"
                                    :key="precon.id"
                                    class="action-btn precon-btn"
                                    @click="
                                        loadFromPrecon(preconSets.setId, precon.id, precon.name)
                                    "
                                >
                                    {{ precon.name }}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- View Deck Tab -->
                <div
                    v-if="activeTab === 'view-deck'"
                    class="tab-content"
                >
                    <DeckViewer
                        v-if="viewingDeckCards"
                        :deck-list="viewingDeckCards"
                    />
                </div>

                <!-- Success Tab -->
                <div
                    v-if="activeTab === SUCCESS_TAB"
                    class="tab-content"
                >
                    <div class="success-panel">
                        <h3 class="success-title">Deck Loaded Successfully!</h3>
                        <div class="success-message">
                            Your deck
                            <strong>{{ core.selfDeck?.name ?? 'Unnamed Deck' }}</strong> has been
                            loaded and is ready to use.
                        </div>

                        <div
                            v-if="deckWarnings.length"
                            class="alert-message"
                        >
                            <span class="alert-icon">⚠</span>
                            <div class="alert-text">
                                <div>Validation warnings:</div>
                                <ul class="warnings-list">
                                    <li
                                        v-for="(w, i) in deckWarnings"
                                        :key="i"
                                    >
                                        {{ w }}
                                    </li>
                                </ul>
                            </div>
                        </div>

                        <!-- Deck name input for unnamed decks -->
                        <div
                            v-if="!core.selfDeck?.name"
                            class="deck-name-section"
                        >
                            <label class="input-label">Give your deck a name:</label>
                            <div class="deck-name-input-group">
                                <input
                                    v-model="successDeckName"
                                    class="input-field"
                                    placeholder="Enter deck name..."
                                    @keyup.enter="saveDeckName"
                                />
                                <button
                                    class="action-btn save-name-btn"
                                    @click="saveDeckName"
                                >
                                    Save
                                </button>
                            </div>
                        </div>

                        <div class="success-actions">
                            <button
                                class="action-btn success-close-btn"
                                @click="viewDeck(core.selfDeck as DbDeck)"
                            >
                                Look Deck Content
                            </button>

                            <button
                                class="action-btn success-close-btn"
                                @click="bus.isDeckPanelOpen = false"
                            >
                                Close Panel
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </TopPanel>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useBusStore } from '@/client/store/bus.ts'
import DeckViewer from '@/client/ui/components/DeckViewer.vue'
import TopPanel from '@/client/ui/components/TopPanel.vue'
import {
    getOrImportAmaranth,
    getOrImportPrecon,
    getOrImportText,
    getOrImportVdb,
    getOrImportVtesdecks,
    selectDeck,
    validateDeckList,
} from '@/client/gateway/deck.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { db, DbDeck } from '@/client/gateway/db.ts'
import { gameResources } from '@/shared/registries.ts'
import { DeckList } from '@/shared/types/gateway.ts'

const core = useCoreStore()
const bus = useBusStore()

const isLoading = ref(false)
const errorMessage = ref('')

const deckWarnings = computed(() => {
    const cards = core.selfDeck?.cards
    return cards ? validateDeckList(cards) : []
})

function clearError() {
    errorMessage.value = ''
}

/** Tab Management **/

const activeTab = ref('history')

function onOpen() {
    activeTab.value = bus.deckPanelInitialTab
    bus.deckPanelInitialTab = 'history'
}

const tabs = [
    { id: 'history', title: 'History' },
    { id: 'vdb-import', title: 'VDB Import' },
    { id: 'vtesdecks-import', title: 'VTES Decks Import' },
    { id: 'amaranth-import', title: 'Amaranth Import' },
    { id: 'text', title: 'Text Import' },
    { id: 'preconstructed', title: 'Preconstructed' },
]

const SUCCESS_TAB = 'success'

/** Deck Loading **/

const MIN_LOADING_TIME = 1000

async function loadDeck(loader: () => Promise<void>) {
    clearError()
    isLoading.value = true
    const startTime = Date.now()

    try {
        await loader()
    } catch (error) {
        isLoading.value = false
        // Display the error message to the user
        errorMessage.value =
            error instanceof Error ?
                `Loading error : ${error.message}`
            :   'An unknown error occurred while loading the deck'
        return
    }

    // Ensure minimum 1 seconds loading time
    const elapsedTime = Date.now() - startTime
    const remainingTime = Math.max(0, MIN_LOADING_TIME - elapsedTime)

    if (remainingTime > 0) {
        await new Promise(resolve => setTimeout(resolve, remainingTime))
    }

    isLoading.value = false
    activeTab.value = SUCCESS_TAB

    // Refresh history.
    // We cannot just prepend the deck in deckHistory, as it may be an existing deck.
    await loadDeckHistory()
}

/** Deck history **/

const deckHistory = ref<DbDeck[]>([])

async function loadDeckHistory() {
    deckHistory.value = await db.decks.orderBy('lastUsed').reverse().toArray()
}
loadDeckHistory()

function loadFromHistory(deck: DbDeck) {
    loadDeck(() => selectDeck(deck))
}

async function removeFromHistory(deck: DbDeck) {
    await deck.delete()
    loadDeckHistory()
}

/** Deck Editing **/

const editingDeckId = ref<number | null>(null)
const editingDeckName = ref('')
const editInput = ref<HTMLInputElement[]>([])

function startEdit(deck: DbDeck) {
    editingDeckId.value = deck.id
    editingDeckName.value = deck.name
    // Focus input on next tick
    setTimeout(() => {
        const input = editInput.value[0]
        if (input) {
            input.focus()
            input.select()
        }
    }, 0)
}

async function saveEdit(deck: DbDeck) {
    if (!editingDeckName.value.trim()) {
        cancelEdit()
        return
    }

    const name = editingDeckName.value.trim()
    await db.decks.update(deck.id, { name })

    // Update the current deck name if it's the one being edited
    if (core.selfDeck?.id === deck.id) {
        core.selfDeck.name = name
    }

    await loadDeckHistory()
    cancelEdit()
}

function cancelEdit() {
    editingDeckId.value = null
    editingDeckName.value = ''
}

/** Success Tab Deck Naming **/

const successDeckName = ref('')

async function saveDeckName() {
    const name = successDeckName.value.trim()
    if (!name || !core.selfDeck?.id) {
        return
    }

    await db.decks.update(core.selfDeck.id, { name })
    // Update the current deck name
    core.selfDeck.name = name
    // Refresh history to reflect the change
    await loadDeckHistory()
    // Clear the input
    successDeckName.value = ''
}

/** VDB Import **/

const vdbDeckUrl = ref('')

async function loadFromVdb() {
    await loadDeck(() => getOrImportVdb(vdbDeckUrl.value))
    vdbDeckUrl.value = ''
}

/** VTESDeck Import **/

const vtesdecksDeckUrl = ref('')

async function loadFromVtesdecks() {
    await loadDeck(() => getOrImportVtesdecks(vtesdecksDeckUrl.value))
    vtesdecksDeckUrl.value = ''
}

/** Amaranth Import **/

const amaranthDeckUrl = ref('')

async function loadFromAmaranth() {
    await loadDeck(() => getOrImportAmaranth(amaranthDeckUrl.value))
    amaranthDeckUrl.value = ''
}

/** Text Import **/

const deckText = ref('')

async function loadFromText() {
    await loadDeck(() => getOrImportText(deckText.value))
    deckText.value = ''
}

/** Preconstructed Decks **/

type PreconSet = {
    setId: string
    setName: string
    precons: {
        id: string
        name: string
    }[]
}

const EXCLUDED_SETS = ['Promo', 'POD', 'playtest']
const allPreconSets = computed(() => {
    // In this function, the gr prefix stands for "game resources"
    const grAllSets = gameResources.setsAndPrecons
    if (!grAllSets) {
        return []
    }

    const preconSets = [] as PreconSet[]
    for (const setId in grAllSets) {
        if (EXCLUDED_SETS.includes(setId)) {
            continue
        }

        const grSet = grAllSets[setId]
        const setPrecons = []

        for (const preconId in grSet.precons) {
            const grPrecon = grSet.precons[preconId]
            setPrecons.push({ id: preconId, name: grPrecon.name })
        }

        if (setPrecons.length) {
            preconSets.push({
                setId,
                setName: grSet.name,
                precons: setPrecons,
            })
        }
    }
    return preconSets
})

function loadFromPrecon(setId: string, preconId: string, name: string) {
    loadDeck(() =>
        getOrImportPrecon(`${setId}-${preconId}`, name, gameResources.preconDecks[setId][preconId]),
    )
}

/** View Deck **/

const viewingDeckCards = ref<DeckList | null>(null)

function viewDeck(deck?: DbDeck) {
    if (!deck) {
        return
    }

    viewingDeckCards.value = deck.cards
    activeTab.value = 'view-deck'
}
</script>

<style lang="scss" scoped>
@use '../../styles/base' as *;

$max-width: 1200px;

/** Panel style **/

.deck-panel-content {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 2rem;
    max-width: $max-width;
    margin: 0 auto;
}

.current-deck {
    @include flex-center;
    background: $ash-grey;
    padding: 1.5rem;
    color: $pearl-grey;
    font-weight: 600;
    grid-column: 1 / -1;
    border: 1px solid $bone-grey;
}

.current-deck-name {
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: 0.3px;
    color: $pearl-grey;

    &.loading {
        color: $rose-red;
        font-style: italic;
    }

    &.clickable {
        cursor: pointer;
        text-decoration: underline;

        &:hover {
            color: $ghost-white;
        }
    }
}

.error-message {
    @include flex-center;
    background: $dark-blood 100%;
    color: $pearl-grey;
    padding: 1rem 1.25rem;
    border-radius: 6px;
    margin: 0;
    grid-column: 1 / -1;
    font-weight: 500;
    justify-content: space-between;
}

.error-text {
    flex: 1;
}

.error-close-btn {
    @include flex-center;
    background: none;
    border: none;
    color: $pearl-grey;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    margin-left: 1rem;
    width: 24px;
    height: 24px;

    &:hover {
        color: white;
    }
}

.deck-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.no-items-message {
    @include hero-message;
}

.loading-message {
    @include inline-message;
}

.deck-item {
    @include list-item;
}

.deck-info-left {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 1rem;
}

.source-badge {
    @extend .purple-badge;
    width: 35px;
}

.deck-name {
    color: $pearl-grey;
    font-size: 1rem;
    font-weight: 500;

    &.clickable {
        cursor: pointer;
        text-decoration: underline;

        &:hover {
            color: $ghost-white;
        }
    }
}

.deck-actions {
    display: flex;
    gap: 0.75rem;
}

.action-btn {
    @include button-dark-grey;
    padding: 0.5rem 1rem;
    font-size: 0.9rem;

    &.primary {
        background: linear-gradient(135deg, $shadow-purple 0%, $deep-purple 100%);
        color: $pearl-grey;
    }

    &.remove-btn {
        background: linear-gradient(135deg, $blood-red 0%, $dark-blood 100%);
        color: $pearl-grey;
    }

    &.precon-btn {
        margin: 0.25rem;
    }
}

.import-form {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.precon-sets {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.precon-set {
    border-bottom: 1px solid $ash-grey;
    padding-bottom: 1rem;

    &:last-child {
        border-bottom: none;
        padding-bottom: 0;
    }
}

.set-name {
    color: $pearl-grey;
    font-size: 1.1rem;
    font-weight: 500;
    font-family: serif;
    margin: 0 0 0.5rem 0;
    letter-spacing: 0.3px;
}

.precon-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.success-panel {
    @include flex-center;
    flex-direction: column;
    text-align: center;
    padding: 2rem 2rem;
    min-height: 200px;
    gap: 1.5rem;
}

.success-title {
    color: $pearl-grey;
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0;
    letter-spacing: 0.5px;
}

.success-message {
    color: $silver-grey;
    font-size: 1rem;
    line-height: 1.5;
    max-width: 600px;

    strong {
        color: $pearl-grey;
        font-weight: 600;
    }
}

.deck-name-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    max-width: 400px;
    padding: 1.5rem;
    background: $ash-grey;
    border: 1px solid $bone-grey;

    .input-label {
        color: $ghost-white;
    }
}

.deck-name-input-group {
    display: flex;
    gap: 0.5rem;
}

.save-name-btn {
    @include button-purple;
}

.success-actions {
    margin-top: 1rem;
}

.success-close-btn {
    @include button-purple;
    font-size: 1rem;
    font-weight: 500;
    min-width: 150px;
    margin: 0 20px;
}

.alert-message {
    @include flex-center;
    background: $wine-crimson;
    border: 1px solid $warm-coral;
    color: $ghost-white;
    padding: 1rem 1.5rem;
    margin: 0 auto 1.5rem auto;
    max-width: $max-width;
    font-weight: 600;
    gap: 0.75rem;
}

.alert-icon {
    font-size: 1.2rem;
    flex-shrink: 0;
}

.alert-text {
    flex: 1;
    line-height: 1.4;
}

.warnings-list {
    margin: 0.5rem 0 0 1.25rem;

    li {
        margin: 0.25rem 0;
        font-weight: 500;
    }
}
</style>
