import { getFirestore } from 'firebase-admin/firestore'
import { firebaseAdminApp } from './firebaseConfig.mjs'

const firestore = getFirestore(firebaseAdminApp)
const gameStateCollection = firestore.collection('gameStates')

export async function GET(request) {
    const authHeader = request.headers.get('authorization')

    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return Response.json({ success: false }, { status: 401 })
    }

    const gsCollection = await gameStateCollection.get()
    if (!gsCollection || gsCollection.empty) {
        return Response.json({ success: true }, { status: 200 })
    }

    for (const snapshot of gsCollection.docs) {
        const gameStateDoc = snapshot.data()
        if (gameStateDoc.ttl.toDate() < Date.now()) {
            await snapshot.ref.delete()
        }
    }

    return Response.json({ success: true }, { status: 200 })
}
