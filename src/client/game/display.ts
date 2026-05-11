import { HD_WIDTH, RIGHT_COLUMN_WIDTH, WORLD_HEIGHT, WORLD_WIDTH } from '@/shared/const/game.ts'
import { reactive, watchEffect } from 'vue'
import { useGameBusStore } from '@/client/store/bus.ts'

export const MIN_WIDTH_TO_PLAY = 1280
export const MIN_HEIGHT_TO_PLAY = 720

export const screenBigEnough =
    screen.width >= MIN_WIDTH_TO_PLAY && screen.height >= MIN_HEIGHT_TO_PLAY

export const display = reactive({} as ReturnType<typeof getDisplay>)

function getDisplay() {
    const gameBus = useGameBusStore()
    const rightColumnVisible = !gameBus.focusMode

    const targetWidth = rightColumnVisible ? WORLD_WIDTH : HD_WIDTH
    const actualWidth = window.innerWidth - (rightColumnVisible ? RIGHT_COLUMN_WIDTH : 0)
    const targetHeight = WORLD_HEIGHT
    const actualHeight = window.innerHeight

    const horizontalScale = actualWidth / targetWidth
    const verticalScale = actualHeight / targetHeight

    const scale = Math.min(horizontalScale, verticalScale)

    const verticalSpaceAvailable = actualHeight - WORLD_HEIGHT * scale
    const horizontalSpaceAvailable = actualWidth - WORLD_WIDTH * scale
    const horizontalPadding = Math.min(horizontalSpaceAvailable / 2, 20)

    return {
        rightColumnVisible,
        targetWidth,
        actualWidth,
        targetHeight,
        actualHeight,
        horizontalScale,
        verticalScale,
        scale,
        verticalSpaceAvailable,
        horizontalSpaceAvailable,
        horizontalPadding,
    }
}

export function setupDisplayWatcher() {
    watchEffect(() => {
        Object.assign(display, getDisplay())
    })

    window.addEventListener('resize', () => {
        Object.assign(display, getDisplay())
    })
}

export const isCrawler = () => {
    const userAgent = navigator.userAgent.toLowerCase()

    const crawlers = [
        'bot',
        'crawler',
        'spider',
        'slurp',
        'facebookexternalhit',
        'whatsapp',
        'chatgpt',
        'anthropic-ai',
    ]

    return crawlers.some(crawler => userAgent.includes(crawler))
}
