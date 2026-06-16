import IdleJs from 'idle-js'
import router, { ROUTES } from '@/client/ui/router.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { useBusStore } from '@/client/store/bus.ts'
import { leaveMultiplayer } from '@/client/multiplayer/lobby.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { leaveGame } from '@/client/state/setup.ts'

const IDLE_TIME = 20 * 60 * 1000 // 20 minutes
const events = ['keydown', 'mousedown', 'scroll', 'touchstart']

const idle = new IdleJs({
    idle: IDLE_TIME,
    events, // events that will trigger the idle resetter
    onIdle, // callback function to be executed after idle time
})

function onIdle() {
    const core = useCoreStore()
    const multiplayer = useMultiplayerStore()
    const bus = useBusStore()

    bus.hasBeenIdle = true

    if (core.gameIsStarted) {
        leaveGame(true)
    } else if (multiplayer.hasJoinedLobby) {
        leaveMultiplayer()
        router.push({ name: ROUTES.MainMenu })
    }
}

export function startIdleMonitoring() {
    idle.start()
}
