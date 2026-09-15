import { createRouter, createWebHistory } from 'vue-router'
import MainMenu from '@/client/ui/screen/MainMenu.vue'
import Lobby from '@/client/ui/screen/Lobby.vue'
import GameRoom from '@/client/ui/screen/GameRoom.vue'
import Game from '@/client/ui/screen/Game.vue'
import PlayerAvailability from '@/client/ui/screen/PlayerAvailability.vue'
import { useCoreStore } from '@/client/store/core.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import About from '@/client/ui/screen/about/About.vue'
import WhatIsThis from '@/client/ui/screen/about/WhatIsThis.vue'
import Requirements from '@/client/ui/screen/about/Requirements.vue'
import Contribute from '@/client/ui/screen/about/Contribute.vue'
import Copyright from '@/client/ui/screen/about/Copyright.vue'
import { leaveMultiplayer } from '@/client/multiplayer/lobby.ts'
import { leaveGameRoom } from '@/client/multiplayer/room.ts'
import { leaveGame } from '@/client/state/setup.ts'

export const ROUTES = {
    MainMenu: 'MainMenu',
    About: 'About',
    AboutWhatIsThis: 'AboutWhatIsThis',
    AboutRequirements: 'AboutRequirements',
    AboutContribute: 'AboutContribute',
    AboutCopyright: 'AboutCopyright',
    Lobby: 'Lobby',
    GameRoom: 'GameRoom',
    Game: 'Game',
    PlayerAvailability: 'PlayerAvailability',
} as const

const router = createRouter({
    history: createWebHistory(),
    scrollBehavior() {
        // always scroll to top
        return { top: 0 }
    },
    routes: [
        {
            path: '/',
            name: ROUTES.MainMenu,
            component: MainMenu,
        },
        {
            path: '/about',
            name: ROUTES.About,
            component: About,
            redirect: '/about/what-is-this',
            children: [
                {
                    path: 'what-is-this',
                    name: ROUTES.AboutWhatIsThis,
                    component: WhatIsThis,
                },
                {
                    path: 'requirements',
                    name: ROUTES.AboutRequirements,
                    component: Requirements,
                },
                {
                    path: 'contribute',
                    name: ROUTES.AboutContribute,
                    component: Contribute,
                },
                {
                    path: 'copyright',
                    name: ROUTES.AboutCopyright,
                    component: Copyright,
                },
            ],
        },

        {
            // Public : reachable standalone from a shared availability link, and
            // from the lobby / top bar. No lobby-joined guard.
            path: '/availability',
            name: ROUTES.PlayerAvailability,
            component: PlayerAvailability,
        },
        {
            path: '/lobby',
            name: ROUTES.Lobby,
            component: Lobby,
        },
        {
            path: '/lobby/room/:roomId',
            name: ROUTES.GameRoom,
            component: GameRoom,
        },
        {
            path: '/game',
            name: ROUTES.Game,
            component: Game,
        },
    ],
})

router.beforeEach((to, from) => {
    const core = useCoreStore()
    const multiplayer = useMultiplayerStore()

    let leavingGame = false

    // If navigating outside the game
    if (from.name == ROUTES.Game) {
        leavingGame = true

        if (core.gameIsStarted) {
            leaveGame()
        } else if (multiplayer.hasJoinedLobby) {
            leaveMultiplayer()
        }

        // the game is not started anymore
        core.gameIsStarted = false
    }

    // If leaving the game room ( but not to connect into the started game ),
    // drop out of the room. Covers the Leave button, the browser back button
    // and clicking away through the top bar.
    if (from.name == ROUTES.GameRoom && to.name != ROUTES.Game) {
        if (multiplayer.currentGameRoomId) {
            leaveGameRoom()
        }
    }

    // If trying to access the Game route and game is not started
    if (to.name == ROUTES.Game && !core.gameIsStarted) {
        // Redirect to MainMenu
        return { name: ROUTES.MainMenu }
    }

    // If trying to access the Lobby route and lobby is not joined
    if (to.name === ROUTES.Lobby && (!multiplayer.hasJoinedLobby || leavingGame)) {
        // Redirect to MainMenu
        return { name: ROUTES.MainMenu }
    }

    // The game room needs both a joined lobby and a current room. Without a room
    // ( e.g. a direct URL or a page refresh ) fall back to the lobby or main menu.
    if (to.name === ROUTES.GameRoom) {
        if (!multiplayer.hasJoinedLobby || leavingGame) {
            return { name: ROUTES.MainMenu }
        }
        if (!multiplayer.currentGameRoomId) {
            return { name: ROUTES.Lobby }
        }
    }

    // Allow navigation
    return
})

export default router
