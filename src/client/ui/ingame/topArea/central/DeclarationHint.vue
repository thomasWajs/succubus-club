<template>
    <div class="declaration-hint">
        <template v-if="gameBus.actionDeclaration.type && gameBus.actionDeclaration.validTargets">
            Select
            <strong>{{ MinionActionNames[gameBus.actionDeclaration.type] }}</strong> target
        </template>

        <template
            v-if="
                gameBus.actionDeclaration.type == MinionActionType.ActionCardFromHand &&
                gameBus.actionDeclaration.actingMinion
            "
        >
            Choose an <strong>action card</strong> from your <strong>hand</strong>
        </template>

        <template
            v-if="
                gameBus.actionDeclaration.type == MinionActionType.ActionInPlay &&
                gameBus.actionDeclaration.actingMinion
            "
        >
            Choose a <strong>card in play</strong> that provides an action
        </template>
    </div>
</template>

<script setup lang="ts">
import { useGameBusStore } from '@/client/store/bus.ts'
import { MinionActionNames, MinionActionType } from '@/shared/types/state.ts'

const gameBus = useGameBusStore()
</script>

<style lang="scss">
.declaration-hint {
    font-size: 20px;
    color: $midnight-blue;
    text-decoration: underline;
}
</style>
