import { RIGHT_COLUMN_WIDTH, WORLD_HEIGHT, WORLD_WIDTH } from '@/game/const.ts'
import { reactive } from 'vue'

export const MIN_WIDTH_TO_PLAY = 1280
export const MIN_HEIGHT_TO_PLAY = 720

export const screenBigEnough =
    screen.width >= MIN_WIDTH_TO_PLAY && screen.height >= MIN_HEIGHT_TO_PLAY

function getDisplay() {
    const targetWidth = WORLD_WIDTH // 1578px
    const actualWidth = window.innerWidth - RIGHT_COLUMN_WIDTH

    const targetHeight = WORLD_HEIGHT
    const actualHeight = window.innerHeight

    const horizontalScale = actualWidth / targetWidth
    const verticalScale = actualHeight / targetHeight

    const scale = Math.min(horizontalScale, verticalScale)

    return {
        targetWidth,
        actualWidth,
        targetHeight,
        actualHeight,
        horizontalScale,
        verticalScale,
        scale,
    }
}

export const display = reactive(getDisplay())

window.addEventListener('resize', () => {
    Object.assign(display, getDisplay())
})
