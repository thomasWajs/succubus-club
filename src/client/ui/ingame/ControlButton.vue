<template>
    <button
        class="game-button"
        :class="{ 'is-muted': !isActive }"
        @click="giveControl()"
    >
        {{ player.name }}
    </button>
</template>

<script setup lang="ts">
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { computed } from 'vue'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { Player } from '@/shared/model/Player.ts'

const { player, cardRegion } = defineProps<{
    player: Player
    cardRegion: AnyCardRegion
}>()

const isActive = computed(() => cardRegion.delegate?.oid == player.oid)

function giveControl() {
    gameMutations.takeRegionControl.actSelf({
        cardRegion,
        controller: isActive.value ? undefined : player,
    })
}
</script>
