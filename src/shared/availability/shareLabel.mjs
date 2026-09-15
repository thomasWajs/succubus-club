// Server-side helpers for the availability share links. Shared by the two Vercel
// functions ( api/share.mjs, api/shareImage.mjs ) so the preview title and image agree
// on a single formatting. This mirrors the intent of formatSlotLabel in
// src/client/gateway/availabilityTime.ts, but stays plain .mjs with no bundler alias,
// and renders in the sharer's embedded timezone rather than the browser's local one.

const MINUTES_PER_WEEK = 10080

// Whether the value is a finite number once coerced ; used to validate query params.
function parseNumber(raw) {
    if (raw === null || raw === undefined || raw === '') {
        return null
    }
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
}

// Parses the self-contained share params ( same shape as the client's encodeSharedSlot )
// into a plain descriptor, or null when they are absent or malformed.
export function parseShareParams(searchParams) {
    if (searchParams.get('share') !== '1') {
        return null
    }

    const lang = searchParams.get('lang')
    if (!lang) {
        return null
    }

    const tz = searchParams.get('tz') || 'UTC'
    const recurrence = searchParams.get('rec')

    if (recurrence === 'weekly') {
        const startMinuteOfWeekUtc = parseNumber(searchParams.get('sw'))
        const endMinuteOfWeekUtc = parseNumber(searchParams.get('ew'))
        if (startMinuteOfWeekUtc === null || endMinuteOfWeekUtc === null) {
            return null
        }
        // Optional : the absolute epoch of the next occurrence, stamped by the client at
        // share time ( see encodeSharedSlot ). When present the preview shows that exact
        // date ; it also makes the URL change each week, busting the crawlers' caches.
        const occurrenceUtc = parseNumber(searchParams.get('occ'))
        return { lang, tz, recurrence, startMinuteOfWeekUtc, endMinuteOfWeekUtc, occurrenceUtc }
    }

    if (recurrence === 'once') {
        const startUtc = parseNumber(searchParams.get('su'))
        const endUtc = parseNumber(searchParams.get('eu'))
        if (startUtc === null || endUtc === null) {
            return null
        }
        return { lang, tz, recurrence, startUtc, endUtc }
    }

    return null
}

// Monday 00:00 UTC of the current week, as epoch ms. Weekly slots are stored as a UTC
// minute-of-week ( Monday 00:00 UTC = 0 ), so we anchor them to this instant to get a
// concrete date to format.
function startOfUtcWeek(now) {
    const mondayIndex = (now.getUTCDay() + 6) % 7
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayIndex)
}

// Builds a Intl.DateTimeFormat for the given timezone ( and optional locale ), falling
// back to UTC when the timezone string is invalid ( a bad or spoofed `tz` param ).
function formatterFor(tz, options, locale) {
    try {
        return new Intl.DateTimeFormat(locale, { ...options, timeZone: tz })
    } catch {
        return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' })
    }
}

function formatTime(epoch, tz) {
    return formatterFor(tz, { hour: '2-digit', minute: '2-digit', hour12: false }).format(epoch)
}

// The timezone abbreviation ( e.g. "CEST", "UTC" ) for the given instant, extracted from
// the formatted parts.
function timeZoneAbbreviation(epoch, tz) {
    const parts = formatterFor(tz, { timeZoneName: 'short' }).formatToParts(epoch)
    const part = parts.find(entry => entry.type === 'timeZoneName')
    return part ? part.value : 'UTC'
}

// The duration of a weekly slot in minutes, handling the case where it wraps past the end
// of the UTC week ( end numerically smaller than start ).
function weeklyDurationMinutes(startMinuteOfWeekUtc, endMinuteOfWeekUtc) {
    return (endMinuteOfWeekUtc - startMinuteOfWeekUtc + MINUTES_PER_WEEK) % MINUTES_PER_WEEK
}

// A localized "Fri 19 Sep, 20:00-22:00 (CEST)" style label for a concrete instant range.
function formatDatedLabel(startUtc, endUtc, tz, locale) {
    const date = formatterFor(
        tz,
        { weekday: 'short', day: 'numeric', month: 'short' },
        locale,
    ).format(startUtc)
    return `${date}, ${formatTime(startUtc, tz)}-${formatTime(endUtc, tz)} (${timeZoneAbbreviation(startUtc, tz)})`
}

// The absolute epoch ms of a weekly slot's next occurrence : the soonest instant whose UTC
// minute-of-week matches the start and whose end is still in the future ( roll to the
// following week only once the current occurrence has ended ). Used when a link carries no
// occurrence stamp ; pure UTC arithmetic, so it is DST-safe.
function nextWeeklyOccurrenceUtc(startMinuteOfWeekUtc, durationMs, now) {
    const weekMs = MINUTES_PER_WEEK * 60000
    let start = startOfUtcWeek(now) + startMinuteOfWeekUtc * 60000
    while (start + durationMs <= now.getTime()) {
        start += weekMs
    }
    return start
}

// A fixed-timezone, human-readable label for a shared slot, localized in the slot's own
// language. A weekly slot reads as its next occurrence's concrete date with a "weekly"
// hint, e.g. "Fri 19 Sep, 20:00-22:00 (CEST) - weekly" ( the occurrence epoch stamped in
// the link, or recomputed here if absent ). A one-time slot reads as its own date.
export function formatShareLabel(parsed) {
    const tz = parsed.tz
    const locale = localeFor(parsed.lang)
    if (parsed.recurrence === 'weekly') {
        const durationMs =
            weeklyDurationMinutes(parsed.startMinuteOfWeekUtc, parsed.endMinuteOfWeekUtc) * 60000
        const start =
            parsed.occurrenceUtc !== null && parsed.occurrenceUtc !== undefined ?
                parsed.occurrenceUtc
            :   nextWeeklyOccurrenceUtc(parsed.startMinuteOfWeekUtc, durationMs, new Date())
        const dated = formatDatedLabel(start, start + durationMs, tz, locale)
        return `${dated} ( ${getTranslations(parsed.lang).weekly} )`
    }

    return formatDatedLabel(parsed.startUtc, parsed.endUtc, tz, locale)
}

// The app's language codes don't all match BCP 47 locale tags ( se = Swedish, no =
// Norwegian, ne = Dutch ) : map them so Intl formats weekday / month names correctly.
const LOCALES = { se: 'sv', no: 'nb', ne: 'nl' }

export function localeFor(code) {
    return LOCALES[code] || code
}

// Hardcoded translations of the share preview strings, keyed by the app's language code.
// `title` heads the card and the og:title ; `description` is the og:description ; `weekly`
// is the hint appended to a dated weekly occurrence. English is the fallback for any
// unknown code.
const TRANSLATIONS = {
    en: {
        title: 'Who wants to play ?',
        description: 'Open the link to see who else is free and add yourself.',
        weekly: 'weekly',
    },
    fr: {
        title: 'Qui veut jouer ?',
        description: "Ouvrez le lien pour voir qui d'autre est disponible et vous ajouter.",
        weekly: 'hebdomadaire',
    },
    es: {
        title: '¿Quién quiere jugar?',
        description: 'Abre el enlace para ver quién más está disponible y apuntarte.',
        weekly: 'semanal',
    },
    pt: {
        title: 'Quem quer jogar?',
        description: 'Abra o link para ver quem mais está disponível e se juntar.',
        weekly: 'semanal',
    },
    de: {
        title: 'Wer möchte spielen?',
        description: 'Öffne den Link, um zu sehen, wer sonst Zeit hat, und dich einzutragen.',
        weekly: 'wöchentlich',
    },
    it: {
        title: 'Chi vuole giocare ?',
        description: 'Apri il link per vedere chi altro è disponibile e unirti.',
        weekly: 'settimanale',
    },
    fi: {
        title: 'Kuka haluaa pelata ?',
        description: 'Avaa linkki nähdäksesi ketkä muut ovat vapaana ja liity mukaan.',
        weekly: 'viikoittain',
    },
    se: {
        title: 'Vem vill spela ?',
        description: 'Öppna länken för att se vilka andra som är lediga och gå med.',
        weekly: 'varje vecka',
    },
    no: {
        title: 'Hvem vil spille ?',
        description: 'Åpne lenken for å se hvem andre som er ledige og bli med.',
        weekly: 'ukentlig',
    },
    pl: {
        title: 'Kto chce zagrać ?',
        description: 'Otwórz link, aby zobaczyć kto jeszcze jest dostępny i dołączyć.',
        weekly: 'co tydzień',
    },
    ne: {
        title: 'Wie wil er spelen ?',
        description:
            'Open de link om te zien wie er nog meer beschikbaar is en jezelf toe te voegen.',
        weekly: 'wekelijks',
    },
}

export function getTranslations(code) {
    return TRANSLATIONS[code] || TRANSLATIONS.en
}
