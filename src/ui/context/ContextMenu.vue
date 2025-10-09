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
        >
            Declare target
        </CommandContextMenuButton>

        <CommandContextMenuButton
            v-if="firstCard.isIn.uncontrolled"
            :command="commands.Influence"
        >
            Influence
        </CommandContextMenuButton>

        <CommandContextMenuButton
            v-if="firstCard.isIn.play"
            :command="commands.GainBlood"
        >
            Gain Blood
        </CommandContextMenuButton>

        <CommandContextMenuButton
            v-if="firstCard.isIn.play"
            :command="commands.BurnBlood"
        >
            Burn Blood
        </CommandContextMenuButton>

        <CommandContextMenuButton
            v-if="firstCard.isIn.controlled"
            :command="commands.GainGreenCounter"
        >
            +1 Green Counter
        </CommandContextMenuButton>

        <CommandContextMenuButton
            v-if="firstCard.isIn.controlled"
            :command="commands.BurnGreenCounter"
        >
            -1 Green Counter
        </CommandContextMenuButton>

        <CommandContextMenuButton
            v-if="firstCard.isIn.controlled"
            :command="commands.Flip"
            :closeOnClick="true"
        >
            Flip
        </CommandContextMenuButton>

        <SubmenuContextMenuButton
            v-if="firstCard.isIn.controlled"
            :disabled="!singleCard"
            :submenuComponent="MarkersSubmenu"
        >
            Add/Remove Markers
        </SubmenuContextMenuButton>

        <ContextMenuButton
            v-if="firstCard.isIn.hand || firstCard.isIn.library || firstCard.isIn.ashHeap"
            :closeOnClick="true"
            :cardAction="
                (card: Card) =>
                    gameMutations.playFaceDown.actSelf({
                        card: card,
                    })
            "
        >
            Play Face Down
        </ContextMenuButton>

        <CommandContextMenuButton
            v-if="firstCard.isIn.controlled || firstCard.isIn.hand"
            :command="commands.MoveToAshHeap"
            :closeOnClick="true"
        >
            Move to Ash Heap
        </CommandContextMenuButton>

        <ContextMenuButton
            v-if="!firstCard.isIn.uncontrolled && !firstCard.isIn.crypt"
            :closeOnClick="true"
            :cardAction="
                (card: Card) =>
                    gameState.selfPlayer ?
                        gameMutations.moveToBottom.actSelf({
                            card: card,
                            toCardRegion: gameState.selfPlayer.library,
                        })
                    :   null
            "
        >
            Move to Bottom of Library
        </ContextMenuButton>

        <ContextMenuButton
            v-if="firstCard.isIn.play || firstCard.isIn.crypt"
            :closeOnClick="true"
            :cardAction="
                (card: Card) =>
                    gameState.selfPlayer ?
                        gameMutations.moveToBottom.actSelf({
                            card: card,
                            toCardRegion: gameState.selfPlayer.crypt,
                        })
                    :   null
            "
        >
            Move to Bottom of Crypt
        </ContextMenuButton>

        <ContextMenuButton
            v-if="firstCard.isIn.controlled && core.gameType == GameType.TrainBot"
            :closeOnClick="true"
            :disabled="!singleMinion || !gameState.action?.canAttemptBlock"
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
            v-if="singleCard && !singleCard.isVampire()"
            :closeOnClick="true"
            :cardAction="(card: Card) => card.becomeVampire()"
        >
            Become an vampire
        </ContextMenuButton>

        <ContextMenuButton
            v-if="singleCard && !singleCard.isMinion()"
            :closeOnClick="true"
            :cardAction="(card: Card) => card.becomeMinion()"
        >
            Become an ally
        </ContextMenuButton>
    </div>
</template>

<script setup lang="ts">
import { useGameBusStore } from '@/store/bus.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import { computed } from 'vue'
import { Card, Minion } from '@/model/Card.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { useCoreStore } from '@/store/core.ts'
import { useCommands } from '@/game/composables/useCommands.ts'
import { GameType } from '@/state/types.ts'
import ContextMenuButton from '@/ui/context/ContextMenuButton.vue'
import CommandContextMenuButton from '@/ui/context/CommandContextMenuButton.vue'
import SubmenuContextMenuButton from '@/ui/context/SubmenuContextMenuButton.vue'
import MarkersSubmenu from '@/ui/context/MarkersSubmenu.vue'
import { NO_BLOCK } from '@/state/actionState.ts'

const core = useCoreStore()
const gameState = useGameStateStore()
const gameBus = useGameBusStore()
const commands = useCommands()

const firstCard = computed(() => gameBus.contextMenu.cards[0])
const singleCard = computed(() => (gameBus.contextMenu.cards.length == 1 ? firstCard.value : null))
const singleMinion = computed<Minion | null>(() =>
    singleCard.value && singleCard.value.isMinion() ? singleCard.value : null,
)
</script>

<style lang="scss" scoped>
.card-context-menu {
    width: 230px;
}
</style>
