// Player availability model. Users declare weekly ( recurring ) or one-time slots
// per language to coordinate games. Hours are stored in UTC and projected into each
// viewer's local timezone for display.

export enum SlotCategory {
    Casual = 'casual',
    Competitive = 'competitive',
    Both = 'both',
}

export enum SlotRecurrence {
    Weekly = 'weekly',
    Biweekly = 'biweekly',
    Monthly = 'monthly',
    Once = 'once',
}

// A recurring weekly slot. Stored as a UTC "minute of week" ( 0 .. 10079,
// mondayMidnightUtc = 0 ) rather than a weekday + hour, because a timezone shift can
// move a slot across both the hour and the weekday boundary. Each viewer projects it
// back into their own local week. `end` may be numerically smaller than `start` when
// the slot wraps past the end of the UTC week.
export interface WeeklyAvailabilitySlot {
    id: string
    recurrence: SlotRecurrence.Weekly
    category: SlotCategory
    startMinuteOfWeekUtc: number
    endMinuteOfWeekUtc: number
}

// A slot anchored to a single absolute occurrence : "once" never repeats past it,
// "biweekly" repeats every two weeks, and "monthly" repeats on the same day each
// calendar month. All three share the same shape ( one absolute start/end ) ; only the
// derivation of later occurrences from that anchor differs.
export interface AnchoredAvailabilitySlot {
    id: string
    recurrence: SlotRecurrence.Once | SlotRecurrence.Biweekly | SlotRecurrence.Monthly
    category: SlotCategory
    startUtc: number
    endUtc: number
}

export type AvailabilitySlot = WeeklyAvailabilitySlot | AnchoredAvailabilitySlot

// The document stored per player, per language ( at availability/{lang}/players/{uid} ).
// `permId` + `name` are the app-level identity ( for display and matching the lobby
// player list ) ; ownership for edits is gated on the anonymous-auth uid, which is the
// document id, so it is not duplicated inside the document.
export interface StoredPlayerAvailability {
    permId: string
    name: string
    slots: AvailabilitySlot[]
}

// The client-facing shape : the stored document plus its uid ( document id ), used to
// tell whether a slot belongs to the current player.
export interface PlayerAvailability extends StoredPlayerAvailability {
    uid: string
}
