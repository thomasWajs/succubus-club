<template>
    <template
        v-for="(markers, markerType) in MainMarkers"
        :key="markerType"
    >
        <div class="menu-header">{{ markerType }}</div>
        <template
            v-for="marker in markers"
            :key="marker"
        >
            <ContextMenuButton
                class="offset-menu-button"
                :closeOnClick="true"
                :cardAction="(card: Card) => toggleMarker(card, marker)"
            >
                {{ marker }}
                <template
                    v-if="gameBus.contextMenu.cards.some(card => card.hasMarker(marker))"
                    #right
                >
                    ❌
                </template>
            </ContextMenuButton>
        </template>
    </template>

    <div class="menu-header">Custom</div>

    <div class="create-marker">
        <input
            v-model="markerText"
            type="text"
            placeholder="Create marker..."
            @keydown.stop
            @keydown.enter="createCustomMarker"
        />
        <button
            class="game-button"
            @keydown.stop
            @click="createCustomMarker"
        >
            Ok
        </button>
    </div>

    <template
        v-for="marker in customMarkers"
        :key="marker"
    >
        <ContextMenuButton
            class="offset-menu-button"
            :closeOnClick="true"
            :cardAction="(card: Card) => toggleMarker(card, marker)"
        >
            {{ marker }}
            <template #right>❌</template>
        </ContextMenuButton>
    </template>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ContextMenuButton from '@/client/ui/context/menu/ContextMenuButton.vue'
import { Card } from '@/shared/model/Card.ts'
import { MainMarkers, Marker } from '@/shared/const/model.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { useGameBusStore } from '@/client/store/bus.ts'

const gameBus = useGameBusStore()

function toggleMarker(card: Card, marker: Marker) {
    gameMutations.changeMarker.actSelf({
        card,
        marker,
        operation: card.hasMarker(marker) ? 'Remove' : 'Add',
    })
}

const markerText = ref('')
function createCustomMarker() {
    if (!markerText.value) {
        return
    }
    gameBus.contextMenu.cards.forEach((card: Card) => {
        toggleMarker(card, markerText.value)
    })
    gameBus.hideContextMenu()
}

const customMarkers = computed(() => {
    const markers = new Set<string>()
    const mainMarkers = Object.values(MainMarkers).flat() as string[]
    gameBus.contextMenu.cards.forEach((card: Card) => {
        card.markers.forEach(marker => {
            if (!mainMarkers.includes(marker)) {
                markers.add(marker)
            }
        })
    })
    return Array.from(markers).toSorted()
})
</script>

<style lang="scss">
.menu-header {
    padding: 8px 5px;
    color: $rose-red;
}
.offset-menu-button {
    padding-left: 20px;
}
.create-marker {
    display: flex;
    margin-bottom: 4px;

    input {
        flex: 1;
        min-width: 0;
        margin-right: 4px;
        font-size: 13px;
    }

    button {
        flex-shrink: 0;
        margin: 0;
    }
}
</style>
