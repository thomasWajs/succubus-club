/*
 * One-off migration : renames the `seats` column of the SCS `rooms` table to `roles`,
 * following the room.seats -> room.roles rename in src/server/persistence.ts ( Room.seats
 * -> Room.roles, RoomSeats -> RoomRoles ).
 *
 * The column only needs a rename, not a content rewrite : RoomSeats and RoomRoles are the
 * same shape ( Record<PermanentId, 'Player' | 'Judge' | 'Spectator'> ), so the JSON already
 * stored in the column stays valid as-is.
 *
 * Run from src/server ( same working directory the SCS server itself runs from, so that
 * the default SCS_DB_PATH resolves to the same file ) :
 *
 *   cd src/server
 *   npx tsx ../../script/migrateRoomRoles.ts [--dry-run]
 *
 * Or point at a specific database file :
 *
 *   SCS_DB_PATH=/path/to/game-server.db npx tsx script/migrateRoomRoles.ts [--dry-run]
 *
 * Safe to re-run : if the `roles` column already exists, the script does nothing.
 */

import Database from 'better-sqlite3'

const DB_PATH = process.env.SCS_DB_PATH || '../../data/game-server.db'
const DRY_RUN = process.argv.includes('--dry-run')

function run() {
    const db = new Database(DB_PATH)

    try {
        const columns = db.prepare('PRAGMA table_info(rooms)').all()
        const columnNames = columns.map(column => column.name)

        if (columnNames.includes('roles')) {
            console.log(`${DB_PATH} : rooms.roles already exists, nothing to do.`)
            return
        }

        if (!columnNames.includes('seats')) {
            console.warn(
                `${DB_PATH} : rooms table has neither 'seats' nor 'roles' column, skipping.`,
            )
            return
        }

        console.log(
            `${DRY_RUN ? '[dry-run] ' : ''}${DB_PATH} : renaming rooms.seats to rooms.roles`,
        )
        if (!DRY_RUN) {
            db.exec('ALTER TABLE rooms RENAME COLUMN seats TO roles')
        }

        console.log(`Done${DRY_RUN ? ' (dry run, nothing written)' : ''}.`)
    } finally {
        db.close()
    }
}

run()
