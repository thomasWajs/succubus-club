// Server-side helpers for the availability share links. Shared by the two Vercel
// functions ( api/share.mjs, api/shareImage.mjs ) so the preview title and image agree
// on a single formatting. Slots carry wall-clock times in the creator's timezone ; the
// occurrence math ( resolving them to absolute instants, DST-correctly ) is shared with
// the client in recurrence.mjs. Stays plain .mjs with no bundler alias.

import { nextOccurrenceStartUtc } from './recurrence.mjs'

// Whether the value is a finite number once coerced ; used to validate query params.
function parseNumber(raw) {
    if (raw === null || raw === undefined || raw === '') {
        return null
    }
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
}

// A usable IANA timezone id, or 'UTC' when the param is missing / invalid ( a bad or
// spoofed `tz` ). Validated up front so the occurrence math never throws on it.
function safeTimezone(raw) {
    if (!raw) {
        return 'UTC'
    }
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: raw })
        return raw
    } catch {
        return 'UTC'
    }
}

// Parses the self-contained share params ( same shape as the client's encodeSharedSlot )
// into a slot-plus-metadata descriptor, or null when they are absent or malformed. The
// descriptor is directly usable by recurrence.mjs ( it is a slot with `timezone` set ).
export function parseShareParams(searchParams) {
    if (searchParams.get('share') !== '1') {
        return null
    }

    const lang = searchParams.get('lang')
    const recurrence = searchParams.get('rec')
    const startHour = parseNumber(searchParams.get('sh'))
    const durationHours = parseNumber(searchParams.get('dh'))
    const validRecurrence =
        recurrence === 'weekly' ||
        recurrence === 'biweekly' ||
        recurrence === 'monthly' ||
        recurrence === 'once'
    if (!lang || !validRecurrence || startHour === null || durationHours === null) {
        return null
    }

    const timezone = safeTimezone(searchParams.get('tz'))
    const base = { lang, timezone, recurrence, startHour, durationHours }

    if (recurrence === 'weekly') {
        const weekday = parseNumber(searchParams.get('wd'))
        if (weekday === null) {
            return null
        }
        // Optional : the absolute epoch of the next occurrence, stamped by the client at
        // share time ( see encodeSharedSlot ). When present the preview shows that exact
        // date ; it also changes over time, busting the crawlers' caches.
        return { ...base, weekday, occurrenceUtc: parseNumber(searchParams.get('occ')) }
    }

    const date = searchParams.get('d')
    if (!date) {
        return null
    }
    // Same "occ" stamp as weekly ; absent for a one-time slot, which has no next occurrence.
    const occurrenceUtc = recurrence === 'once' ? null : parseNumber(searchParams.get('occ'))
    return { ...base, date, occurrenceUtc }
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

// A localized "Fri 19 Sep, 20:00-22:00 (CEST)" style label for a concrete instant range.
function formatDatedLabel(startUtc, endUtc, tz, locale) {
    const date = formatterFor(
        tz,
        { weekday: 'short', day: 'numeric', month: 'short' },
        locale,
    ).format(startUtc)
    return `${date}, ${formatTime(startUtc, tz)}-${formatTime(endUtc, tz)} (${timeZoneAbbreviation(startUtc, tz)})`
}

// A fixed-timezone, human-readable label for a shared slot, localized in the slot's own
// language and rendered in the slot's own timezone. A recurring slot reads as its next
// occurrence's concrete date with a recurrence hint, e.g. "Fri 19 Sep, 20:00-22:00 (CEST)
// ( weekly )" ( the occurrence epoch stamped in the link, or recomputed here if absent ).
// A one-time slot reads as its own date, with no hint.
export function formatShareLabel(parsed) {
    const tz = parsed.timezone
    const locale = localeFor(parsed.lang)
    const start =
        parsed.occurrenceUtc !== null && parsed.occurrenceUtc !== undefined ?
            parsed.occurrenceUtc
        :   nextOccurrenceStartUtc(parsed, Date.now())
    const end = start + parsed.durationHours * 3600000
    const dated = formatDatedLabel(start, end, tz, locale)
    if (parsed.recurrence === 'once') {
        return dated
    }
    return `${dated} ( ${getTranslations(parsed.lang)[parsed.recurrence]} )`
}

// The app's language codes don't all match BCP 47 locale tags ( se = Swedish, no =
// Norwegian, ne = Dutch ) : map them so Intl formats weekday / month names correctly.
const LOCALES = { se: 'sv', no: 'nb', ne: 'nl' }

export function localeFor(code) {
    return LOCALES[code] || code
}

// Hardcoded translations of the share preview strings, keyed by the app's language code.
// `title` heads the card and the og:title ; `description` is the og:description ;
// `weekly` / `biweekly` / `monthly` are the hints appended to a dated recurring
// occurrence. English is the fallback for any unknown code.
const TRANSLATIONS = {
    en: {
        title: 'Who wants to play ?',
        description: 'Open the link to see who else is free and add yourself.',
        weekly: 'weekly',
        biweekly: 'every 2 weeks',
        monthly: 'monthly',
        language: 'Language',
    },
    fr: {
        title: 'Qui veut jouer ?',
        description: "Ouvrez le lien pour voir qui d'autre est disponible et vous ajouter.",
        weekly: 'hebdomadaire',
        biweekly: 'toutes les 2 semaines',
        monthly: 'mensuel',
        language: 'Langue',
    },
    es: {
        title: '¿Quién quiere jugar?',
        description: 'Abre el enlace para ver quién más está disponible y apuntarte.',
        weekly: 'semanal',
        biweekly: 'cada 2 semanas',
        monthly: 'mensual',
        language: 'Idioma',
    },
    pt: {
        title: 'Quem quer jogar?',
        description: 'Abra o link para ver quem mais está disponível e se juntar.',
        weekly: 'semanal',
        biweekly: 'a cada 2 semanas',
        monthly: 'mensal',
        language: 'Idioma',
    },
    de: {
        title: 'Wer möchte spielen?',
        description: 'Öffne den Link, um zu sehen, wer sonst Zeit hat, und dich einzutragen.',
        weekly: 'wöchentlich',
        biweekly: 'alle 2 Wochen',
        monthly: 'monatlich',
        language: 'Sprache',
    },
    it: {
        title: 'Chi vuole giocare ?',
        description: 'Apri il link per vedere chi altro è disponibile e unirti.',
        weekly: 'settimanale',
        biweekly: 'ogni 2 settimane',
        monthly: 'mensile',
        language: 'Lingua',
    },
    fi: {
        title: 'Kuka haluaa pelata ?',
        description: 'Avaa linkki nähdäksesi ketkä muut ovat vapaana ja liity mukaan.',
        weekly: 'viikoittain',
        biweekly: 'joka 2. viikko',
        monthly: 'kuukausittain',
        language: 'Kieli',
    },
    se: {
        title: 'Vem vill spela ?',
        description: 'Öppna länken för att se vilka andra som är lediga och gå med.',
        weekly: 'varje vecka',
        biweekly: 'varannan vecka',
        monthly: 'månadsvis',
        language: 'Språk',
    },
    no: {
        title: 'Hvem vil spille ?',
        description: 'Åpne lenken for å se hvem andre som er ledige og bli med.',
        weekly: 'ukentlig',
        biweekly: 'annenhver uke',
        monthly: 'månedlig',
        language: 'Språk',
    },
    pl: {
        title: 'Kto chce zagrać ?',
        description: 'Otwórz link, aby zobaczyć kto jeszcze jest dostępny i dołączyć.',
        weekly: 'co tydzień',
        biweekly: 'co 2 tygodnie',
        monthly: 'miesięcznie',
        language: 'Język',
    },
    ne: {
        title: 'Wie wil er spelen ?',
        description:
            'Open de link om te zien wie er nog meer beschikbaar is en jezelf toe te voegen.',
        weekly: 'wekelijks',
        biweekly: 'om de 2 weken',
        monthly: 'maandelijks',
        language: 'Taal',
    },
}

export function getTranslations(code) {
    return TRANSLATIONS[code] || TRANSLATIONS.en
}
