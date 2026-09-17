import { AvailabilitySlot, SlotRecurrence } from '@/shared/types/availability.ts'
import { getTranslations, localeFor } from '@/shared/availability/shareLabel.mjs'

// Conversions between the stored UTC form of a slot and the local wall-clock values
// the user edits and reads. All "local" values use the browser's timezone. Weekly
// slots are stored as a UTC minute-of-week ; one-time slots as absolute epoch ms.
// Granularity is one hour, matching the calendar grid.

export const MINUTES_PER_DAY = 1440
export const MINUTES_PER_WEEK = 10080
export const DEFAULT_SLOT_DURATION_HOURS = 2

const MS_PER_DAY = 86400000
const BIWEEKLY_PERIOD_MS = 14 * MS_PER_DAY

// Weekday index used across the feature : 0 = Monday .. 6 = Sunday ( JavaScript's
// getDay()/getUTCDay() use 0 = Sunday, hence the +6 % 7 shift ).
export const WEEKDAY_NAMES = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
]
export const WEEKDAY_SHORT_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1)
}

function mondayIndex(jsDay: number): number {
    return (jsDay + 6) % 7
}

// Monday 00:00 local time of the week `weekOffset` weeks from the current one
// ( 0 = this week, 1 = next week, -1 = last week ).
export function localWeekStart(weekOffset = 0): Date {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - mondayIndex(date.getDay()) + weekOffset * 7)
    return date
}

// The local Date of a given weekday column within a displayed week.
export function weekdayDate(weekStart: Date, weekday: number): Date {
    return new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + weekday)
}

// The absolute epoch ms at the middle of a ( weekday, hour ) cell in a displayed local
// week. Built from local date parts so it stays correct across DST transitions. The
// mid-cell instant ( :30 ) keeps membership tests off the slot's hour-aligned edges.
export function cellMidEpoch(weekStart: Date, weekday: number, hour: number): number {
    return new Date(
        weekStart.getFullYear(),
        weekStart.getMonth(),
        weekStart.getDate() + weekday,
        hour,
        30,
    ).getTime()
}

export function utcMinuteOfWeekAt(epoch: number): number {
    return utcMinuteOfWeek(new Date(epoch))
}

// Whether a UTC minute-of-week falls inside a weekly slot's range, handling the case
// where the slot wraps past the end of the UTC week ( start > end ).
export function isWithinWeeklyRange(
    minute: number,
    startMinute: number,
    endMinute: number,
): boolean {
    if (startMinute <= endMinute) {
        return minute >= startMinute && minute < endMinute
    }
    return minute >= startMinute || minute < endMinute
}

// Whether `mid` falls in any occurrence of a slot anchored at `anchorStartUtc` and
// repeating every two weeks. Anchor, duration and period are all plain millisecond
// offsets, so modulo arithmetic is enough ( no DST correction needed, unlike calendar
// arithmetic ).
export function isWithinBiweeklyRange(
    anchorStartUtc: number,
    anchorEndUtc: number,
    mid: number,
): boolean {
    const duration = anchorEndUtc - anchorStartUtc
    const phase =
        (((mid - anchorStartUtc) % BIWEEKLY_PERIOD_MS) + BIWEEKLY_PERIOD_MS) % BIWEEKLY_PERIOD_MS
    return phase < duration
}

// Calendar months elapsed between two UTC instants, ignoring day-of-month. Used to
// bound the search for the calendar month ( relative to the anchor ) that could contain
// a given instant.
function utcMonthsBetween(fromUtc: number, toUtc: number): number {
    const from = new Date(fromUtc)
    const to = new Date(toUtc)
    return (
        (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
    )
}

// The anchor's occurrence shifted by `months` calendar months, in UTC. A shorter target
// month clamps the day ( e.g. an anchor on the 31st recurs on the 30th in a 30-day
// month ), so the duration is re-added rather than recomputed.
function shiftMonthlyOccurrence(
    anchorStartUtc: number,
    durationMs: number,
    months: number,
): { start: number; end: number } {
    const anchor = new Date(anchorStartUtc)
    const targetMonthIndex = anchor.getUTCMonth() + months
    const daysInTargetMonth = new Date(
        Date.UTC(anchor.getUTCFullYear(), targetMonthIndex + 1, 0),
    ).getUTCDate()
    const start = Date.UTC(
        anchor.getUTCFullYear(),
        targetMonthIndex,
        Math.min(anchor.getUTCDate(), daysInTargetMonth),
        anchor.getUTCHours(),
        anchor.getUTCMinutes(),
        anchor.getUTCSeconds(),
        anchor.getUTCMilliseconds(),
    )
    return { start, end: start + durationMs }
}

// Whether `mid` falls in any occurrence of a slot anchored at `anchorStartUtc` and
// repeating on the same UTC day each calendar month. Checks the neighbouring months too,
// since a shorter month can shift an occurrence's date relative to a naive month-count
// estimate.
export function isWithinMonthlyRange(
    anchorStartUtc: number,
    anchorEndUtc: number,
    mid: number,
): boolean {
    const duration = anchorEndUtc - anchorStartUtc
    const approxMonths = utcMonthsBetween(anchorStartUtc, mid)
    for (const months of [approxMonths - 1, approxMonths, approxMonths + 1]) {
        const { start, end } = shiftMonthlyOccurrence(anchorStartUtc, duration, months)
        if (start <= mid && mid < end) {
            return true
        }
    }
    return false
}

// A short, locale-aware column header : weekday + day + month ( e.g. "Mon 15 Sep" ).
export function formatColumnDate(date: Date): string {
    return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    }).format(date)
}

// Start of the current week ( Monday 00:00 ) in UTC.
function startOfUtcWeek(): Date {
    const now = new Date()
    const monday = now.getUTCDate() - mondayIndex(now.getUTCDay())
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), monday))
}

function utcMinuteOfWeek(date: Date): number {
    return (
        mondayIndex(date.getUTCDay()) * MINUTES_PER_DAY +
        date.getUTCHours() * 60 +
        date.getUTCMinutes()
    )
}

// The absolute epoch ms of a weekly slot's next occurrence : the soonest instant whose UTC
// minute-of-week matches the slot's start and whose end is still in the future ( roll to
// the following week only once the current occurrence has ended ). Pure UTC arithmetic, so
// it is DST-safe. Used to stamp a shared link and to navigate to that occurrence's week.
export function nextWeeklyOccurrenceUtc(
    startMinuteOfWeekUtc: number,
    endMinuteOfWeekUtc: number,
): number {
    const weekMs = MINUTES_PER_WEEK * 60000
    const durationMs =
        ((endMinuteOfWeekUtc - startMinuteOfWeekUtc + MINUTES_PER_WEEK) % MINUTES_PER_WEEK) * 60000
    const now = Date.now()
    let start = startOfUtcWeek().getTime() + startMinuteOfWeekUtc * 60000
    while (start + durationMs <= now) {
        start += weekMs
    }
    return start
}

// The absolute epoch ms of a biweekly slot's next occurrence : the soonest instant on
// the anchor's every-two-weeks cycle whose end is still in the future.
export function nextBiweeklyOccurrenceUtc(anchorStartUtc: number, anchorEndUtc: number): number {
    const duration = anchorEndUtc - anchorStartUtc
    const now = Date.now()
    let start = anchorStartUtc
    while (start + duration <= now) {
        start += BIWEEKLY_PERIOD_MS
    }
    return start
}

// The absolute epoch ms of a monthly slot's next occurrence : the soonest instant on
// the anchor's same-day-each-month cycle whose end is still in the future.
export function nextMonthlyOccurrenceUtc(anchorStartUtc: number, anchorEndUtc: number): number {
    const duration = anchorEndUtc - anchorStartUtc
    const now = Date.now()
    let months = 0
    for (;;) {
        const { start, end } = shiftMonthlyOccurrence(anchorStartUtc, duration, months)
        if (end > now) {
            return start
        }
        months++
    }
}

// Local weekday + hour ( as picked in the form ) -> UTC minute-of-week. Anchored to
// the current local week ; the resulting instant may fall on a different UTC weekday.
export function localWeekdayHourToMinuteOfWeekUtc(weekday: number, hour: number): number {
    const local = localWeekStart()
    local.setDate(local.getDate() + weekday)
    local.setHours(hour, 0, 0, 0)
    return utcMinuteOfWeek(local)
}

// UTC minute-of-week -> local weekday + hour, for prefilling the edit form and for
// projecting slots into the local grid.
export function minuteOfWeekUtcToLocal(minuteOfWeek: number): { weekday: number; hour: number } {
    const instant = new Date(startOfUtcWeek().getTime() + minuteOfWeek * 60000)
    return { weekday: mondayIndex(instant.getDay()), hour: instant.getHours() }
}

export function addHoursToMinuteOfWeek(startMinute: number, hours: number): number {
    return (startMinute + hours * 60) % MINUTES_PER_WEEK
}

// Locates an absolute instant in the local calendar : which displayed week ( offset
// from the current one ), and the local weekday + hour cell within it. Used to open a
// shared one-time slot on the right week and cell.
export function localCellForEpoch(epoch: number): {
    weekOffset: number
    weekday: number
    hour: number
} {
    const date = new Date(epoch)
    const weekday = mondayIndex(date.getDay())
    const startMonday = new Date(date)
    startMonday.setHours(0, 0, 0, 0)
    startMonday.setDate(startMonday.getDate() - weekday)
    const weekOffset = Math.round(
        (startMonday.getTime() - localWeekStart(0).getTime()) / (7 * MINUTES_PER_DAY * 60000),
    )
    return { weekOffset, weekday, hour: date.getHours() }
}

export function weeklyDurationHours(startMinute: number, endMinute: number): number {
    return ((endMinute - startMinute + MINUTES_PER_WEEK) % MINUTES_PER_WEEK) / 60
}

export function toLocalDateIso(date: Date): string {
    const year = date.getFullYear()
    const month = (date.getMonth() + 1).toString().padStart(2, '0')
    const day = date.getDate().toString().padStart(2, '0')
    return `${year}-${month}-${day}`
}

export function todayLocalDateIso(): string {
    return toLocalDateIso(new Date())
}

// Local date ( yyyy-mm-dd ) + hour -> absolute UTC epoch ms.
export function localDateHourToUtc(dateIso: string, hour: number): number {
    const [year, month, day] = dateIso.split('-').map(Number)
    return new Date(year, month - 1, day, hour, 0, 0, 0).getTime()
}

export function utcToLocalDateHour(epoch: number): { dateIso: string; hour: number } {
    const date = new Date(epoch)
    return { dateIso: toLocalDateIso(date), hour: date.getHours() }
}

export function onceDurationHours(startUtc: number, endUtc: number): number {
    return Math.round((endUtc - startUtc) / 3600000)
}

function formatHourRange(startHour: number, durationHours: number): string {
    const endHour = (startHour + durationHours) % 24
    const start = startHour.toString().padStart(2, '0')
    const end = endHour.toString().padStart(2, '0')
    const nextDay = startHour + durationHours >= 24 ? ' (+1d)' : ''
    return `${start}:00 - ${end}:00${nextDay}`
}

// The next concrete occurrence's absolute epoch ms for a slot that isn't a one-off :
// weekly, biweekly and monthly each derive it from their own anchor/cycle.
function nextOccurrenceUtc(slot: AvailabilitySlot): number {
    if (slot.recurrence === SlotRecurrence.Weekly) {
        return nextWeeklyOccurrenceUtc(slot.startMinuteOfWeekUtc, slot.endMinuteOfWeekUtc)
    }
    if (slot.recurrence === SlotRecurrence.Biweekly) {
        return nextBiweeklyOccurrenceUtc(slot.startUtc, slot.endUtc)
    }
    return nextMonthlyOccurrenceUtc(slot.startUtc, slot.endUtc)
}

// Like formatSlotLabel, but a recurring slot is resolved to its next concrete occurrence
// ( a dated "Mon 21 Sep - 21:00 - 23:00" ) rather than the recurring "Weekly - Mon" form.
// Used for the share message, which advertises a specific upcoming date.
export function formatNextOccurrenceLabel(slot: AvailabilitySlot): string {
    const startUtc =
        slot.recurrence === SlotRecurrence.Once ? slot.startUtc : nextOccurrenceUtc(slot)
    const durationHours =
        slot.recurrence === SlotRecurrence.Weekly ?
            weeklyDurationHours(slot.startMinuteOfWeekUtc, slot.endMinuteOfWeekUtc)
        :   onceDurationHours(slot.startUtc, slot.endUtc)
    const { hour } = utcToLocalDateHour(startUtc)
    const date = new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    }).format(new Date(startUtc))
    return `${date} - ${formatHourRange(hour, durationHours)}`
}

// A human-readable label for a slot, in the viewer's local timezone and localized to the
// given app language ( weekday / month names via Intl, and the recurrence hint
// translated ). A weekly slot reads by weekday only ( "Weekly - Mon 21:00 - 23:00" ) ;
// biweekly and monthly slots are anchored to a date, so they read by their next
// occurrence's date instead ( "Biweekly - Mon 21 Sep 21:00 - 23:00" ).
export function formatSlotLabel(slot: AvailabilitySlot, languageCode: string): string {
    const locale = localeFor(languageCode)
    if (slot.recurrence === SlotRecurrence.Weekly) {
        const { weekday, hour } = minuteOfWeekUtcToLocal(slot.startMinuteOfWeekUtc)
        const duration = weeklyDurationHours(slot.startMinuteOfWeekUtc, slot.endMinuteOfWeekUtc)
        const weekdayDate = localWeekStart()
        weekdayDate.setDate(weekdayDate.getDate() + weekday)
        const dayName = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(weekdayDate)
        const weekly = capitalize(getTranslations(languageCode).weekly)
        return `${weekly} - ${dayName} ${formatHourRange(hour, duration)}`
    }
    if (slot.recurrence === SlotRecurrence.Biweekly || slot.recurrence === SlotRecurrence.Monthly) {
        const startUtc = nextOccurrenceUtc(slot)
        const duration = onceDurationHours(slot.startUtc, slot.endUtc)
        const { hour } = utcToLocalDateHour(startUtc)
        const date = new Intl.DateTimeFormat(locale, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
        }).format(new Date(startUtc))
        const translations = getTranslations(languageCode)
        const hint = capitalize(
            slot.recurrence === SlotRecurrence.Biweekly ?
                translations.biweekly
            :   translations.monthly,
        )
        return `${hint} - ${date} ${formatHourRange(hour, duration)}`
    }
    const { hour } = utcToLocalDateHour(slot.startUtc)
    const duration = onceDurationHours(slot.startUtc, slot.endUtc)
    const date = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    }).format(new Date(slot.startUtc))
    return `${date} - ${formatHourRange(hour, duration)}`
}
