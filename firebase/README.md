# Firebase security rules

Source of truth for the Firebase security rules, kept in git so changes are reviewed
and versioned instead of being edited only in the console.

- `database.rules.json` — Realtime Database (RTDB): `gameRooms`, `lobbyChat`, `chatCooldown`
- `firestore.rules` — Firestore: `avatars`, `gameStates`, `availability`

Both are wired from the repo-root `firebase.json`.

## Access model

The backend is fronted by **App Check** (reCAPTCHA v3, configured via
`VITE_FIREBASE_APPCHECK_SITE_KEY`, see `initAppCheck` in
`src/client/gateway/realtime.ts`). App Check is the primary guard: it rejects
requests that don't originate from our real web app.

On top of App Check:

- **Legacy public paths** — `gameRooms` (RTDB), `avatars` and `gameStates`
  (Firestore). No auth, because they are written before an anonymous session is
  guaranteed, and they are keyed by the app's `permanentId` (not the auth uid) so
  per-user ownership can't be expressed. The rules keep them open but enforce
  strict **shape validation** so malformed or oversized documents are rejected.
- **Auth-gated paths** — `lobbyChat` / `chatCooldown` (RTDB) and `availability`
  (Firestore) require an anonymous-auth session and validate `auth.uid` ownership.
