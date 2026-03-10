<template>
    <div class="deck-viewer">
        <!-- Crypt Section -->
        <div class="deck-section">
            <h3 class="section-title">Crypt ({{ cryptCardCount }} cards)</h3>
            <div class="section-divider" />
            <div class="card-list">
                <div
                    v-for="card in cryptCards"
                    :key="card.id"
                    class="card-entry crypt-card"
                >
                    <span class="card-quantity">{{ card.quantity }}x</span>
                    <span
                        class="card-name"
                        @mouseenter="onCardHover(card.id, $event)"
                        @mouseleave="onCardLeave"
                    >
                        {{ card.name }}
                    </span>
                    <span class="card-capacity">{{ card.capacity }}</span>
                    <span class="card-disciplines">{{ card.disciplines }}</span>
                    <span class="card-info">{{ card.info }}</span>
                    <span class="card-clan">{{ card.clan }}</span>
                    <span class="card-group">G{{ card.group }}</span>
                </div>
            </div>
        </div>

        <!-- Library Section -->
        <div class="deck-section">
            <h3 class="section-title">Library ({{ libraryCardCount }} cards)</h3>
            <div class="section-divider" />

            <div
                v-for="type in libraryTypes"
                :key="type"
                class="card-type-group"
            >
                <h4 class="type-title">{{ type }} ({{ libraryByType[type].total }})</h4>
                <div class="type-divider" />
                <div class="card-list">
                    <div
                        v-for="card in libraryByType[type].cards"
                        :key="card.id"
                        class="card-entry library-card"
                    >
                        <span class="card-quantity">{{ card.quantity }}x</span>
                        <span
                            class="card-name"
                            @mouseenter="onCardHover(card.id, $event)"
                            @mouseleave="onCardLeave"
                        >
                            {{ card.name }}
                        </span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Floating Card Preview -->
        <div
            v-if="hoveredCard"
            class="card-preview"
            :style="cardPreviewStyle"
        >
            <div
                v-if="imageLoading"
                class="card-loading"
            >
                <div class="spinner" />
            </div>
            <img
                v-show="!imageLoading"
                :src="cardImageUrl"
                alt="Card preview"
                class="card-image"
                @load="onImageLoad"
                @error="onImageError"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { CARDS_PATH } from '@/client/resources/cards.ts'
import { Discipline, DisciplineLevel, LibraryCardType } from '@/shared/const/model.ts'
import { DeckList, KrcgId } from '@/shared/types/gateway.ts'
import { CryptCardResource, LibraryCardResource } from '@/shared/types/resources.ts'
import { gameResources } from '@/shared/registries.ts'
import { isCryptId } from '@/shared/model/Card.ts'

const props = defineProps<{
    deckList: DeckList
}>()

type FormattedCryptCard = {
    id: string
    quantity: number
    name: string
    capacity: number
    disciplines: string
    info: string
    clan: string
    group: string
}

type FormattedLibraryCard = {
    id: string
    quantity: number
    name: string
    type: string
}

function formatDisciplines(disciplines: Record<Discipline, DisciplineLevel>): string {
    const parts: string[] = []
    // eslint-disable-next-line prefer-const
    for (let [disc, level] of Object.entries(disciplines)) {
        // Special case for Blood Sorcery / Thanatosis
        if (disc == Discipline.BloodSorcery) {
            disc = 'tha'
        }
        if (disc == Discipline.Thanatosis) {
            disc = 'thn'
        }

        if (level === DisciplineLevel.SUPERIOR) {
            parts.push(disc.slice(0, 3).toUpperCase())
        } else if (level === DisciplineLevel.INFERIOR) {
            parts.push(disc.slice(0, 3).toLowerCase())
        }
    }
    return parts.join(' ')
}

const cryptCards = computed(() => {
    const cards: FormattedCryptCard[] = []

    for (const [krcgId, quantity] of Object.entries(props.deckList)) {
        if (!isCryptId(krcgId)) continue

        const cardResource = gameResources.cardbase[krcgId] as CryptCardResource
        if (!cardResource) continue

        cards.push({
            id: krcgId,
            quantity,
            name: cardResource.name,
            capacity: cardResource.capacity,
            disciplines: formatDisciplines(cardResource.disciplines),
            info: cardResource.title || '',
            clan: cardResource.clan || '',
            group: cardResource.group || '',
        })
    }

    // Sort by capacity descending, then by name
    cards.sort((a, b) => {
        if (a.capacity !== b.capacity) return b.capacity - a.capacity
        return a.name.localeCompare(b.name)
    })

    return cards
})

const cryptCardCount = computed(() => {
    return cryptCards.value.reduce((sum, card) => sum + card.quantity, 0)
})

const libraryCards = computed(() => {
    const cards: FormattedLibraryCard[] = []

    for (const [krcgId, quantity] of Object.entries(props.deckList)) {
        if (isCryptId(krcgId)) continue

        const cardResource = gameResources.cardbase[krcgId] as LibraryCardResource
        if (!cardResource) continue

        cards.push({
            id: krcgId,
            quantity,
            name: cardResource.name,
            type: cardResource.type,
        })
    }

    // Sort by name
    cards.sort((a, b) => a.name.localeCompare(b.name))

    return cards
})

const libraryByType = computed(() => {
    const byType: Record<string, { cards: FormattedLibraryCard[]; total: number }> = {}

    for (const card of libraryCards.value) {
        if (!byType[card.type]) {
            byType[card.type] = { cards: [], total: 0 }
        }
        byType[card.type].cards.push(card)
        byType[card.type].total += card.quantity
    }

    return byType
})

const libraryTypes = computed(() => {
    const typeOrder = [
        LibraryCardType.Master,
        LibraryCardType.Conviction,
        LibraryCardType.Power,
        LibraryCardType.Action,
        LibraryCardType.PoliticalAction,
        LibraryCardType.Ally,
        LibraryCardType.Equipment,
        LibraryCardType.Retainer,
        LibraryCardType.ActionModifier,
        LibraryCardType.Reaction,
        LibraryCardType.Combat,
        LibraryCardType.Event,
    ]
    const types = Object.keys(libraryByType.value) as LibraryCardType[]

    // Sort by predefined order, then alphabetically for unknown types
    types.sort((a, b) => {
        const indexA = typeOrder.indexOf(a)
        const indexB = typeOrder.indexOf(b)

        if (indexA !== -1 && indexB !== -1) return indexA - indexB
        if (indexA !== -1) return -1
        if (indexB !== -1) return 1
        return a.localeCompare(b)
    })

    return types
})

const libraryCardCount = computed(() => {
    return libraryCards.value.reduce((sum, card) => sum + card.quantity, 0)
})

/** Card Image Hover **/

const hoveredCard = ref<KrcgId | null>(null)
const imageLoading = ref(false)
const cardPreviewPosition = ref({ x: 0, y: 0 })

const cardImageUrl = computed(() => {
    if (!hoveredCard.value) return ''
    const cardResource = gameResources.cardbase[hoveredCard.value]
    if (!cardResource) return ''
    return `${CARDS_PATH}/${cardResource.imageName}.webp`
})

const cardPreviewStyle = computed(() => {
    return {
        left: `${cardPreviewPosition.value.x}px`,
        top: `${cardPreviewPosition.value.y}px`,
    }
})

function onCardHover(cardId: KrcgId, event: MouseEvent) {
    hoveredCard.value = cardId
    imageLoading.value = true

    // Get the deck-viewer container position
    const deckViewer = (event.target as HTMLElement).closest('.deck-viewer')
    if (!deckViewer) return

    const viewerRect = deckViewer.getBoundingClientRect()

    // Position: right edge of card aligns with left edge of deck-viewer
    // Vertically aligned with cursor (using clientY which is relative to viewport)
    cardPreviewPosition.value = {
        x: viewerRect.left - 310, // 300px card width + 10px gap
        y: event.clientY - 250, // Use clientY directly since position is fixed
    }
}

function onCardLeave() {
    hoveredCard.value = null
    imageLoading.value = false
}

function onImageLoad() {
    imageLoading.value = false
}

function onImageError() {
    imageLoading.value = false
    // Keep the preview visible but it will just show nothing if image fails to load
}
</script>

<style lang="scss" scoped>
@use '../../styles/base' as *;

.deck-viewer {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2rem;
    font-family: monospace;
    color: $pearl-grey;
}

.deck-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.section-title {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0;
    color: $ghost-white;
}

.section-divider {
    height: 2px;
    background: $bone-grey;
    margin: 0.25rem 0;
}

.card-type-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-left: 1rem;
}

.type-title {
    font-size: 1rem;
    font-weight: 500;
    margin: 0.5rem 0 0 0;
    color: $silver-grey;
}

.type-divider {
    height: 1px;
    background: $ash-grey;
    margin: 0.25rem 0;
}

.card-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.card-entry {
    display: grid;
    gap: 0.5rem;
    padding: 0.25rem 0;

    &.crypt-card {
        grid-template-columns: 2rem 1fr 2rem 10rem 5rem 12rem 1rem;
    }

    &.library-card {
        grid-template-columns: 3rem 1fr;
    }
}

.card-quantity {
    color: $silver-grey;
    text-align: right;
}

.card-name {
    color: $pearl-grey;
    font-weight: 500;
    cursor: help;
    text-decoration-color: transparent;
    transition: text-decoration-color 0.2s;

    &:hover {
        color: $neon-purple;
    }
}

.card-capacity {
    color: $ghost-white;
    text-align: center;
}

.card-disciplines {
    color: $silver-grey;
    min-width: 8rem;
}

.card-info {
    color: $silver-grey;
    min-width: 6rem;
}

.card-clan {
    color: $silver-grey;
}

/** Card Preview **/

.card-preview {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
    max-width: 300px;
}

.card-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 300px;
    height: 420px;
    background: $ash-grey;
    border: 2px solid $bone-grey;
    border-radius: 8px;
}

.spinner {
    width: 40px;
    height: 40px;
    border: 4px solid $bone-grey;
    border-top-color: $pearl-grey;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

.card-image {
    max-width: 100%;
    height: auto;
    border: 2px solid $bone-grey;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}
</style>
