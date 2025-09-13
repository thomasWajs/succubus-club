<template>
    <TopPanel
        :isOpen="bus.isDeckPanelOpen"
        @close="bus.isDeckPanelOpen = false"
        @open="activeTab = 'history'"
    >
        <template #title>Deck Selection</template>

        <div class="deck-panel-content">
            <div class="current-deck">
                <span class="current-deck-label">Currently&nbsp;:&nbsp;</span>
                <span
                    class="current-deck-name"
                    :class="{ loading: isLoading }"
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
                                <span class="deck-name">{{ deck.name }}</span>
                            </div>
                            <div class="deck-actions">
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

                <!-- Success Tab -->
                <div
                    v-if="activeTab === SUCCESS_TAB"
                    class="tab-content"
                >
                    <div class="success-panel">
                        <h3 class="success-title">Deck Loaded Successfully!</h3>
                        <div class="success-message">
                            Your deck
                            <strong>{{ core.selfDeck?.name ?? 'Unknown Deck' }}</strong> has been
                            loaded and is ready to use.
                        </div>
                        <div class="success-actions">
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
import TopPanel from './TopPanel.vue'
import { useBusStore } from '@/store/bus.ts'
import { getOrImportPrecon, getOrImportText, getOrImportVdb, selectDeck } from '@/gateway/deck.ts'
import { useCoreStore } from '@/store/core.ts'
import { db, DbDeck } from '@/gateway/db.ts'
import { gameResources } from '@/resources/cards.ts'

const core = useCoreStore()
const bus = useBusStore()

const isLoading = ref(false)
const errorMessage = ref('')

function clearError() {
    errorMessage.value = ''
}

/** Tab Management **/

const activeTab = ref('history')

const tabs = [
    { id: 'history', title: 'History' },
    { id: 'vdb-import', title: 'VDB Import' },
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

/** VDB Import **/

const vdbDeckUrl = ref('')

function loadFromVdb() {
    loadDeck(() => getOrImportVdb(vdbDeckUrl.value))
}

/** Text Import **/

const deckText = ref('')

function loadFromText() {
    loadDeck(() => getOrImportText(deckText.value))
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
    loadDeck(() => getOrImportPrecon(name, gameResources.preconDecks[setId][preconId]))
}
</script>

<style lang="scss" scoped>
@use '@/styles/base' as *;

$max-width: 1200px;

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

.tabs-section {
    @include panel;
}

.tab-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.tab-btn {
    @include button-dark-grey;
    padding: 0.75rem 1rem;
    text-align: left;
    border: 1px solid $bone-grey;

    &.active {
        @include button-purple;
        border-color: $mist-grey;
    }
}

.tab-content-section {
    @include panel;
    overflow-y: auto;
    max-height: 400px;
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

.success-actions {
    margin-top: 1rem;
}

.success-close-btn {
    @include button-purple;
    font-size: 1rem;
    font-weight: 500;
    min-width: 150px;
}
</style>
