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
            v-if="isUncontrolled"
            :command="commands.Influence"
        >
            Influence
        </CommandContextMenuButton>

        <CommandContextMenuButton
            v-if="isInPlay || isUncontrolled"
            :command="commands.GainBlood"
        >
            Gain Blood
        </CommandContextMenuButton>

        <CommandContextMenuButton
            v-if="isInPlay || isUncontrolled"
            :command="commands.BurnBlood"
        >
            Burn Blood
        </CommandContextMenuButton>

        <CommandContextMenuButton
            v-if="isInPlay"
            :command="commands.GainGreenCounter"
        >
            +1 Green Counter
        </CommandContextMenuButton>

        <CommandContextMenuButton
            v-if="isInPlay"
            :command="commands.BurnGreenCounter"
        >
            -1 Green Counter
        </CommandContextMenuButton>

        <CommandContextMenuButton
            v-if="isInPlay"
            :command="commands.Flip"
            :closeOnClick="true"
        >
            Flip
        </CommandContextMenuButton>

        <SubmenuContextMenuButton
            v-if="isInPlay"
            :submenuComponent="MarkersSubmenu"
        >
            Add/Remove Markers
        </SubmenuContextMenuButton>

        <ContextMenuButton
            v-if="isHand || isLibrary || isAshHeap"
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

        <ContextMenuButton
            v-if="!isUncontrolled && !isCrypt"
            :closeOnClick="true"
            :cardAction="
                (card: Card) =>
                    gameMutations.moveToBottom.actSelf({
                        card: card,
                        toCardRegion: gameState.selfPlayer.library,
                    })
            "
        >
            Move to Bottom of Library
        </ContextMenuButton>

        <ContextMenuButton
            v-if="isInPlay || isCrypt || isUncontrolled"
            :closeOnClick="true"
            :cardAction="
                (card: Card) =>
                    gameMutations.moveToBottom.actSelf({
                        card: card,
                        toCardRegion: gameState.selfPlayer.crypt,
                    })
            "
        >
            Move to Bottom of Crypt
        </ContextMenuButton>

        <ContextMenuButton
            v-if="isInPlay && core.gameType == GameType.TrainBot"
            :closeOnClick="true"
            :disabled="!singleMinion || !gameState.action?.canAttemptBlock"
            :cardAction="
                () =>
                    gameMutations.ACTION_declareBlock.actSelf({
                        blockingMinion: singleMinion!,
                    })
            "
        >
            Attempt block
        </ContextMenuButton>
    </div>
</template>

<script setup lang="ts">
import { useGameBusStore } from '@/store/bus.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import { computed } from 'vue'
import { Card, Minion } from '@/model/Card.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { RegionName } from '@/model/const.ts'
import { useCoreStore } from '@/store/core.ts'
import { useCommands } from '@/game/composables/useCommands.ts'
import { GameType } from '@/state/types.ts'
import ContextMenuButton from '@/ui/context/ContextMenuButton.vue'
import CommandContextMenuButton from '@/ui/context/CommandContextMenuButton.vue'
import SubmenuContextMenuButton from '@/ui/context/SubmenuContextMenuButton.vue'
import MarkersSubmenu from '@/ui/context/MarkersSubmenu.vue'

const core = useCoreStore()
const gameState = useGameStateStore()
const gameBus = useGameBusStore()
const commands = useCommands()

const regionName = computed(() => gameBus.contextMenu.cards[0]?.region.name)
const isInPlay = computed(() =>
    [RegionName.Controlled, RegionName.Torpor].includes(regionName.value),
)
const isUncontrolled = computed(() => regionName.value == RegionName.Uncontrolled)
const isCrypt = computed(() => regionName.value == RegionName.Crypt)
const isLibrary = computed(() => regionName.value == RegionName.Library)
const isHand = computed(() => regionName.value == RegionName.Hand)
const isAshHeap = computed(() => regionName.value == RegionName.AshHeap)

const singleCard = computed(() =>
    gameBus.contextMenu.cards.length == 1 ? gameBus.contextMenu.cards[0] : null,
)
const singleMinion = computed(() =>
    singleCard.value && singleCard.value instanceof Minion ? singleCard.value : null,
)
</script>

<style lang="scss" scoped>
.card-context-menu {
    width: 230px;
}
</style>
