<template>
    <span
        class="ui-icon"
        :style="{ maskImage: iconCssUrl(name) }"
        aria-hidden="true"
    />
</template>

<script setup lang="ts">
import { IconName, iconCssUrl } from '@/client/resources/icons.ts'

defineProps<{
    name: IconName
}>()
</script>

<style lang="scss">
// The SVG file is only a mask : the icon is painted with the text colour, so it follows the theme
// and the hover / disabled states of its parent. Sized in `em` to line up with the text.
.ui-icon {
    display: inline-block;
    flex-shrink: 0;
    width: 1.1em;
    height: 1.1em;
    vertical-align: -0.15em;

    background-color: currentColor;
    mask-position: center;
    mask-repeat: no-repeat;
    mask-size: contain;
}
</style>
