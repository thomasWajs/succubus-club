<template>
    <div class="central-panel">
        <span
            v-if="title"
            class="central-panel-title"
        >
            {{ title }}
        </span>
        <slot />
    </div>
</template>

<script setup lang="ts">
/**
 * Shared surface for anything shown in the central box.
 *
 * Owning the chrome ( background, border, padding, title, appear animation ) in
 * one place is what keeps the central panels visually consistent. Panels bring
 * their own inner layout and typography ; they should not redefine the surface.
 *
 * - `title` renders a consistent heading above the content.
 *
 * Every panel spans the full width of the central box so that stacked panels
 * share the same left / right edges. Content is centered inside by default ;
 * a panel that needs to lay itself out edge-to-edge ( like the action infos )
 * overrides `align-items` on its own root.
 *
 * This is dumb chrome : deciding whether there is anything to show is the
 * caller's job. Only render a CentralPanel when its content is non-empty,
 * otherwise it appears as an empty bordered box.
 */
defineProps<{
    title?: string
}>()
</script>

<style lang="scss">
.central-panel {
    // Full width so stacked panels share the same left / right edges. box-sizing
    // keeps padding + border inside that width, so it never overflows the box.
    box-sizing: border-box;
    align-self: stretch;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1.5rem;

    color: $shadow-grey;
    background: rgba($pearl-grey, 0.7);
    border: solid 1px $shadow-grey;

    animation: CentralPanelAppear 0.25s ease-out;

    .central-panel-title {
        font-weight: bold;
        text-align: center;
    }
}

@keyframes CentralPanelAppear {
    0% {
        opacity: 0;
        transform: translateY(-4px);
    }
    100% {
        opacity: 1;
        transform: translateY(0);
    }
}
</style>
