import { collection, deleteDoc, getDocs, getFirestore } from 'firebase/firestore'
import { firebaseApp } from './firebaseConfig.mjs'

const firestore = getFirestore(firebaseApp)
const gameStateCollection = collection(firestore, 'gameStates')

export async function GET(request) {
    const authHeader = request.headers.get('authorization')

    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return Response.json({ success: false }, { status: 401 })
    }

    const gsCollection = await getDocs(gameStateCollection)
    if (!gsCollection || gsCollection.empty) {
        return Response.json({ success: true }, { status: 200 })
    }

    for (const snapshot of gsCollection.docs) {
        const gameStateDoc = snapshot.data()
        if (gameStateDoc.ttl.toDate() < Date.now()) {
            await deleteDoc(snapshot.ref)
        }
    }

    return Response.json({ success: true }, { status: 200 })
}
