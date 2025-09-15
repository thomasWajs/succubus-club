<template>
    <TopBar />
    <AboutNavBar />

    <div id="About">
        <RouterView />
    </div>
</template>

<script setup lang="ts">
import TopBar from '@/ui/components/TopBar.vue'
import AboutNavBar from '@/ui/components/AboutNavBar.vue'
</script>

<style lang="scss">
#About {
    padding: calc($topbar-height + $about-navbar-height) 20px 0 20px;
}

.about-panel {
    @include panel;

    max-width: 800px;
    margin: 1.5rem auto;
    padding: 2rem;
    font-size: 1.1rem;
    line-height: 1.6;

    h1 {
        margin-top: 0;
        margin-bottom: 1rem;
    }
}
</style>
