import { computed } from 'vue'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { WorldAlignment } from '@/client/gateway/db.ts'
import { useEngineMode } from '@/client/engine/mode.ts'

export function useUIFeatures() {
    const multiplayer = useMultiplayerStore()
    const core = useCoreStore()
    const gameState = useGameStateStore()
    const { isEngine } = useEngineMode()
    const preferences = computed(() => core.userProfile.preferences)

    const aidsEnabled = computed(() => multiplayer.currentGameRoom?.isCasual ?? true)

    return {
        aidsEnabled,
        worldAlignment: computed(() => preferences.value.worldAlignment ?? WorldAlignment.Center),
        glowInHandEnabled: computed(
            () => aidsEnabled.value && (preferences.value.glowInHand ?? 1) === 1,
        ),
        glowInPlayEnabled: computed(
            () => aidsEnabled.value && (preferences.value.glowInPlay ?? 1) === 1,
        ),
        snapToGrid: computed(
            () => !gameState.isFreeTable && (preferences.value.snapToGrid ?? 1) === 1,
        ),
        alignmentGuidesEnabled: computed(() => (preferences.value.alignmentGuides ?? 1) === 1),
        cardGroupingEnabled: computed(() => (preferences.value.cardGrouping ?? 1) === 1),
        actionDeclarationEnabled: computed(() => (preferences.value.actionDeclaration ?? 1) === 1),
        usageEditorEnabled: computed(() => (preferences.value.usageEditor ?? 1) === 1),
        turnNotificationEnabled: computed(() => (preferences.value.turnNotification ?? 1) === 1),
        showBleedTargetEnabled: computed(() => (preferences.value.showBleedTarget ?? 1) === 1),
        // SC's own controls of the game's course ( turn phases, next turn, editing an action's
        // numbers, discarding at random ) : not when the rules engine runs the game
        manualControlsEnabled: computed(() => !isEngine.value),
        automaticCostPaymentEnabled: computed(
            () => (preferences.value.automaticCostPayment ?? 0) === 1,
        ),
    }
}
