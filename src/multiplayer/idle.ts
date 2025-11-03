import IdleJs from 'idle-js'
import router, { ROUTES } from '@/ui/router.ts'
import { useMultiplayerStore } from '@/store/multiplayer.ts'
import { useBusStore } from '@/store/bus.ts'
import { leaveMultiplayer } from '@/multiplayer/lobby.ts'

const IDLE_TIME = 20 * 60 * 1000 // 20 minutes
const events = ['keydown', 'mousedown', 'scroll', 'touchstart']

const idle = new IdleJs({
    idle: IDLE_TIME,
    events, // events that will trigger the idle resetter
    onIdle, // callback function to be executed after idle time
})

function onIdle() {
    const multiplayer = useMultiplayerStore()
    const bus = useBusStore()

    if (multiplayer.hasJoinedLobby) {
        leaveMultiplayer()
        bus.hasBeenIdle = true
        router.push({ name: ROUTES.MainMenu })
    }
}

export function startIdleMonitoring() {
    idle.start()
}
