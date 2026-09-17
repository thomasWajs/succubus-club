// Type declarations for the plain-.mjs recurrence engine, so type-checked client code can
// import from it ( mirrors src/shared/availability/shareLabel.d.mts ). The runtime module
// is untyped .mjs shared with the Vercel api/*.mjs functions.

import type { AvailabilitySlot } from '@/shared/types/availability.ts'

export function tzOffsetMs(timeZone: string, utcMs: number): number

export function wallClockToUtc(
    timeZone: string,
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
): number

export interface WallClock {
    year: number
    month: number
    day: number
    hour: number
    minute: number
    weekday: number
}

export function utcToWallClock(timeZone: string, utcMs: number): WallClock

export function slotCoversInstant(slot: AvailabilitySlot, atUtc: number): boolean

export function nextOccurrenceStartUtc(slot: AvailabilitySlot, nowUtc: number): number

export function isAvailabilitySlot(value: unknown): value is AvailabilitySlot
