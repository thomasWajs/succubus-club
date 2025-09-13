import { createRouter, createWebHistory } from 'vue-router'
import MainMenu from '@/ui/screen/MainMenu.vue'
import Lobby from '@/ui/screen/Lobby.vue'
import Game from '@/ui/screen/Game.vue'
import { useCoreStore } from '@/store/core.ts'
import { useMultiplayerStore } from '@/store/multiplayer.ts'
import About from '@/ui/screen/about/About.vue'
import WhatIsThis from '@/ui/screen/about/WhatIsThis.vue'
import Requirements from '@/ui/screen/about/Requirements.vue'
import Contribute from '@/ui/screen/about/Contribute.vue'
import Copyright from '@/ui/screen/about/Copyright.vue'
import { leaveLobby } from '@/multiplayer/lobby.ts'

export const ROUTES = {
    MainMenu: 'MainMenu',
    About: 'About',
    AboutWhatIsThis: 'AboutWhatIsThis',
    AboutRequirements: 'AboutRequirements',
    AboutContribute: 'AboutContribute',
    AboutCopyright: 'AboutCopyright',
    Lobby: 'Lobby',
    Game: 'Game',
} as const

const router = createRouter({
    history: createWebHistory(),
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
            path: '/lobby',
            name: ROUTES.Lobby,
            component: Lobby,
        },
        {
            path: '/game',
            name: ROUTES.Game,
            component: Game,
        },
    ],
})

router.beforeEach((to, from) => {
    const coreStore = useCoreStore()
    const multiplayerStore = useMultiplayerStore()

    // If navigating outside the game
    if (from.name == ROUTES.Game) {
        // the game is not started anymore
        coreStore.gameIsStarted = false

        // If the user is in the lobby, leave it
        if (multiplayerStore.hasJoinedLobby) {
            leaveLobby()
        }
    }

    // If trying to access the Game route and game is not started
    if (to.name == ROUTES.Game && !coreStore.gameIsStarted) {
        // Redirect to MainMenu
        return { name: ROUTES.MainMenu }
    }

    // If trying to access the Lobby route and lobby is not joined
    if (to.name === ROUTES.Lobby && !multiplayerStore.hasJoinedLobby) {
        // Redirect to MainMenu
        return { name: ROUTES.MainMenu }
    }

    // Allow navigation
    return
})

export default router
