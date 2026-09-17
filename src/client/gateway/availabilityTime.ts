import { AvailabilitySlot, SlotRecurrence } from '@/shared/types/availability.ts'
import { getTranslations, localeFor } from '@/shared/availability/shareLabel.mjs'
import { nextOccurrenceStartUtc } from '@/shared/availability/recurrence.mjs'

// Local-calendar helpers for the availability screen : building the displayed week grid,
// and turning a slot into a human-readable label. Slots themselves store wall-clock times
// in the creator's timezone ( see src/shared/types/availability.ts ) ; the occurrence math
// that resolves them to absolute instants lives in src/shared/availability/recurrence.mjs.
// Everything here renders in the viewer's own local timezone, at one-hour granularity.

const MS_PER_DAY = 86400000
export const DEFAULT_SLOT_DURATION_HOURS = 2

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

// The current viewer's local timezone ( IANA id ), stamped onto slots they create.
export function localTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
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

// A short, locale-aware column header : weekday + day + month ( e.g. "Mon 15 Sep" ).
export function formatColumnDate(date: Date): string {
    return new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    }).format(date)
}

// Locates an absolute instant in the local calendar : which displayed week ( offset
// from the current one ), and the local weekday + hour cell within it. Used to open a
// shared slot's occurrence on the right week and cell.
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
        (startMonday.getTime() - localWeekStart(0).getTime()) / (7 * MS_PER_DAY),
    )
    return { weekOffset, weekday, hour: date.getHours() }
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

// The start hour + duration of an occurrence, rendered as a local "21:00 - 23:00" range,
// with a "(+1d)" marker when the slot runs into the next day.
function formatHourRange(startHour: number, durationHours: number): string {
    const endHour = (startHour + durationHours) % 24
    const start = startHour.toString().padStart(2, '0')
    const end = endHour.toString().padStart(2, '0')
    const nextDay = startHour + durationHours >= 24 ? ' (+1d)' : ''
    return `${start}:00 - ${end}:00${nextDay}`
}

// The recurrence hint ( "Weekly" / "Every 2 weeks" / "Monthly" ), localized, or '' for a
// one-time slot.
function recurrenceHint(slot: AvailabilitySlot, languageCode: string): string {
    const translations = getTranslations(languageCode)
    if (slot.recurrence === SlotRecurrence.Weekly) {
        return capitalize(translations.weekly)
    }
    if (slot.recurrence === SlotRecurrence.Biweekly) {
        return capitalize(translations.biweekly)
    }
    if (slot.recurrence === SlotRecurrence.Monthly) {
        return capitalize(translations.monthly)
    }
    return ''
}

// A human-readable label for a slot, resolved to its next occurrence and shown in the
// viewer's local timezone, localized to the given app language. A weekly slot reads by
// weekday ( "Weekly - Mon 21:00 - 23:00" ) ; the dated recurrences and one-time slots read
// by their occurrence's date ( "Every 2 weeks - Mon 21 Sep 21:00 - 23:00" ).
export function formatSlotLabel(slot: AvailabilitySlot, languageCode: string): string {
    const locale = localeFor(languageCode)
    const start = new Date(nextOccurrenceStartUtc(slot, Date.now()))
    const hourRange = formatHourRange(start.getHours(), slot.durationHours)

    if (slot.recurrence === SlotRecurrence.Weekly) {
        const dayName = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(start)
        return `${recurrenceHint(slot, languageCode)} - ${dayName} ${hourRange}`
    }

    const dated = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    }).format(start)
    if (slot.recurrence === SlotRecurrence.Once) {
        return `${dated} ${hourRange}`
    }
    return `${recurrenceHint(slot, languageCode)} - ${dated} ${hourRange}`
}

// Like formatSlotLabel, but always a concrete dated occurrence ( no recurrence hint ),
// in the viewer's local timezone. Used for the share message, which advertises a specific
// upcoming date.
export function formatNextOccurrenceLabel(slot: AvailabilitySlot): string {
    const start = new Date(nextOccurrenceStartUtc(slot, Date.now()))
    const date = new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    }).format(start)
    return `${date} - ${formatHourRange(start.getHours(), slot.durationHours)}`
}
