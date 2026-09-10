<template>
    <svg class="discipline-icon">
        <use :href="`#${id}`" />
    </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { disciplineSpriteId } from '@/shared/disciplineIcons.ts'

const props = defineProps<{
    discipline: Discipline
    level: DisciplineLevel
}>()

const id = computed(() => disciplineSpriteId(props.discipline, props.level))
</script>

<style lang="scss">
.discipline-icon {
    // The discipline icons are square ; pinning width to height avoids the
    // large default width an inline <svg> takes when width is left auto.
    height: 1.1em;
    width: 1.1em;
    vertical-align: middle;
}
</style>
