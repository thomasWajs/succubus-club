<template>
    <!-- A real button : bordered, unlike the info tags of the log -->
    <button
        v-if="hasUndo"
        class="undo-button"
        title="Undo ( Backspace )"
        @click.stop="undoLastAction()"
    >
        <Icon name="undo" />
    </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useHistoryStore } from '@/client/store/history.ts'
import { undoLastAction } from '@/client/state/gameMutations.ts'
import Icon from '@/client/ui/components/Icon.vue'
import { GameMutationId } from '@/shared/state/gameMutations.ts'

const { mutationIds } = defineProps<{
    // The mutations of the row
    mutationIds: GameMutationId[]
}>()

const history = useHistoryStore()

// The undo button sits on the last action of the self player that can still be undone
const hasUndo = computed(() => {
    const mutation = history.nextCancellableMutation
    return mutation !== null && mutationIds.includes(mutation.id)
})
</script>

<style lang="scss" scoped>
.undo-button {
    @include icon-button;
    flex-shrink: 0;
    width: 20px;
    height: 18px;
    font-size: 13px;
    color: var(--ui-danger-text);
    border: solid 1px currentColor;
    opacity: 0.8;
    transition: opacity 0.15s ease;

    &:hover {
        opacity: 1;
        background: light-dark(rgba($blood-red, 0.12), rgba($rose-red, 0.15));
    }
}
</style>
