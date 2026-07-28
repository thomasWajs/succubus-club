import {
    CARD_HEIGHT,
    CARD_WIDTH,
    HD_WIDTH,
    RIGHT_COLUMN_WIDTH,
    WORLD_HEIGHT,
    WORLD_WIDTH,
} from '@/shared/const/game.ts'
import { reactive, watchEffect } from 'vue'
import { useGameBusStore } from '@/client/store/bus.ts'

export const MIN_WIDTH_TO_PLAY = 1280
export const MIN_HEIGHT_TO_PLAY = 720

export const screenBigEnough =
    screen.width >= MIN_WIDTH_TO_PLAY && screen.height >= MIN_HEIGHT_TO_PLAY

export const display = reactive({} as ReturnType<typeof getDisplay>)

/**
 * User-resizable layout dimensions.
 *
 * The right column width and the close-up card zone height can be dragged by
 * the user. Both are persisted to localStorage and read reactively so that
 * `getDisplay()` (and therefore the Phaser world scale/camera) stays in sync.
 */

// The right column has a 4px left border ; box-sizing is border-box, so the
// stored width is the total occupied width, consistent with `actualWidth`.
const RIGHT_COLUMN_BORDER = 4
// Portrait card ratio ( width / height ). The close-up image fills the column
// width, so past `width / CARD_ASPECT` it can't grow further : that's the max.
const CARD_ASPECT = CARD_WIDTH / CARD_HEIGHT

export const RIGHT_COLUMN_MIN_WIDTH = 260
export const RIGHT_COLUMN_MAX_WIDTH = 800
export const CLOSE_UP_MIN_HEIGHT = 120

const RIGHT_COLUMN_WIDTH_STORAGE_KEY = 'layout-right-column-width'
const CLOSE_UP_HEIGHT_STORAGE_KEY = 'layout-close-up-height'

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max)
}

function loadStoredNumber(key: string, fallback: number) {
    const stored = localStorage.getItem(key)
    if (stored === null) {
        return fallback
    }
    const parsed = Number(stored)
    return Number.isFinite(parsed) ? parsed : fallback
}

export const layout = reactive({
    rightColumnWidth: clamp(
        loadStoredNumber(RIGHT_COLUMN_WIDTH_STORAGE_KEY, RIGHT_COLUMN_WIDTH),
        RIGHT_COLUMN_MIN_WIDTH,
        RIGHT_COLUMN_MAX_WIDTH,
    ),
    closeUpHeight: 0,
})

export function closeUpMaxHeight() {
    return Math.round((layout.rightColumnWidth - RIGHT_COLUMN_BORDER) / CARD_ASPECT)
}

export function setRightColumnWidth(width: number) {
    layout.rightColumnWidth = clamp(width, RIGHT_COLUMN_MIN_WIDTH, RIGHT_COLUMN_MAX_WIDTH)
    localStorage.setItem(RIGHT_COLUMN_WIDTH_STORAGE_KEY, String(layout.rightColumnWidth))
    // The close-up max height depends on the column width, so re-clamp it.
    setCloseUpHeight(layout.closeUpHeight)
}

export function setCloseUpHeight(height: number) {
    layout.closeUpHeight = clamp(height, CLOSE_UP_MIN_HEIGHT, closeUpMaxHeight())
    localStorage.setItem(CLOSE_UP_HEIGHT_STORAGE_KEY, String(layout.closeUpHeight))
}

export function resetRightColumnWidth() {
    setRightColumnWidth(RIGHT_COLUMN_WIDTH)
}

export function resetCloseUpHeight() {
    // Default = the tallest the card can be at the current column width.
    setCloseUpHeight(closeUpMaxHeight())
}

export function resetLayout() {
    resetRightColumnWidth()
    resetCloseUpHeight()
}

// Initialize the close-up height from storage ( defaulting to the max height
// for the current width ) and clamp it against the current column width.
setCloseUpHeight(loadStoredNumber(CLOSE_UP_HEIGHT_STORAGE_KEY, closeUpMaxHeight()))

function getDisplay() {
    const gameBus = useGameBusStore()
    const rightColumnVisible = !gameBus.focusMode

    const targetWidth = rightColumnVisible ? WORLD_WIDTH : HD_WIDTH
    const actualWidth = window.innerWidth - (rightColumnVisible ? layout.rightColumnWidth : 0)
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
