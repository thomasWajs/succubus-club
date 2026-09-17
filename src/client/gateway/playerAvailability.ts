import {
    ensureAnonymousAuth,
    fsCollection,
    fsDeleteDoc,
    fsDoc,
    fsOnSnapshot,
    fsSetDoc,
    getFirestore,
} from '@/client/gateway/realtime.ts'
import * as logging from '@/client/logging.ts'
import {
    AvailabilitySlot,
    PlayerAvailability,
    StoredPlayerAvailability,
} from '@/shared/types/availability.ts'
import { isAvailabilitySlot } from '@/shared/availability/recurrence.mjs'

// One Firestore document per player, per language, at availability/{lang}/players/{uid}.
// Reads are public ; writes are gated ( in the security rules ) on the anonymous-auth
// uid, which is the document id.
const AVAILABILITY_KEY = 'availability'
const PLAYERS_KEY = 'players'

// Kept in sync with the caps enforced by the security rules.
const MAX_SLOTS = 25
const MAX_NAME_LENGTH = 60

function playersCollection(languageCode: string) {
    return fsCollection(getFirestore(), AVAILABILITY_KEY, languageCode, PLAYERS_KEY)
}

// Subscribe to every player's availability for a language. Fires immediately with the
// current set and again on every change. Returns an unsubscribe function.
export function subscribePlayerAvailability(
    languageCode: string,
    onUpdate: (players: PlayerAvailability[]) => void,
): () => void {
    return fsOnSnapshot(playersCollection(languageCode), snapshot => {
        const players: PlayerAvailability[] = []
        snapshot.forEach(document => {
            const data = document.data() as StoredPlayerAvailability | undefined
            if (!data || !Array.isArray(data.slots)) {
                return
            }
            // Keep only slots matching the current model : legacy / malformed entries are
            // dropped rather than fed to the occurrence math, whose arithmetic would choke
            // on their missing fields.
            const slots = data.slots.filter(isAvailabilitySlot)
            players.push({
                uid: document.id,
                permId: typeof data.permId === 'string' ? data.permId : '',
                name: typeof data.name === 'string' ? data.name : '',
                slots,
            })
        })
        onUpdate(players)
    })
}

// Overwrite the current player's slots for a language. The document is keyed by the
// anonymous-auth uid, so a player only ever writes their own. Passing an empty slot
// list removes the document entirely.
export async function savePlayerAvailability(
    languageCode: string,
    permId: string,
    name: string,
    slots: AvailabilitySlot[],
): Promise<void> {
    try {
        const uid = await ensureAnonymousAuth()
        const playerDoc = fsDoc(playersCollection(languageCode), uid)

        if (slots.length === 0) {
            await fsDeleteDoc(playerDoc)
            return
        }

        const stored: StoredPlayerAvailability = {
            permId,
            name: name.slice(0, MAX_NAME_LENGTH),
            slots: slots.slice(0, MAX_SLOTS),
        }
        await fsSetDoc(playerDoc, stored)
    } catch (error) {
        logging.captureException(error)
    }
}

// Kick off the anonymous sign-in ahead of the first edit, to hide its latency.
export function warmUpAvailabilityAuth() {
    ensureAnonymousAuth().catch(logging.captureException)
}
