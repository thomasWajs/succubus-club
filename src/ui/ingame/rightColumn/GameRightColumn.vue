<template>
    <div id="GameRightColumn">
        <div id="CloseUp">
            <img
                v-if="gameBus.closeUpCardImage"
                :src="gameBus.closeUpCardImage"
            />
            <img
                v-else
                src="/assets/cardbackLibrary.webp"
            />
        </div>

        <RightColumnPlayers />
        <RightColumnTabs />
    </div>
</template>

<script setup lang="ts">
import { useGameBusStore } from '@/store/bus.ts'
import RightColumnPlayers from '@/ui/ingame/rightColumn/RightColumnPlayers.vue'
import RightColumnTabs from '@/ui/ingame/rightColumn/RightColumnTabs.vue'

const gameBus = useGameBusStore()
</script>

<style lang="scss" scoped>
$closeup-width: $right-column-width;
$closeup-height: 478px;

#GameRightColumn {
    width: $right-column-width;
    height: 100vh;

    background-color: $purple-grey;
    border-left: solid 4px $purple-grey;
    display: flex;
    flex-direction: column;
}

#CloseUp {
    width: $closeup-width;
    height: $closeup-height;
    max-width: $closeup-width;
    max-height: $closeup-height;
    min-width: $closeup-width;
    min-height: $closeup-height;
    margin: 0;
    padding: 0;
    overflow: hidden;

    img {
        object-fit: none;
        width: $closeup-width;
        height: $closeup-height;
        max-width: $closeup-width;
        max-height: $closeup-height;
        min-width: $closeup-width;
        min-height: $closeup-height;
    }
}
</style>
