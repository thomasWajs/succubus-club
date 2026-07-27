<template>
    <!-- prevent mouse events to reach the canvas with mousedown.stop -->
    <div
        v-if="gameBus.contextMenu.show && gameBus.contextMenu.cards.length"
        class="context-menu card-context-menu"
        :style="{
            left: gameBus.contextMenu.x + 20 + 'px',
            top: gameBus.contextMenu.y + 10 + 'px',
        }"
        @mousedown.stop
    >
        <CommandContextMenuButton
            v-if="firstCard.isIn.controlled"
            :closeOnClick="true"
            :command="commands.DeclareTarget"
        />

        <CommandContextMenuButton
            v-if="firstCard.isIn.uncontrolled"
            :command="commands.Influence"
        />

        <CommandContextMenuButton
            v-if="firstCard.isIn.play"
            :command="commands.GainBlood"
        />

        <CommandContextMenuButton
            v-if="firstCard.isIn.play"
            :command="commands.BurnBlood"
        />

        <CommandContextMenuButton
            v-if="firstCard.isIn.controlled"
            :command="commands.InvertLock"
            :closeOnClick="true"
        />

        <ContextMenuButton
            v-if="firstCard.isIn.controlled && gameState.gameType == GameType.TrainBot"
            :closeOnClick="true"
            :disabled="!singleMinion || !selfCanAttemptBlock(gameState)"
            :cardAction="
                () =>
                    gameMutations.ACTION_declareBlock.actSelf({
                        blockingMinion: singleMinion ?? NO_BLOCK,
                    })
            "
        >
            Attempt block
        </ContextMenuButton>

        <ContextMenuButton
            v-if="firstCard.isIn.library || firstCard.isIn.crypt"
            :closeOnClick="true"
            :cardAction="(card: Card) => shuffleCardRegion(card.region)"
        >
            Shuffle
        </ContextMenuButton>

        <CommandContextMenuButton
            v-if="firstCard.isIn.library || firstCard.isIn.crypt"
            :closeOnClick="true"
            :command="commands.QuickReveal"
        >
            Quick Reveal {{ firstCard == firstCard.region.firstCard ? 'Top Card ' : '' }} To All
        </CommandContextMenuButton>

        <SubmenuContextMenuButton
            v-if="firstCard.isIn.controlled"
            :submenuComponent="CountersSubmenu"
        >
            Counters
        </SubmenuContextMenuButton>

        <SubmenuContextMenuButton
            v-if="firstCard.isIn.controlled"
            :disabled="!singleCard"
            :submenuComponent="MarkersSubmenu"
        >
            Add/Remove Markers
        </SubmenuContextMenuButton>

        <SubmenuContextMenuButton
            v-if="firstCard.isIn.controlled"
            :submenuComponent="InfrequentMenuButtons"
        >
            More...
        </SubmenuContextMenuButton>
        <InfrequentMenuButtons v-else />
    </div>
</template>

<script setup lang="ts">
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { Card } from '@/shared/model/Card.ts'
import { GameType, NO_BLOCK } from '@/shared/types/state.ts'
import ContextMenuButton from '@/client/ui/context/menu/ContextMenuButton.vue'
import CommandContextMenuButton from '@/client/ui/context/menu/CommandContextMenuButton.vue'
import SubmenuContextMenuButton from '@/client/ui/context/menu/SubmenuContextMenuButton.vue'
import MarkersSubmenu from '@/client/ui/context/menu/MarkersSubmenu.vue'
import CountersSubmenu from '@/client/ui/context/menu/CountersSubmenu.vue'
import { selfCanAttemptBlock } from '@/shared/state/actionState.ts'
import InfrequentMenuButtons from '@/client/ui/context/menu/InfrequentMenuButtons.vue'
import { useContextSelection } from '@/client/ui/context/menu/useContextSelection.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { shuffleCardRegion } from '@/client/state/gameMutations.ts'

const { gameBus, commands, firstCard, singleCard, singleMinion } = useContextSelection()
const gameState = useGameStateStore()
</script>

<style lang="scss" scoped>
.card-context-menu {
    width: 230px;
}
</style>
