import { createRouter, createWebHistory } from 'vue-router'
import MainMenu from '@/client/ui/screen/MainMenu.vue'
import Game from '@/client/ui/screen/Game.vue'
import { useCoreStore } from '@/client/store/core.ts'
import About from '@/client/ui/screen/about/About.vue'
import WhatIsThis from '@/client/ui/screen/about/WhatIsThis.vue'
import Requirements from '@/client/ui/screen/about/Requirements.vue'
import Contribute from '@/client/ui/screen/about/Contribute.vue'
import Copyright from '@/client/ui/screen/about/Copyright.vue'
import { leaveGame } from '@/client/state/setup.ts'

export const ROUTES = {
    MainMenu: 'MainMenu',
    About: 'About',
    AboutWhatIsThis: 'AboutWhatIsThis',
    AboutRequirements: 'AboutRequirements',
    AboutContribute: 'AboutContribute',
    AboutCopyright: 'AboutCopyright',
    Game: 'Game',
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
            path: '/game',
            name: ROUTES.Game,
            component: Game,
        },
        {
            // Old links ( the lobby, rooms, availability ) land on the main menu
            path: '/:pathMatch(.*)*',
            redirect: '/',
        },
    ],
})

router.beforeEach((to, from) => {
    const core = useCoreStore()

    // If navigating outside the game
    if (from.name == ROUTES.Game) {
        if (core.gameIsStarted) {
            leaveGame()
        }

        // the game is not started anymore
        core.gameIsStarted = false
    }

    // If trying to access the Game route and game is not started
    if (to.name == ROUTES.Game && !core.gameIsStarted) {
        // Redirect to MainMenu
        return { name: ROUTES.MainMenu }
    }

    // Allow navigation
    return
})

export default router
