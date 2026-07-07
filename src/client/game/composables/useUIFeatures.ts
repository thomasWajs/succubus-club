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
            () => aidsEnabled.value && (preferences.value.glowInHand ?? true),
        ),
        glowInPlayEnabled: computed(
            () => aidsEnabled.value && (preferences.value.glowInPlay ?? true),
        ),
        alignmentGuidesEnabled: computed(() => preferences.value.alignmentGuides ?? true),
        cardGroupingEnabled: computed(() => preferences.value.cardGrouping ?? true),
        actionDeclarationEnabled: computed(() => preferences.value.actionDeclaration ?? true),
        turnNotificationEnabled: computed(() => (preferences.value.turnNotification ?? 1) === 1),
    }
}
