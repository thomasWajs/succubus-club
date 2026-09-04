<template>
    <CentralPanel
        v-if="hasHint"
        class="declaration-hint"
    >
        <div>
            <template
                v-if="gameBus.actionDeclaration.type && gameBus.actionDeclaration.validTargets"
            >
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
    </CentralPanel>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { MinionActionNames, MinionActionType } from '@/shared/types/state.ts'
import CentralPanel from '@/client/ui/ingame/topArea/central/CentralPanel.vue'

const gameBus = useGameBusStore()

// Mirrors the render conditions below : only show the panel when at least one
// hint actually has something to say, so it never appears as an empty box.
const hasHint = computed(() => {
    const declaration = gameBus.actionDeclaration
    return Boolean(
        (declaration.type && declaration.validTargets) ||
            (declaration.type == MinionActionType.ActionCardFromHand && declaration.actingMinion) ||
            (declaration.type == MinionActionType.ActionInPlay && declaration.actingMinion),
    )
})
</script>

<style lang="scss">
.central-panel.declaration-hint {
    padding: 1rem 2rem;
    font-size: 20px;
    color: $midnight-blue;
    text-decoration: underline;
    text-align: center;
}
</style>
