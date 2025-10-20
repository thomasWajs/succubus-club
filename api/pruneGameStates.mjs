import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs, deleteDoc } from 'firebase/firestore'

const firebase = initializeApp({
    apiKey: 'AIzaSyAZ7wlk6E0hdfS5amDZ2wkngTK1PlbhJQQ',
    authDomain: 'succubus-club.firebaseapp.com',
    databaseURL: 'https://succubus-club-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'succubus-club',
    storageBucket: 'succubus-club.firebasestorage.app',
    messagingSenderId: '491547084220',
    appId: '1:491547084220:web:5c1af516fdb41427e757b9',
})
const firestore = getFirestore(firebase)

const gameStateCollection = collection(firestore, 'gameStates')

export async function GET(request, response) {
    const authHeader = request.headers.get('authorization')

    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return response.status(401).json({ success: false })
    }

    const gsCollection = await getDocs(gameStateCollection)
    if (!gsCollection || gsCollection.empty) {
        return
    }

    for (const snapshot of gsCollection.docs) {
        const gameStateDoc = snapshot.data()
        if (gameStateDoc.ttl.toDate() < Date.now()) {
            await deleteDoc(snapshot.ref)
        }
    }

    response.status(200).json({ success: true })
}
