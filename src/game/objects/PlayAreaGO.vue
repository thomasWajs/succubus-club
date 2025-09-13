<template>
    <Container ref="playArea">
        <RegionGO
            key="Controlled"
            :x="0"
            :y="0"
            :width="PLAY_AREA_WIDTH"
            :height="CONTROLLED_ZONE_HEIGHT"
            :color="player.color"
            :cardRegion="player.controlled"
        />

        <RegionGO
            key="Torpor"
            :x="0"
            :y="CONTROLLED_ZONE_HEIGHT"
            :width="PLAY_AREA_WIDTH / 2"
            :height="TORPOR_ZONE_HEIGHT"
            :color="player.color"
            :cardRegion="player.torpor"
        />

        <RegionGO
            key="Uncontrolled"
            :x="PLAY_AREA_WIDTH / 2"
            :y="CONTROLLED_ZONE_HEIGHT"
            :width="PLAY_AREA_WIDTH / 2"
            :height="TORPOR_ZONE_HEIGHT"
            :color="player.color"
            :cardRegion="player.uncontrolled"
        />

        <CardStackRegionGO
            key="AshHeap"
            :x="0"
            :y="CARD_STACKS_Y"
            :width="(PLAY_AREA_WIDTH / 8) * 2"
            :height="CARD_STACKS_HEIGHT"
            :color="player.color"
            :cardRegion="player.ashHeap"
            :showTopCard="true"
        />
        <CardStackRegionGO
            key="Library"
            :x="(PLAY_AREA_WIDTH / 8) * 2"
            :y="CARD_STACKS_Y"
            :width="(PLAY_AREA_WIDTH / 8) * 2"
            :height="CARD_STACKS_HEIGHT"
            :color="player.color"
            :cardRegion="player.library"
            :showTopCard="true"
            :draw="player == gameState.selfPlayer ? 'library' : undefined"
        />
        <CardStackRegionGO
            key="Crypt"
            :x="(PLAY_AREA_WIDTH / 8) * 4"
            :y="CARD_STACKS_Y"
            :width="(PLAY_AREA_WIDTH / 8) * 2"
            :height="CARD_STACKS_HEIGHT"
            :color="player.color"
            :cardRegion="player.crypt"
            :showTopCard="true"
            :draw="player == gameState.selfPlayer ? 'crypt' : undefined"
        />
        <CardStackRegionGO
            key="Removed"
            :x="(PLAY_AREA_WIDTH / 8) * 6"
            :y="CARD_STACKS_Y"
            :width="PLAY_AREA_WIDTH / 8"
            :height="CARD_STACKS_HEIGHT"
            :color="player.color"
            :cardRegion="player.removed"
            :showTopCard="false"
        />
        <CardStackRegionGO
            key="Hand"
            :x="(PLAY_AREA_WIDTH / 8) * 7"
            :y="CARD_STACKS_Y"
            :width="PLAY_AREA_WIDTH / 8"
            :height="CARD_STACKS_HEIGHT"
            :color="player.color"
            :cardRegion="player.hand"
            :showTopCard="false"
        />

        <Text
            v-if="player.isOusted"
            key="Ousted"
            :originY="0.4"
            :originX="0.5"
            :x="PLAY_AREA_WIDTH / 2"
            :y="CONTROLLED_ZONE_HEIGHT / 2"
            text="OUSTED"
            :style="{
                color: '#a63446',
                fontSize: '52px',
                fontStyle: 'bold',
            }"
        />
    </Container>
</template>

<script setup lang="ts">
import { Container, Text } from 'phavuer'
import {
    CARD_STACKS_HEIGHT,
    CARD_STACKS_Y,
    CONTROLLED_ZONE_HEIGHT,
    PLAY_AREA_WIDTH,
    TORPOR_ZONE_HEIGHT,
} from '@/game/const.ts'
import RegionGO from '@/game/objects/RegionGO.vue'
import CardStackRegionGO from '@/game/objects/CardStackRegionGO.vue'
import { Player } from '@/model/Player.ts'
import { useGameStateStore } from '@/store/gameState.ts'

defineProps<{
    player: Player
}>()

const gameState = useGameStateStore()
</script>
