<template>
    <button
        v-if="pass && pass.host == host"
        class="game-button engine-pass"
        @click="choose(pass.option)"
    >
        {{ pass.option.text }}
    </button>
</template>

<script setup lang="ts">
/**
 * The pass during an action, a combat or a referendum, in the panel of the central box it goes in :
 * one place, the topmost panel ( see centralPass ). Its text is the engine's ( "Pass (no block)" ).
 */
import { centralPass, PassHost } from '@/client/engine/interaction.ts'
import { chooseEngineOption } from '@/client/engine/driver.ts'
import { hoverEngineCard } from '@/client/engine/cardNames.ts'
import { EngineOption } from '@/client/engine/protocol.ts'

defineProps<{ host: PassHost }>()

const pass = centralPass

function choose(option: EngineOption) {
    hoverEngineCard(null)
    chooseEngineOption(option.index)
}
</script>

<style lang="scss">
.game-button.engine-pass {
    align-self: center;
}
</style>
