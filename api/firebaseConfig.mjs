import { cert, getApps, initializeApp } from 'firebase-admin/app'

// Runs through the Firebase Admin SDK, which bypasses security rules and App Check
// enforcement : crons and webhooks have no per-player auth session or browser context to
// obtain an App Check token. Credentials come from a service-account JSON in the
// FIREBASE_SERVICE_ACCOUNT env var ( set per Vercel environment, since dev and prod are
// separate Firebase projects ).
export const firebaseAdminApp =
    getApps().length ?
        getApps()[0]
    :   initializeApp({
            credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
            databaseURL: process.env.VITE_FIREBASE_DATABASE_URL,
        })
