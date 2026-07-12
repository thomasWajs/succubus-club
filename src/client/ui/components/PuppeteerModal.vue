<template>
    <dialog
        ref="dialogRef"
        class="puppeteer-modal"
    >
        <div class="modal-content">
            <h2>Puppeteer Game Setup</h2>
            <p class="subtitle">You will manage each player in turn.</p>

            <div class="players-list">
                <div
                    v-for="(player, index) in puppetConfigs"
                    :key="index"
                    class="player-row"
                >
                    <span class="player-label">Player {{ index + 1 }}</span>
                    <select
                        :value="String(player.deckId ?? '')"
                        class="deck-select"
                        @change="onDeckChange(index, $event)"
                    >
                        <option value="__import__">+ Import a deck</option>
                        <option
                            value=""
                            disabled
                        >
                            — Select a deck —
                        </option>
                        <option
                            v-for="deck in availableDecks"
                            :key="deck.id"
                            :value="String(deck.id)"
                        >
                            {{ deck.name }}
                        </option>
                    </select>
                    <button
                        v-if="puppetConfigs.length > 2"
                        class="remove-btn"
                        title="Remove player"
                        @click="removePlayer(index)"
                    >
                        ×
                    </button>
                    <div
                        v-else
                        class="remove-btn-placeholder"
                    />
                </div>
            </div>

            <div class="modal-footer">
                <button
                    class="cancel-button"
                    @click="cancel"
                >
                    Cancel
                </button>
                <button
                    class="start-button"
                    :disabled="!canStart"
                    @click="start"
                >
                    Start
                </button>
            </div>
        </div>
    </dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { db, DbDeck } from '@/client/gateway/db.ts'
import { useBusStore } from '@/client/store/bus.ts'
import { Puppet } from '@/client/types.ts'

const IMPORT_SENTINEL = '__import__'
const DEFAULT_PLAYER_COUNT = 5

type PuppetConfig = {
    deckId: number | null
}

const dialogRef = ref<HTMLDialogElement | null>(null)
const availableDecks = ref<DbDeck[]>([])
const puppetConfigs = ref<PuppetConfig[]>([])
const pendingImportPlayerIndex = ref<number | null>(null)

const bus = useBusStore()

let currentResolve: ((value: Puppet[] | null) => void) | null = null

const canStart = computed(() => puppetConfigs.value.every(p => p.deckId !== null))

function removePlayer(index: number) {
    puppetConfigs.value.splice(index, 1)
}

function onDeckChange(index: number, event: Event) {
    const value = (event.target as HTMLSelectElement).value
    if (value === IMPORT_SENTINEL) {
        ;(event.target as HTMLSelectElement).value = String(puppetConfigs.value[index].deckId ?? '')
        triggerImport(index)
    } else {
        puppetConfigs.value[index].deckId = value ? Number(value) : null
    }
}

function triggerImport(playerIndex: number) {
    pendingImportPlayerIndex.value = playerIndex
    dialogRef.value?.close()
    bus.deckPanelInitialTab = 'vdb-import'
    bus.isDeckPanelOpen = true
}

// When the deck panel closes after an import, refresh decks and reopen the modal
watch(
    () => bus.isDeckPanelOpen,
    async isOpen => {
        if (isOpen || pendingImportPlayerIndex.value === null) {
            return
        }

        const previousTopId = availableDecks.value[0]?.id ?? null
        availableDecks.value = await db.decks.orderBy('lastUsed').reverse().toArray()
        const newTopId = availableDecks.value[0]?.id ?? null

        if (newTopId !== null && newTopId !== previousTopId) {
            puppetConfigs.value[pendingImportPlayerIndex.value].deckId = newTopId
        }

        pendingImportPlayerIndex.value = null
        dialogRef.value?.showModal()
    },
)

function cancel() {
    pendingImportPlayerIndex.value = null
    dialogRef.value?.close()
    if (currentResolve) {
        currentResolve(null)
        currentResolve = null
    }
}

function start() {
    if (!canStart.value) {
        return
    }
    dialogRef.value?.close()
    if (currentResolve) {
        const puppets: Puppet[] = []
        for (const { deckId } of puppetConfigs.value) {
            const deck = availableDecks.value.find(d => d.id === deckId)
            if (!deck) {
                throw new Error('Deck not found')
            }
            puppets.push({ name: deck.name, deckList: deck.cards })
        }
        currentResolve(puppets)
        currentResolve = null
    }
}

defineExpose({
    open: async (): Promise<Puppet[] | null> => {
        availableDecks.value = await db.decks.orderBy('lastUsed').reverse().toArray()

        puppetConfigs.value = Array.from({ length: DEFAULT_PLAYER_COUNT }, (_, i) => ({
            deckId: availableDecks.value[i]?.id ?? null,
        }))

        return new Promise(resolve => {
            currentResolve = resolve
            dialogRef.value?.showModal()
        })
    },
})
</script>

<style lang="scss" scoped>
.puppeteer-modal {
    border: none;
    padding: 0;
    max-width: 500px;
    width: 95%;
    z-index: 1200;

    &::backdrop {
        background: rgba(0, 0, 0, 0.8);
    }
}

.modal-content {
    background: $ash-grey;
    color: $ghost-white;
    padding: 2rem;
}

.modal-content h2 {
    color: $pearl-grey;
    margin-bottom: 0.25rem;
    font-size: 1.5rem;
    text-align: center;
}

.subtitle {
    text-align: center;
    color: $pearl-grey;
    font-size: 0.9rem;
    margin-bottom: 1.5rem;
}

.players-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-bottom: 1.5rem;
}

.player-row {
    display: grid;
    grid-template-columns: 70px 1fr 32px;
    align-items: center;
    gap: 0.6rem;
}

.player-label {
    color: $pearl-grey;
    font-size: 0.9rem;
    font-weight: 600;
    white-space: nowrap;
}

.deck-select {
    background: $shadow-grey;
    border: 1px solid $royal-purple;
    color: $ghost-white;
    padding: 0.4rem 0.6rem;
    font-size: 0.9rem;
    border-radius: 0.2rem;
    width: 100%;
    cursor: pointer;

    option {
        background: $shadow-grey;
        color: $ghost-white;
    }

    &:focus {
        outline: none;
        border-color: $neon-purple;
    }
}

.remove-btn {
    background: transparent;
    border: 1px solid rgba($warm-coral, 0.5);
    color: $warm-coral;
    width: 28px;
    height: 28px;
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
    border-radius: 0.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;

    &:hover {
        background: rgba($warm-coral, 0.15);
        border-color: $warm-coral;
    }
}

.remove-btn-placeholder {
    width: 28px;
    height: 28px;
}

.modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 1rem;
    margin-top: 0.5rem;
}

.cancel-button {
    @include button-grey;
}

.start-button {
    @include button-purple;

    &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
}
</style>
