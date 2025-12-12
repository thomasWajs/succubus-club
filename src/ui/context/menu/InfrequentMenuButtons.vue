<template>
    <CommandContextMenuButton
        v-if="firstCard.isIn.controlled"
        :command="commands.Flip"
        :closeOnClick="true"
    />

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
    />

    <CommandContextMenuButton
        v-if="!firstCard.isIn.removed"
        :command="commands.RemoveFromGame"
        :closeOnClick="true"
    />

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
        v-if="singleCard && !singleCard.isVampire() && singleCard.isIn.ready"
        :closeOnClick="true"
        :cardAction="(card: Card) => card.becomeVampire()"
    >
        Become a vampire
    </ContextMenuButton>

    <ContextMenuButton
        v-if="singleCard && !singleCard.isMinion() && singleCard.isIn.ready"
        :closeOnClick="true"
        :cardAction="(card: Card) => card.becomeMinion()"
    >
        Become an ally
    </ContextMenuButton>

    <CommandContextMenuButton
        v-if="firstCard.isIn.play"
        :command="commands.PingCard"
        :closeOnClick="true"
    />
</template>

<script setup lang="ts">
import { gameMutations } from '@/state/gameMutations.ts'
import { Card } from '@/model/Card.ts'
import { useContextSelection } from '@/ui/context/menu/useContextSelection.ts'
import CommandContextMenuButton from '@/ui/context/menu/CommandContextMenuButton.vue'
import ContextMenuButton from '@/ui/context/menu/ContextMenuButton.vue'

const { gameState, commands, firstCard, singleCard } = useContextSelection()
</script>

<style lang="scss"></style>
