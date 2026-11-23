import * as logging from '@/client/logging.ts'

// Icons are single-colour SVG files in the icons folder next to this file, named after their
// meaning in the game, not after the pack icon : an icon is swapped by replacing its file, with no
// code change.
// Their shapes only count, never their colours : the HTML side paints them with the text colour
// ( see Icon.vue ), the Phaser side tints them ( see CANVAS_ICONS in textures.ts ).
const ICON_NAMES = [
    'burn',
    'camera',
    'chat',
    'disconnected',
    'error',
    'hidden',
    'info',
    'locked',
    'manual',
    'mouse',
    'ousted',
    'pin',
    'ready',
    'remove',
    'save',
    'seat',
    'success',
    'unready',
    'visible',
    'waiting',
    'warning',
] as const

export type IconName = (typeof ICON_NAMES)[number]

// The files are bundled with the code, so an icon never waits for a download when it shows up
// ( a short-lived one, like the pin flash, would be gone before its file loads ).
const iconFiles = import.meta.glob<string>('@/client/resources/icons/*.svg', {
    query: '?raw',
    import: 'default',
    eager: true,
})

const iconSvgs = {} as Record<IconName, string>
const iconCssUrls = {} as Record<IconName, string>
for (const name of ICON_NAMES) {
    const svg = Object.entries(iconFiles).find(([path]) => path.endsWith(`/${name}.svg`))?.[1]
    if (svg === undefined) {
        logging.captureException(new Error(`Icon file missing : ${name}.svg`))
    }
    iconSvgs[name] = svg ?? ''
    // Quoted : encodeURIComponent leaves the parentheses, which would end an unquoted url()
    iconCssUrls[name] = `url("data:image/svg+xml,${encodeURIComponent(iconSvgs[name])}")`
}

export function iconSvg(name: IconName): string {
    return iconSvgs[name]
}

// A CSS url() value, for mask-image
export function iconCssUrl(name: IconName): string {
    return iconCssUrls[name]
}
