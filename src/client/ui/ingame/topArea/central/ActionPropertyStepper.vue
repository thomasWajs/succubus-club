<template>
    <button
        class="game-button small"
        @click="change(-1)"
    >
        -1
    </button>
    <strong>{{ value }} {{ label }}</strong>
    <button
        class="game-button small"
        @click="change(+1)"
    >
        +1
    </button>
</template>

<script setup lang="ts">
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { ActionProperty } from '@/shared/types/state.ts'

const props = defineProps<{
    property: ActionProperty
    value: number
    label: string
}>()

function change(amount: number) {
    gameMutations.ACTION_changeProperty.actSelf({
        propertyName: props.property,
        amount,
    })
}
</script>
