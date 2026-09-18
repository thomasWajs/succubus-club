/*
 * One-off migration : converts legacy player-availability slots ( pre #257 / #258 -
 * weekly slots stored as a UTC minute-of-week range, one-time slots stored as a UTC
 * epoch range ) to the current AvailabilitySlot shape ( explicit timezone + weekday /
 * date + startHour + durationHours ; see src/shared/types/availability.ts ).
 *
 * Runs through the Firebase Admin SDK, which bypasses Firestore security rules, since
 * the `availability` collection is gated on `request.auth.uid == uid` per document
 * and a migration script has no such per-player auth session.
 *
 * The legacy fields carried no timezone ( they were UTC-only ), so every converted
 * slot is given `timezone: "UTC"` : this preserves the exact same absolute instants
 * the slot used to represent, just expressed in the new wall-clock shape.
 *
 * Setup :
 *   1. Firebase console > Project settings > Service accounts > Generate new private
 *      key, for whichever project holds the data to migrate ( succubus-club-dev or
 *      the prod project — dev and prod are separate Firebase projects ).
 *   2. GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node script/migrateAvailability.mjs [--dry-run]
 *
 * Safe to re-run : slots already in the current shape are left untouched, so a
 * partial or repeated run only ever touches what still needs converting.
 */

import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const DRY_RUN = process.argv.includes('--dry-run')

const MINUTES_PER_DAY = 1440
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY

function isCurrentSlot(slot) {
    return (
        typeof slot?.id === 'string' &&
        typeof slot?.timezone === 'string' &&
        Number.isFinite(slot?.startHour) &&
        Number.isFinite(slot?.durationHours)
    )
}

function isLegacyWeekly(slot) {
    return (
        slot?.recurrence === 'weekly' &&
        Number.isFinite(slot?.startMinuteOfWeekUtc) &&
        Number.isFinite(slot?.endMinuteOfWeekUtc)
    )
}

function isLegacyOnce(slot) {
    return (
        slot?.recurrence === 'once' &&
        Number.isFinite(slot?.startUtc) &&
        Number.isFinite(slot?.endUtc)
    )
}

function clampDurationHours(hours) {
    return Math.min(24, Math.max(1, Math.round(hours)))
}

function migrateWeekly(slot) {
    let spanMinutes = slot.endMinuteOfWeekUtc - slot.startMinuteOfWeekUtc
    if (spanMinutes <= 0) {
        // The old model allowed a slot to wrap past the end of the UTC week.
        spanMinutes += MINUTES_PER_WEEK
    }
    return {
        id: slot.id,
        category: slot.category,
        recurrence: 'weekly',
        timezone: 'UTC',
        weekday: Math.floor(slot.startMinuteOfWeekUtc / MINUTES_PER_DAY),
        startHour: Math.floor((slot.startMinuteOfWeekUtc % MINUTES_PER_DAY) / 60),
        durationHours: clampDurationHours(spanMinutes / 60),
    }
}

function migrateOnce(slot) {
    const start = new Date(slot.startUtc)
    return {
        id: slot.id,
        category: slot.category,
        recurrence: 'once',
        timezone: 'UTC',
        date: start.toISOString().slice(0, 10),
        startHour: start.getUTCHours(),
        durationHours: clampDurationHours((slot.endUtc - slot.startUtc) / 3600000),
    }
}

async function run() {
    const app = initializeApp({ credential: applicationDefault() })
    const db = getFirestore(app)

    const snapshot = await db.collectionGroup('players').get()
    let docsUpdated = 0
    let slotsMigrated = 0
    let slotsDropped = 0

    for (const doc of snapshot.docs) {
        const data = doc.data()
        if (!Array.isArray(data.slots)) {
            continue
        }

        let changed = false
        const migratedSlots = []
        for (const slot of data.slots) {
            if (isCurrentSlot(slot)) {
                migratedSlots.push(slot)
            } else if (isLegacyWeekly(slot)) {
                migratedSlots.push(migrateWeekly(slot))
                changed = true
                slotsMigrated++
            } else if (isLegacyOnce(slot)) {
                migratedSlots.push(migrateOnce(slot))
                changed = true
                slotsMigrated++
            } else {
                console.warn(`Dropping unrecognized slot on ${doc.ref.path} :`, slot)
                changed = true
                slotsDropped++
            }
        }

        if (!changed) {
            continue
        }

        docsUpdated++
        console.log(
            `${DRY_RUN ? '[dry-run] ' : ''}${doc.ref.path} : ${data.slots.length} -> ${migratedSlots.length} slot(s)`,
        )
        if (!DRY_RUN) {
            await doc.ref.update({ slots: migratedSlots })
        }
    }

    console.log(
        `\nDone${DRY_RUN ? ' (dry run, nothing written)' : ''}. ` +
            `${docsUpdated} document(s) touched, ${slotsMigrated} slot(s) migrated, ${slotsDropped} slot(s) dropped.`,
    )
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
