import { AvailabilitySlot, SlotCategory, SlotRecurrence } from '@/shared/types/availability.ts'
import { nextOccurrenceStartUtc } from '@/shared/availability/recurrence.mjs'

// Encodes a slot into self-contained URL query params ( and back ), so a shared link
// carries everything the landing page needs without a database lookup : it keeps
// working even after the original slot is edited or removed. The link never carries the
// author's identity ; whoever opens it adds themselves.

const SHARE_PARAM = 'share'

export function encodeSharedSlot(slot: AvailabilitySlot, languageCode: string): URLSearchParams {
    const params = new URLSearchParams()
    params.set(SHARE_PARAM, '1')
    params.set('lang', languageCode)
    // The slot's own timezone travels with the link so the server-rendered preview ( see
    // api/share.mjs ) labels the time in the zone the creator picked it in.
    params.set('tz', slot.timezone)
    params.set('rec', slot.recurrence)
    params.set('sh', String(slot.startHour))
    params.set('dh', String(slot.durationHours))

    if (slot.recurrence === SlotRecurrence.Weekly) {
        params.set('wd', String(slot.weekday))
    } else {
        params.set('d', slot.date)
    }

    // The next occurrence's absolute epoch : lets the preview show the exact upcoming date,
    // and changes over time so re-shared links get a fresh crawler unfurl. A one-time slot
    // has no next occurrence to advertise beyond its own date, so it carries none.
    if (slot.recurrence !== SlotRecurrence.Once) {
        params.set('occ', String(nextOccurrenceStartUtc(slot, Date.now())))
    }
    return params
}

// Points at the /share endpoint ( rewritten to api/share.mjs ), not directly at the SPA :
// that function serves rich Open Graph preview tags to link crawlers and redirects real
// browsers on to /availability, where parseSharedSlot opens the slot's roster.
export function buildShareUrl(slot: AvailabilitySlot, languageCode: string): string {
    return `${window.location.origin}/share?${encodeSharedSlot(slot, languageCode).toString()}`
}

// The WhatsApp / clipboard message, hardcoded per language ( same set of languages as the
// server-side preview strings in shareLabel.mjs ). Composed client-side because it is only
// ever sent from the browser. `{label}` and `{url}` are filled in by buildShareMessage.
const SHARE_MESSAGE_TEMPLATES: Record<string, string> = {
    en: 'Who wants to play on Succubus Club {label} ? Join me : {url}',
    fr: 'Qui veut jouer sur Succubus Club {label} ? Rejoins-moi : {url}',
    es: '¿Quién quiere jugar en Succubus Club {label}? Únete a mí : {url}',
    pt: 'Quem quer jogar no Succubus Club {label} ? Junta-te a mim : {url}',
    de: 'Wer möchte auf Succubus Club spielen {label} ? Mach mit : {url}',
    it: 'Chi vuole giocare su Succubus Club {label} ? Unisciti a me : {url}',
    fi: 'Kuka haluaa pelata Succubus Clubilla {label} ? Liity mukaan : {url}',
    se: 'Vem vill spela på Succubus Club {label} ? Följ med : {url}',
    no: 'Hvem vil spille på Succubus Club {label} ? Bli med : {url}',
    pl: 'Kto chce zagrać na Succubus Club {label} ? Dołącz do mnie : {url}',
    ne: 'Wie wil er spelen op Succubus Club {label} ? Doe met me mee : {url}',
}

export function buildShareMessage(languageCode: string, slotLabel: string, url: string): string {
    const template = SHARE_MESSAGE_TEMPLATES[languageCode] ?? SHARE_MESSAGE_TEMPLATES.en
    return template.replace('{label}', slotLabel).replace('{url}', url)
}

export interface SharedSlot {
    slot: AvailabilitySlot
    languageCode: string
    // For recurring links : the next-occurrence epoch stamped at share time, used to open
    // the calendar on the advertised occurrence's week. Absent for one-time links.
    occurrenceUtc: number | null
}

function parseNumber(raw: string | null): number | null {
    if (!raw) {
        return null
    }
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
}

// Decodes a shared slot from URL params, or returns null when they are absent or
// malformed. The slot keeps the sharer's timezone ( so its instant is preserved for the
// visitor ) but gets a fresh id : the visitor is creating their own entry.
export function parseSharedSlot(params: URLSearchParams): SharedSlot | null {
    if (params.get(SHARE_PARAM) !== '1') {
        return null
    }

    const languageCode = params.get('lang')
    const timezone = params.get('tz')
    const recurrence = params.get('rec')
    const startHour = parseNumber(params.get('sh'))
    const durationHours = parseNumber(params.get('dh'))
    if (
        !languageCode ||
        !timezone ||
        startHour === null ||
        durationHours === null ||
        !isSharedRecurrence(recurrence)
    ) {
        return null
    }

    const id = crypto.randomUUID()
    // The link only carries the slot's time. Category isn't needed : the visitor lands on
    // the live roster, and the fallback add form ( when the slot is gone ) just defaults.
    const category = SlotCategory.Both
    const base = { id, category, timezone, startHour, durationHours }

    if (recurrence === SlotRecurrence.Weekly) {
        const weekday = parseNumber(params.get('wd'))
        if (weekday === null) {
            return null
        }
        return {
            languageCode,
            occurrenceUtc: parseNumber(params.get('occ')),
            slot: { ...base, recurrence: SlotRecurrence.Weekly, weekday },
        }
    }

    const date = params.get('d')
    if (!date) {
        return null
    }
    return {
        languageCode,
        occurrenceUtc: recurrence === SlotRecurrence.Once ? null : parseNumber(params.get('occ')),
        slot: { ...base, recurrence, date },
    }
}

function isSharedRecurrence(value: string | null): value is SlotRecurrence {
    return (
        value === SlotRecurrence.Weekly ||
        value === SlotRecurrence.Biweekly ||
        value === SlotRecurrence.Monthly ||
        value === SlotRecurrence.Once
    )
}
