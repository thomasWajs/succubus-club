// Timezone-aware occurrence math for availability slots. Slots store wall-clock times
// ( weekday / date + hour ) in the creator's IANA timezone ; this module turns those into
// the absolute UTC instants a concrete occurrence falls on, applying the timezone's
// offset for that particular date so daylight-saving shifts never drift a slot off its
// intended hour. Plain .mjs with no bundler alias, so both the client ( via recurrence.d.mts )
// and the Vercel api/*.mjs functions can import it.

const MS_PER_DAY = 86400000

// Days between successive occurrences for each repeating anchored recurrence. "monthly"
// is a fixed four-week cadence ( not a calendar month ), so it keeps the same weekday.
const PERIOD_DAYS = { biweekly: 14, monthly: 28 }

// 0 = Monday .. 6 = Sunday, from JavaScript's 0 = Sunday getUTCDay().
function mondayIndex(jsDay) {
    return (jsDay + 6) % 7
}

// Constructing an Intl.DateTimeFormat is far costlier than using one, and the grid resolves
// occurrences across hundreds of cells, so formatters are cached per timezone.
const offsetFormatters = new Map()

function offsetFormatter(timeZone) {
    let formatter = offsetFormatters.get(timeZone)
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        })
        offsetFormatters.set(timeZone, formatter)
    }
    return formatter
}

// The offset ( ms to add to UTC to get local wall-clock ) that `timeZone` is at for the
// given absolute instant. Derived by formatting the instant in the zone and diffing the
// rendered wall-clock against the raw UTC value.
export function tzOffsetMs(timeZone, utcMs) {
    const parts = offsetFormatter(timeZone).formatToParts(utcMs)
    const field = {}
    for (const part of parts) {
        field[part.type] = part.value
    }
    // Some engines render midnight as hour "24" ; normalise it to 0.
    const hour = field.hour === '24' ? 0 : Number(field.hour)
    const asUtc = Date.UTC(
        Number(field.year),
        Number(field.month) - 1,
        Number(field.day),
        hour,
        Number(field.minute),
        Number(field.second),
    )
    return asUtc - utcMs
}

// A wall-clock time in `timeZone` -> the absolute UTC instant it denotes. The offset
// depends on the instant we are solving for, so we estimate it, then refine once ( which
// resolves all but the ambiguous hour around a DST fall-back, good enough at hour
// granularity ).
export function wallClockToUtc(timeZone, year, month, day, hour, minute) {
    const guess = Date.UTC(year, month - 1, day, hour, minute)
    const firstOffset = tzOffsetMs(timeZone, guess)
    const utc = guess - firstOffset
    const secondOffset = tzOffsetMs(timeZone, utc)
    return secondOffset === firstOffset ? utc : guess - secondOffset
}

// An absolute UTC instant -> its wall-clock parts in `timeZone` ( weekday is 0 = Monday ).
export function utcToWallClock(timeZone, utcMs) {
    const local = new Date(utcMs + tzOffsetMs(timeZone, utcMs))
    return {
        year: local.getUTCFullYear(),
        month: local.getUTCMonth() + 1,
        day: local.getUTCDate(),
        hour: local.getUTCHours(),
        minute: local.getUTCMinutes(),
        weekday: mondayIndex(local.getUTCDay()),
    }
}

function durationMs(slot) {
    return slot.durationHours * 3600000
}

// The UTC start instant of the occurrence that starts `dayDelta` days after the anchor
// date ( yyyy, mm, dd ), at the slot's wall-clock start hour in its timezone. Calendar
// day arithmetic ( via Date.UTC ) rolls months/years over correctly.
function occurrenceStart(slot, year, month, day, dayDelta) {
    const date = new Date(Date.UTC(year, month - 1, day + dayDelta))
    return wallClockToUtc(
        slot.timezone,
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        slot.startHour,
        0,
    )
}

function anchorParts(slot) {
    const [year, month, day] = slot.date.split('-').map(Number)
    return { year, month, day }
}

// Whether any occurrence of `slot` covers the absolute instant `atUtc`.
export function slotCoversInstant(slot, atUtc) {
    const duration = durationMs(slot)

    if (slot.recurrence === 'weekly') {
        // The occurrence in the slot's timezone-week around `atUtc`. Check the neighbouring
        // weeks too, so a slot that runs past midnight ( or sits near a DST edge ) still
        // matches.
        const here = utcToWallClock(slot.timezone, atUtc)
        for (const deltaWeeks of [-1, 0, 1]) {
            const dayDelta = slot.weekday - here.weekday + deltaWeeks * 7
            const start = occurrenceStart(slot, here.year, here.month, here.day, dayDelta)
            if (start <= atUtc && atUtc < start + duration) {
                return true
            }
        }
        return false
    }

    const { year, month, day } = anchorParts(slot)
    if (slot.recurrence === 'once') {
        const start = wallClockToUtc(slot.timezone, year, month, day, slot.startHour, 0)
        return start <= atUtc && atUtc < start + duration
    }

    const period = PERIOD_DAYS[slot.recurrence]
    const anchorStart = wallClockToUtc(slot.timezone, year, month, day, slot.startHour, 0)
    // Estimate which cycle `atUtc` is in, then check it and its neighbours ( DST can nudge
    // an occurrence's instant off the naive estimate by an hour ).
    const approx = Math.round((atUtc - anchorStart) / (period * MS_PER_DAY))
    for (const cycle of [approx - 1, approx, approx + 1]) {
        if (cycle < 0) {
            continue
        }
        const start = occurrenceStart(slot, year, month, day, cycle * period)
        if (start <= atUtc && atUtc < start + duration) {
            return true
        }
    }
    return false
}

// The absolute UTC start instant of `slot`'s next occurrence : the soonest one whose end
// is still in the future ( relative to `nowUtc` ). A one-time slot has only its own
// occurrence, returned whether or not it has passed.
export function nextOccurrenceStartUtc(slot, nowUtc) {
    const duration = durationMs(slot)

    if (slot.recurrence === 'weekly') {
        const here = utcToWallClock(slot.timezone, nowUtc)
        // Start a week back to catch an occurrence that began before `nowUtc` but has not
        // ended, then walk forward. The bound is generous ; a match is always found within
        // the first couple of weeks.
        for (let deltaWeeks = -1; deltaWeeks <= 8; deltaWeeks++) {
            const dayDelta = slot.weekday - here.weekday + deltaWeeks * 7
            const start = occurrenceStart(slot, here.year, here.month, here.day, dayDelta)
            if (start + duration > nowUtc) {
                return start
            }
        }
        return occurrenceStart(slot, here.year, here.month, here.day, slot.weekday - here.weekday)
    }

    const { year, month, day } = anchorParts(slot)
    if (slot.recurrence === 'once') {
        return wallClockToUtc(slot.timezone, year, month, day, slot.startHour, 0)
    }

    const period = PERIOD_DAYS[slot.recurrence]
    const anchorStart = wallClockToUtc(slot.timezone, year, month, day, slot.startHour, 0)
    // Jump close to `nowUtc` rather than iterating from the anchor, which may be far in the
    // past ( e.g. an old shared link ).
    let cycle = Math.max(0, Math.floor((nowUtc - anchorStart) / (period * MS_PER_DAY)) - 1)
    for (let guard = 0; guard < 1000; guard++, cycle++) {
        const start = occurrenceStart(slot, year, month, day, cycle * period)
        if (start + duration > nowUtc) {
            return start
        }
    }
    return anchorStart
}

// Whether a value has the shape of a stored slot for the current model. Used to drop
// legacy / malformed documents on read, so downstream occurrence math never sees the
// undefined fields that would poison its arithmetic.
export function isAvailabilitySlot(value) {
    if (!value || typeof value !== 'object') {
        return false
    }
    const commonOk =
        typeof value.id === 'string' &&
        typeof value.timezone === 'string' &&
        value.timezone.length > 0 &&
        Number.isFinite(value.startHour) &&
        Number.isFinite(value.durationHours)
    if (!commonOk) {
        return false
    }
    if (value.recurrence === 'weekly') {
        return Number.isFinite(value.weekday)
    }
    if (
        value.recurrence === 'once' ||
        value.recurrence === 'biweekly' ||
        value.recurrence === 'monthly'
    ) {
        return typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
    }
    return false
}
