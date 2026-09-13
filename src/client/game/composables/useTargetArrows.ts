import { ref, watch, watchEffect } from 'vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import { isBleed } from '@/shared/state/minionActions.ts'
import { Arrow, TargetDeclaration } from '@/shared/types/state.ts'
import { CardOid, PlayerOid, Point2D } from '@/shared/types/model.ts'

/**
 * Computes the arrows to draw : the target currently being declared ( from
 * the origin to the pointer ), and every already-declared target. Shared by
 * Tabletop.vue and FreeTable.vue, which both register cards/players onto
 * `gameBus.cardsInGame` / `gameBus.playersInGame` the same way.
 *
 * `extraDeps`, if given, is watched ( deep ) in addition to the reactive state
 * already tracked by the internal watchEffect : Tabletop.vue needs this for
 * `playerSeats`, which repositions play areas without changing any tracked
 * game state.
 */
export function useTargetArrows(extraDeps?: () => unknown) {
    const gameBus = useGameBusStore()
    const gameState = useGameStateStore()
    const { showBleedTargetEnabled } = useUIFeatures()

    function getWorldPosition(objectId?: CardOid | PlayerOid): Point2D | null {
        if (!objectId) {
            return null
        }

        if (objectId in gameBus.cardsInGame) {
            return gameBus.cardsInGame[objectId].getWorldPosition()
        }

        if (objectId in gameBus.playersInGame) {
            const pos = gameBus.playersInGame[objectId].getWorldPosition()
            // The arrow land at the bottom of the pool diamond,
            // so as to not hide the pool count.
            if (pos) {
                pos.y += 10
            }
            return pos
        }

        return null
    }

    // When the "Show bleed target" preference is off, hide the arrow pointing at
    // the target of a declared bleed action.
    function isHiddenBleedTarget(tg: TargetDeclaration): boolean {
        if (showBleedTargetEnabled.value) {
            return false
        }
        const minionAction = gameState.action?.minionAction
        if (!minionAction || !isBleed(minionAction)) {
            return false
        }
        return tg.targetOid === minionAction.target?.oid
    }

    const arrows = ref<Arrow[]>([])
    function computeArrows() {
        const _arrows = [
            // The current declarating target, if any
            {
                from: getWorldPosition(gameBus.declaringTargetOrigin?.oid),
                to: {
                    x: gameBus.pointerPosition?.x ?? 0,
                    y: gameBus.pointerPosition?.y ?? 0,
                },
            },
            // The already declared targets
            ...gameState.targetDeclarations
                .filter(tg => !isHiddenBleedTarget(tg))
                .map(tg => {
                    return {
                        from: getWorldPosition(tg.originOid),
                        to: getWorldPosition(tg.targetOid),
                    }
                }),
        ]
        arrows.value = _arrows.filter(arrow => arrow.from && arrow.to) as Arrow[]
    }

    watchEffect(computeArrows)
    // watchEffect doesn't know it needs to recompute when extraDeps changes
    // the relevant game objects' positions ( e.g. playerSeats in standard mode ).
    if (extraDeps) {
        watch(extraDeps, computeArrows, { deep: true })
    }

    return { arrows }
}
