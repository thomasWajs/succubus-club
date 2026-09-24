import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import {
    isAvailabilitySlot,
    nextOccurrenceStartUtc,
} from '../src/shared/availability/recurrence.mjs'

// Removes "once" availability slots whose occurrence ended more than 12h ago. They can
// never recur, so once that grace window has passed they only clutter every viewer's
// calendar. Recurring slots ( weekly / biweekly / monthly ) are always kept.
//
// Runs through the Firebase Admin SDK, which bypasses Firestore security rules : the
// `availability` collection is gated on `request.auth.uid == uid` per document
// ( see firebase/firestore.rules ), and a cron has no such per-player auth session. The
// credentials come from a service-account JSON in the FIREBASE_SERVICE_ACCOUNT env var
// ( set per Vercel environment, since dev and prod are separate Firebase projects ).

const GRACE_MS = 24 * 60 * 60 * 1000

const app =
    getApps().length ?
        getApps()[0]
    :   initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) })
const db = getFirestore(app)

// A one-time slot is stale once its occurrence's end is more than GRACE_MS in the past.
// Malformed / legacy entries are left untouched : the shape guard keeps the occurrence
// math from choking on missing fields, and pruning is not this cron's job to fix.
function isStaleOnceSlot(slot, nowUtc) {
    if (slot?.recurrence !== 'once' || !isAvailabilitySlot(slot)) {
        return false
    }
    const end = nextOccurrenceStartUtc(slot, nowUtc) + slot.durationHours * 3600000
    return end < nowUtc - GRACE_MS
}

export async function GET(request) {
    const authHeader = request.headers.get('authorization')

    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return Response.json({ success: false }, { status: 401 })
    }

    const nowUtc = Date.now()
    const snapshot = await db.collectionGroup('players').get()

    let removed = 0
    let docsUpdated = 0
    let docsDeleted = 0

    for (const doc of snapshot.docs) {
        const data = doc.data()
        if (!Array.isArray(data.slots)) {
            continue
        }

        const kept = data.slots.filter(slot => !isStaleOnceSlot(slot, nowUtc))
        if (kept.length === data.slots.length) {
            continue
        }

        removed += data.slots.length - kept.length
        // A player document with no slots left carries no information, so drop it
        // entirely rather than storing an empty list ( matching savePlayerAvailability ).
        if (kept.length === 0) {
            await doc.ref.delete()
            docsDeleted++
        } else {
            await doc.ref.update({ slots: kept })
            docsUpdated++
        }
    }

    return Response.json({ success: true, removed, docsUpdated, docsDeleted }, { status: 200 })
}
