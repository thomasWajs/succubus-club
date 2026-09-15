import { ImageResponse } from '@vercel/og'
import {
    formatShareLabel,
    getTranslations,
    parseShareParams,
} from '../src/shared/availability/shareLabel.mjs'

// Generates the Open Graph preview image for an availability share link, referenced as
// og:image by api/share.mjs. Rendered at request time from the slot's query params via
// @vercel/og ( Satori ). Two formats : a 1200x800 landscape card ( title + logo + date )
// for Discord / Twitter, and, when fmt=sq, an 800x800 logo-only card for WhatsApp, which
// crops previews to a square.
//
// Runs on the default ( Node ) runtime, using the same Web-standard GET(request) handler as
// the other api/*.mjs functions. @vercel/og is pinned to 0.11.1 on purpose : 1.x pulls in
// satori -> harfbuzzjs, whose wasm loader does a dynamic require("fs") that crashes under
// Vercel's ESM bundling ( "Dynamic require of fs is not supported" ). 0.11.1 predates that
// dependency and works on Node without the edge runtime.

// Satori accepts React-element-shaped plain objects, so the card is built without JSX
// ( these .mjs functions are not JSX-compiled ). Every container with multiple children
// declares display:flex, which Satori requires.
function el(type, style, children) {
    return { type, props: { style, children } }
}

// Purple accent, matching the app theme ( src/client/styles/_variables.scss ) and the
// neon-purple welcome sign, over a black background. No round borders / shadows, in
// keeping with the site style.
const BACKGROUND = '#000000'
const ACCENT = '#8c45ff'
const TEXT = '#ece8f2'

// Fetches the welcome sign from the deployment's own static assets and inlines it as a
// data URI, so Satori can embed it without relying on remote image fetching. Returns null
// on any failure, in which case the card renders without the logo.
async function loadLogo(origin) {
    try {
        const response = await fetch(`${origin}/assets/welcomeSign.png`)
        if (!response.ok) {
            return null
        }
        const base64 = Buffer.from(await response.arrayBuffer()).toString('base64')
        return `data:image/png;base64,${base64}`
    } catch {
        return null
    }
}

// An img element for the welcome sign, or an empty spacer when it could not be loaded.
function logoElement(logo, size, marginBottom) {
    if (!logo) {
        return el('div', { display: 'flex' }, '')
    }
    return {
        type: 'img',
        props: { src: logo, width: size, height: size, style: { display: 'flex', marginBottom } },
    }
}

// WhatsApp crops the preview to a square : give it a big, centered, logo-only card so the
// crop stays legible with no tiny text.
function squareTree(logo) {
    return el(
        'div',
        {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            background: BACKGROUND,
        },
        [logoElement(logo, 660, '0px')],
    )
}

// Discord / Twitter show the full landscape : title, logo and date stacked and centered.
function landscapeTree(logo, strings, label) {
    return el(
        'div',
        {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            width: '100%',
            height: '100%',
            padding: '50px',
            background: BACKGROUND,
            color: TEXT,
            fontFamily: 'serif',
        },
        [
            el(
                'div',
                {
                    display: 'flex',
                    fontSize: '70px',
                    color: ACCENT,
                    lineHeight: '1.15',
                    maxWidth: '1080px',
                    textAlign: 'center',
                    marginBottom: '25px',
                },
                strings.title,
            ),
            logoElement(logo, 450, '25px'),
            el(
                'div',
                {
                    display: 'flex',
                    fontSize: '58px',
                    lineHeight: '1.2',
                    maxWidth: '1080px',
                    textAlign: 'center',
                },
                label,
            ),
        ],
    )
}

export async function GET(request) {
    const url = new URL(request.url)
    const parsed = parseShareParams(url.searchParams)
    const square = url.searchParams.get('fmt') === 'sq'

    const logo = await loadLogo(url.origin)

    if (square) {
        return new ImageResponse(squareTree(logo), {
            width: 800,
            height: 800,
            headers: { 'cache-control': 'public, s-maxage=86400' },
        })
    }

    const strings = getTranslations(parsed ? parsed.lang : 'en')
    const label = parsed ? formatShareLabel(parsed) : ''

    return new ImageResponse(landscapeTree(logo, strings, label), {
        width: 1200,
        height: 800,
        headers: { 'cache-control': 'public, s-maxage=86400' },
    })
}
