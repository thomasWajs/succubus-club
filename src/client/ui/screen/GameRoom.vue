<template>
    <TopBar />

    <div class="game-room-container main-content">
        <div class="game-room-content">
            <CurrentRoom />
        </div>
    </div>
</template>

<script setup lang="ts">
import TopBar from '@/client/ui/components/TopBar.vue'
import CurrentRoom from '@/client/ui/components/CurrentRoom.vue'
</script>

<style lang="scss" scoped>
.game-room-container {
    background: black;
}

.game-room-content {
    @include screen-page;
    display: flex;
    flex-direction: column;
    height: calc(100vh - $topbar-height - 4rem);
    min-height: unset;
    overflow: hidden;
}
</style>
