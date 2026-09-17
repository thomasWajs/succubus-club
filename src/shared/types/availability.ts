// Player availability model. Users declare recurring or one-time slots per language to
// coordinate games. Times are stored as wall-clock values ( weekday / date + hour ) in
// the creator's IANA timezone, NOT as absolute UTC instants : this keeps a "20:00" slot
// reading as 20:00 all year, even across daylight-saving transitions. Each concrete
// occurrence is projected to an absolute instant on demand ( applying the timezone's
// offset for that date ), then shown in each viewer's own local timezone.

export enum SlotCategory {
    Casual = 'casual',
    Competitive = 'competitive',
    Both = 'both',
}

export enum SlotRecurrence {
    Weekly = 'weekly',
    // Every two weeks, anchored to a start date.
    Biweekly = 'biweekly',
    // Every four weeks, anchored to a start date ( "monthly" in the UI ; a fixed 28-day
    // cadence rather than a calendar month, so it always lands on the same weekday ).
    Monthly = 'monthly',
    Once = 'once',
}

// Fields shared by every slot : the wall-clock start hour and duration, and the timezone
// those wall-clock values are expressed in.
interface BaseAvailabilitySlot {
    id: string
    category: SlotCategory
    // IANA timezone id ( e.g. "Europe/Paris" ) the wall-clock times below are given in.
    timezone: string
    // Wall-clock start hour ( 0 .. 23 ) in `timezone`.
    startHour: number
    // Slot length in hours ( 1 .. 24 ) ; a slot may run past midnight into the next day.
    durationHours: number
}

// A weekly slot : the same weekday and hour every week, in `timezone`.
export interface WeeklyAvailabilitySlot extends BaseAvailabilitySlot {
    recurrence: SlotRecurrence.Weekly
    // 0 = Monday .. 6 = Sunday, in `timezone`.
    weekday: number
}

// A slot anchored to a single start date : "once" never repeats past it, "biweekly"
// repeats every two weeks, "monthly" every four weeks. All three share one anchor date ;
// only how later occurrences are derived from it differs.
export interface AnchoredAvailabilitySlot extends BaseAvailabilitySlot {
    recurrence: SlotRecurrence.Once | SlotRecurrence.Biweekly | SlotRecurrence.Monthly
    // Anchor date as "yyyy-mm-dd", interpreted in `timezone`.
    date: string
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
