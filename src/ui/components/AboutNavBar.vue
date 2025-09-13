<template>
    <div class="about-nav-bar">
        <div class="about-nav-content">
            <RouterLink
                :to="{ name: ROUTES.AboutWhatIsThis }"
                class="nav-heading"
                active-class="active"
            >
                What is it
            </RouterLink>
            <RouterLink
                :to="{ name: ROUTES.AboutRequirements }"
                class="nav-heading"
                active-class="active"
            >
                Requirements
            </RouterLink>
            <RouterLink
                :to="{ name: ROUTES.AboutContribute }"
                class="nav-heading"
                active-class="active"
            >
                Contribute
            </RouterLink>
            <RouterLink
                :to="{ name: ROUTES.AboutCopyright }"
                class="nav-heading"
                active-class="active"
            >
                Copyright
            </RouterLink>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ROUTES } from '@/ui/router.ts'
</script>

<style lang="scss">
.about-nav-bar {
    position: fixed;
    top: $topbar-height;
    left: 0;
    right: 0;
    height: $about-navbar-height;
    z-index: 800;
}

.about-nav-content {
    @include flex-center;
    gap: 3rem;
    padding: 0 2rem;
    width: 100%;
    height: 100%;
}

.nav-heading {
    text-decoration: none;
    color: $ghost-white;
    font-size: 1.2rem;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.2s ease;

    &:hover {
        filter: brightness(125%);
    }
}
</style>
