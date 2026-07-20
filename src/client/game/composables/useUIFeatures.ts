import { computed } from 'vue'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { WorldAlignment } from '@/client/gateway/db.ts'

export function useUIFeatures() {
    const multiplayer = useMultiplayerStore()
    const core = useCoreStore()
    const preferences = computed(() => core.userProfile.preferences)

    const aidsEnabled = computed(() => multiplayer.currentGameRoom?.enableAids ?? true)

    return {
        aidsEnabled,
        worldAlignment: computed(() => preferences.value.worldAlignment ?? WorldAlignment.Center),
        glowInHandEnabled: computed(
            () => aidsEnabled.value && (preferences.value.glowInHand ?? 1) === 1,
        ),
        glowInPlayEnabled: computed(
            () => aidsEnabled.value && (preferences.value.glowInPlay ?? 1) === 1,
        ),
        snapToGrid: computed(() => (preferences.value.snapToGrid ?? 1) === 1),
        alignmentGuidesEnabled: computed(() => (preferences.value.alignmentGuides ?? 1) === 1),
        cardGroupingEnabled: computed(() => (preferences.value.cardGrouping ?? 1) === 1),
        actionDeclarationEnabled: computed(() => (preferences.value.actionDeclaration ?? 1) === 1),
        turnNotificationEnabled: computed(() => (preferences.value.turnNotification ?? 1) === 1),
    }
}
