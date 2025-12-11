import { useGameBusStore } from '@/store/bus.ts'
import { computed } from 'vue'
import { Minion } from '@/model/Card.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { useCoreStore } from '@/store/core.ts'
import { useCommands } from '@/game/composables/useCommands.ts'

export function useContextSelection() {
    const core = useCoreStore()
    const gameState = useGameStateStore()
    const gameBus = useGameBusStore()
    const commands = useCommands()

    const firstCard = computed(() => gameBus.contextMenu.cards[0])
    const singleCard = computed(() =>
        gameBus.contextMenu.cards.length == 1 ? firstCard.value : null,
    )
    const singleMinion = computed<Minion | null>(() =>
        singleCard.value && singleCard.value.isMinion() ? singleCard.value : null,
    )

    return {
        core,
        gameState,
        gameBus,
        commands,
        firstCard,
        singleCard,
        singleMinion,
    }
}
