import { computed } from 'vue'
import { Card, Minion } from '@/shared/model/Card.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'

/**
 * Selection-derived helpers over a source set of cards ( the table selection,
 * the context-menu target, ... ). Broadening the former context-only helper lets
 * the same "single card / single minion / acting minion" logic be shared across
 * the context menu, floating actions, the hand, and more later.
 *
 * `cards` is a getter so the derived computeds stay reactive to the source.
 */
export function useSelection(cards: () => Card[]) {
    const gameState = useGameStateStore()
    const players = usePlayersStore()
    const { actionDeclarationEnabled } = useUIFeatures()

    const firstCard = computed(() => cards()[0])
    const singleCard = computed<Card | null>(() => (cards().length == 1 ? firstCard.value : null))
    const singleMinion = computed<Minion | null>(() =>
        singleCard.value && singleCard.value.isMinion() ? singleCard.value : null,
    )
    // The single selected minion capable of performing an action right now :
    // a controlled unlocked minion, on our turn, with action declaration
    // enabled and nothing else in progress. On the shared Free Table there is
    // no separate Torpor region, so a flipped ( torpor'd ) minion is excluded
    // here instead - only the ready-equivalent case is supported for now.
    const primedMinion = computed<Minion | null>(() => {
        const minion = singleMinion.value
        if (
            minion &&
            actionDeclarationEnabled.value &&
            !gameState.action &&
            !gameState.combat &&
            gameState.activePlayer == players.selfPlayer &&
            !minion.isLocked &&
            minion.isIn.controlled &&
            minion.controller.oid == players.selfPlayer?.oid &&
            (!gameState.isFreeTable || !minion.isFlipped)
        ) {
            return minion
        }
        return null
    })

    return { firstCard, singleCard, singleMinion, primedMinion }
}
