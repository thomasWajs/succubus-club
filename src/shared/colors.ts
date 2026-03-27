function parseRgba(input: string) {
    const match = input
        .trim()
        .match(
            /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9]*\.?[0-9]+))?\s*\)$/i,
        )

    if (!match) {
        throw new Error(`Invalid rgba color: ${input}`)
    }

    const r = Number(match[1])
    const g = Number(match[2])
    const b = Number(match[3])
    const a = match[4] !== undefined ? Number(match[4]) : 1

    return { r, g, b, a }
}

function rgbToHsl(r: number, g: number, b: number) {
    r /= 255
    g /= 255
    b /= 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2

    if (max === min) {
        return { h: 0, s: 0, l }
    }

    const d = max - min
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    let h = 0
    switch (max) {
        case r:
            h = (g - b) / d + (g < b ? 6 : 0)
            break
        case g:
            h = (b - r) / d + 2
            break
        case b:
            h = (r - g) / d + 4
            break
    }

    h /= 6
    return { h, s, l }
}

function hslToRgb(h: number, s: number, l: number) {
    const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1
        if (t > 1) t -= 1
        if (t < 1 / 6) return p + (q - p) * 6 * t
        if (t < 1 / 2) return q
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
        return p
    }

    let r: number, g: number, b: number

    if (s === 0) {
        r = g = b = l
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s
        const p = 2 * l - q
        r = hue2rgb(p, q, h + 1 / 3)
        g = hue2rgb(p, q, h)
        b = hue2rgb(p, q, h - 1 / 3)
    }

    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255),
    }
}

export function getAuthorColorRgba(color: string) {
    const { r, g, b, a } = parseRgba(color)
    const hsl = rgbToHsl(r, g, b)

    // Equivalent to Phaser.Color.lighten(50)
    hsl.l = Math.min(1, hsl.l + 0.5)
    // Equivalent to Phaser.Color.desaturate(50)
    hsl.s = Math.max(0, hsl.s * 0.5)

    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l)
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`
}
