<template>
    <template
        v-for="(markers, markerType) in Markers"
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
            </ContextMenuButton>
        </template>
    </template>
</template>

<script setup lang="ts">
import ContextMenuButton from '@/ui/context/ContextMenuButton.vue'
import { Card } from '@/model/Card.ts'
import { Marker, Markers } from '@/model/const.ts'
import { gameMutations } from '@/state/gameMutations.ts'

function toggleMarker(targetCard: Card, marker: Marker) {
    gameMutations.changeMarker.actSelf({
        card: targetCard,
        marker,
        operation: targetCard.hasMarker(marker) ? 'Remove' : 'Add',
    })
}
</script>

<style lang="scss">
.menu-header {
    padding: 8px 5px;
    color: $rose-red;
}
.offset-menu-button {
    padding-left: 25px;
}
</style>
