/*
 * Empties the IP banlist from the SCS SQLite database (see src/server/banlist.ts
 * and src/server/persistence.ts). Run this to lift all bans, e.g. after tuning
 * the ban thresholds or clearing out false positives.
 *
 * Run:
 *   node script/clearBanlist.mjs
 *   SCS_DB_PATH=/path/to/game-server.db node script/clearBanlist.mjs
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const dbPath = process.env.SCS_DB_PATH || join(root, 'data', 'game-server.db')

const db = new Database(dbPath)

try {
    const result = db.prepare('DELETE FROM bans').run()
    console.log(`Cleared ${result.changes} ban(s) from ${dbPath}`)
} finally {
    db.close()
}
