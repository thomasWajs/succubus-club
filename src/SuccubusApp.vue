<template>
    <Alert />
    <UserProfilePanel />
    <DeckPanel />
    <SavedGamesPanel />

    <div
        v-show="isLoading"
        id="LoadingBackground"
    />

    <router-view />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Alert from '@/ui/components/Alert.vue'
import DeckPanel from '@/ui/components/DeckPanel.vue'
import UserProfilePanel from '@/ui/components/UserProfilePanel.vue'
import SavedGamesPanel from '@/ui/components/SavedGamesPanel.vue'
import { useRoute } from 'vue-router'
import { useCoreStore } from '@/store/core.ts'
import { ROUTES } from '@/ui/router.ts'

const core = useCoreStore()
const route = useRoute()

const isLoading = computed(() => {
    return route?.name == ROUTES.Game && !core.gameIsReady
})
</script>

<style lang="scss" scoped>
// Preloading with a <link rel="preload"> make the browser complains.
// Using the Prefetch alone ( <link rel="prefetch"> ) incurs too much delay when displaying the background.
// This is a trick to ensure the background is already available when the loading screen appears.
// We set it on all the pages, but it will be visible only during loading.
#LoadingBackground {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;

    background-image: url('/assets/tabletopBackground.jpg');
    background-color: rgba($shadow-grey, 0.7);
    background-blend-mode: multiply;

    z-index: 999;
}
</style>
