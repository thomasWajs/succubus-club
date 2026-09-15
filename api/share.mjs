import {
    formatShareLabel,
    getTranslations,
    parseShareParams,
} from '../src/shared/availability/shareLabel.mjs'

// Server-rendered landing for availability share links. The SPA serves the same static
// index.html for every route, so link crawlers ( Discord, WhatsApp, Twitter ) that read
// Open Graph meta from raw HTML would otherwise get a generic, identical unfurl for every
// slot. This function returns per-slot og:*/twitter:* tags for the crawler, and redirects
// a real browser into the SPA ( /availability?... ), whose existing share handling opens
// the slot's roster. Reached via the `/share` rewrite in vercel.json.

// Minimal HTML-attribute/text escaping for values interpolated into the page.
function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}

export async function GET(request) {
    const url = new URL(request.url)
    const { origin, search } = url

    const parsed = parseShareParams(url.searchParams)
    // Malformed link : send the visitor to the availability screen rather than error.
    if (!parsed) {
        return Response.redirect(`${origin}/availability`, 302)
    }

    const label = formatShareLabel(parsed)
    const strings = getTranslations(parsed.lang)

    const title = `${strings.title} - ${label}`
    const description = strings.description
    const canonical = `${origin}/availability${search}`

    // WhatsApp crops the preview to a square, so it gets a logo-only square image ( fmt=sq ) ;
    // Discord / Twitter show the landscape card. The format lives in the image URL so it stays
    // cacheable per-URL ; this HTML varies by user-agent, hence the Vary header below.
    const userAgent = request.headers.get('user-agent') || ''
    const wantsSquare = userAgent.includes('WhatsApp')
    const imageUrl = `${origin}/api/shareImage${search}${wantsSquare ? '&fmt=sq' : ''}`
    const imageWidth = wantsSquare ? 800 : 1200
    const imageHeight = 800

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:url" content="${escapeHtml(canonical)}" />
<meta property="og:image" content="${escapeHtml(imageUrl)}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="${imageWidth}" />
<meta property="og:image:height" content="${imageHeight}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
<meta http-equiv="refresh" content="0; url=${escapeHtml(canonical)}" />
<script>window.location.replace(${JSON.stringify(canonical)})</script>
</head>
<body>
<p>Redirecting to <a href="${escapeHtml(canonical)}">Succubus Club</a>...</p>
</body>
</html>`

    return new Response(html, {
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'public, s-maxage=86400',
            // The og:image ( square vs landscape ) depends on the crawler, so cache per UA.
            vary: 'User-Agent',
        },
    })
}
