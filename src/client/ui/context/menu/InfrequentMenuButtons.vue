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
        v-if="!firstCard.isIn.ashHeap && !firstCard.isIn.removed"
        :command="commands.MoveToAshHeap"
        :closeOnClick="true"
    >
        <template
            v-if="
                singleCard &&
                (firstCard.isIn.library || firstCard.isIn.crypt) &&
                firstCard == firstCard.region.firstCard
            "
        >
            Burn Top Card
        </template>
        <template v-else-if="firstCard.isIn.hand"> Discard </template>
        <template v-else>
            {{ commands.MoveToAshHeap.label }}
        </template>
    </CommandContextMenuButton>

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
                players.selfPlayer ?
                    gameMutations.moveToBottom.actSelf({
                        card: card,
                        toCardRegion: players.selfPlayer.library,
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
                players.selfPlayer ?
                    gameMutations.moveToBottom.actSelf({
                        card: card,
                        toCardRegion: players.selfPlayer.crypt,
                    })
                :   null
        "
    >
        Move to Bottom of Crypt
    </ContextMenuButton>

    <ContextMenuButton
        v-if="singleCard && !singleCard.isVampire() && singleCard.isIn.ready"
        :closeOnClick="true"
        :cardAction="
            (card: Card) =>
                gameMutations.becomeVampire.actSelf({
                    card: card,
                })
        "
    >
        Become a vampire
    </ContextMenuButton>

    <ContextMenuButton
        v-if="singleCard && !singleCard.isMinion() && singleCard.isIn.ready"
        :closeOnClick="true"
        :cardAction="
            (card: Card) =>
                gameMutations.becomeMinion.actSelf({
                    card: card,
                })
        "
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
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { Card } from '@/shared/model/Card.ts'
import { useContextSelection } from '@/client/ui/context/menu/useContextSelection.ts'
import CommandContextMenuButton from '@/client/ui/context/menu/CommandContextMenuButton.vue'
import ContextMenuButton from '@/client/ui/context/menu/ContextMenuButton.vue'

const { players, commands, firstCard, singleCard } = useContextSelection()
</script>

<style lang="scss"></style>
