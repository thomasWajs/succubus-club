<template>
    <Rectangle
        ref="boundaries"
        :origin="0"
        :x="x"
        :y="y"
        :width="width"
        :height="height"
        :lineWidth="0"
        :strokeAlpha="0"
        :fillAlpha="0"
        @create="onTheEdgeCreate"
        @pointerdown="
            gameMutations.changeTheEdgeControl.actSelf({
                theEdgeController: player == gameState.theEdgeController ? undefined : player,
            })
        "
    >
        <Image
            :texture="player == gameState.theEdgeController ? Texture.TheEdgeTeal : Texture.TheEdge"
            :alpha="player == gameState.theEdgeController ? 1 : 0.3"
            :origin="0.5"
            :x="x + width / 2"
            :y="y + height / 2 - 8"
        >
            <!-- With the rules engine : usable now ( its pool, its vote ) -->
            <FxGlow
                v-if="usable"
                :color="Colors.CARD_GLOW.color"
                :outerStrength="CARD_IN_HAND_GLOW_OUTER_STRENGTH"
                :innerStrength="CARD_IN_HAND_GLOW_INNER_STRENGTH"
            />
        </Image>

        <Text
            ref="regionName"
            text="The Edge"
            :style="{
                color: color.rgba,
                fontSize: 12,
            }"
            :alpha="0.7"
            :origin="1"
            :x="x + width - 3"
            :y="y + height - 5"
        />
    </Rectangle>
</template>

<script setup lang="ts">
import Phaser, { GameObjects } from 'phaser'
import { computed } from 'vue'
import { FxGlow, Image, Rectangle, Text } from 'phavuer'
import { Colors } from '@/client/colors.ts'
import {
    CARD_IN_HAND_GLOW_INNER_STRENGTH,
    CARD_IN_HAND_GLOW_OUTER_STRENGTH,
} from '@/shared/const/game.ts'
import { edgeOptions } from '@/client/engine/interaction.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { Texture } from '@/client/resources/textures.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { Player } from '@/shared/model/Player.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import Color = Phaser.Display.Color

const props = defineProps<{
    x: number
    y: number
    width: number
    height: number
    color: Color
    player: Player
}>()

const gameState = useGameStateStore()
const players = usePlayersStore()

// The user's Edge, with an engine option for it
const usable = computed(() => props.player == players.selfPlayer && edgeOptions.value.length > 0)

function onTheEdgeCreate(theEdge: GameObjects.Rectangle) {
    theEdge.setInteractive({
        cursor: 'pointer',
    })
}
</script>

<style lang="scss"></style>
