import { useGameBusStore } from '@/client/store/bus.ts'
import { computed } from 'vue'
import { Minion } from '@/shared/model/Card.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { useCommands } from '@/client/game/composables/useCommands.ts'

export function useContextSelection() {
    const core = useCoreStore()
    const gameState = useGameStateStore()
    const players = usePlayersStore()
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
        players,
        gameBus,
        commands,
        firstCard,
        singleCard,
        singleMinion,
    }
}
