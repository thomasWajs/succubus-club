import { RIGHT_COLUMN_WIDTH, WORLD_HEIGHT, WORLD_WIDTH } from '@/game/const.ts'
import { reactive } from 'vue'

function getDisplay() {
    // 1578px
    const targetWidth = WORLD_WIDTH
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
