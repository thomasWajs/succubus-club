/*
 * Lobby load simulator.
 *
 * Opens N *real* Ably connections that enter presence on the dev lobby channel,
 * exactly like a browser tab does (see src/client/multiplayer/lobby.ts and
 * src/client/gateway/realtime.ts). Use it to reproduce the instability reported
 * at 20+ concurrent users on a local dev environment.
 *
 * Run:
 *   node loadtest/lobbySim.mjs
 *   BOTS=30 CHURN_MS=1500 node loadtest/lobbySim.mjs
 *   RTDB=1 RTDB_ROOMS=5 node loadtest/lobbySim.mjs   # also churn the game-room list
 *   ROOM_LIFECYCLE=1 BOTS=14 node loadtest/lobbySim.mjs   # play out room join / role-swap scenarios
 *
 * Stop with Ctrl-C: it leaves presence, deletes any rooms it created, and closes
 * every connection cleanly.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Ably from 'ably'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// The client reads import.meta.env.VITE_* (Vite injects them). A plain Node
// script has no bundler, so load them from .env.local ourselves.
loadEnvLocal(join(root, '.env.local'))

/**
 * Config (all overridable via env vars)
 */
const config = {
    bots: int('BOTS', 28),
    // Delay between each bot connecting, to spread the ramp-up (ms).
    rampMs: int('RAMP_MS', 200),
    // How often each bot mutates its presence (username / ready toggle). 0 disables churn.
    churnMs: int('CHURN_MS', 3000),
    // Every Nth churn tick, a bot fully leaves and re-enters (heaviest presence event).
    rejoinEvery: int('REJOIN_EVERY', 8),
    // Metrics print interval (ms).
    reportMs: int('REPORT_MS', 5000),

    // --- RTDB game-room simulation (OFF by default) ---
    // Set RTDB=1 to also write/delete rooms in the Firebase RTDB game-room list.
    // Left disabled for now: it touches the shared dev database and needs cleanup.
    rtdb: bool('RTDB', false),
    // How many of the bots also act as room hosts when RTDB is enabled.
    rtdbRooms: int('RTDB_ROOMS', 5),
    // How often a hosting bot rewrites/toggles its room (ms).
    rtdbChurnMs: int('RTDB_CHURN_MS', 4000),

    // --- Room lifecycle scenario (implies RTDB) ---
    // With ROOM_LIFECYCLE=1 the bots stop just creating+leaving rooms. Instead they are
    // grouped into rooms and play out a realistic sequence: the first bot creates the
    // room, the next 4 join as players (filling MAX_PLAYERS), one more joins and moves to
    // judge, one more joins and stays a spectator, then players and spectators swap roles.
    // Roles are written the way the client now does : each move is a per-user child write on
    // the roles map. Joins and swaps still overlap on purpose (see joinJitterMs), but because
    // each user owns their own roles key, the concurrent writes merge instead of clobbering :
    // the audit should stay clean, confirming roles no longer jump between players/spectators
    // and users no longer vanish.
    roomLifecycle: bool('ROOM_LIFECYCLE', false),
    // Bots per simulated room : 1 host + 4 players + 1 judge + 1 spectator.
    roomSize: int('ROOM_SIZE', 7),
    // Delay between the scripted phases of a room lifecycle (ms).
    stepMs: int('STEP_MS', 500),
    // Stagger between joins/swaps fired within a phase (ms). Smaller = more collisions.
    joinJitterMs: int('JOIN_JITTER_MS', 40),
    // Pause before a group tears its room down and starts a fresh one (ms).
    lifecycleLoopMs: int('LIFECYCLE_LOOP_MS', 5000),
}

// The lifecycle scenario is built on the RTDB game-room list.
if (config.roomLifecycle) {
    config.rtdb = true
}

const ABLY_KEY = requireEnv('VITE_ABLY_API_KEY')
// In dev the lobby channel is prefixed (see lobby.ts). This script targets dev.
const LOBBY_CHANNEL = '{dev} Lobby'
const GAME_ROOMS_KEY = 'gameRooms'

// Room role model, mirrored from src/shared (this plain-Node script has no bundler, so it
// can't import the TS shared code). A room stores its roles as a single permId -> role map
// ( gameRoom.roles ), so a user holds exactly one role and can never appear twice.
const RoomRole = { Player: 'Player', Judge: 'Judge', Spectator: 'Spectator' }
const MAX_PLAYERS = 5

// Shared metrics across all bots.
const metrics = {
    presenceEventsReceived: 0,
    presenceOps: 0, // enter/update/leave calls we issued
    presenceOpTotalMs: 0,
    presenceOpMaxMs: 0,
    errors: 0,
}

const bots = []
const lifecycleRooms = new Set()
let rtdb = null
let stopping = false

async function main() {
    log(
        `Starting ${config.bots} bots on channel "${LOBBY_CHANNEL}" ` +
            `(churn=${config.churnMs}ms, rtdb=${config.rtdb ? 'ON' : 'off'})`,
    )

    if (config.rtdb) {
        rtdb = await initRtdb()
    }

    for (let i = 0; i < config.bots; i++) {
        // In lifecycle mode the room orchestration owns the rooms, so bots don't
        // auto-create their own via the churn path.
        const isHost = config.rtdb && !config.roomLifecycle && i < config.rtdbRooms
        const bot = createBot(i, isHost)
        bots.push(bot)
        await bot.start()
        await sleep(config.rampMs)
    }

    log(`All ${bots.length} bots connected.`)
    startReporting()

    if (config.roomLifecycle) {
        startRoomLifecycles()
    }
}

/**
 * A single simulated user.
 */
function createBot(index, isHost) {
    const permId = randomUUID()
    const user = {
        permId,
        name: `bot-${String(index).padStart(2, '0')}`,
        avatarId: null,
        isReady: false,
    }

    const ably = new Ably.Realtime({
        key: ABLY_KEY,
        clientId: permId,
        echoMessages: false, // matches getAbly() in realtime.ts
    })
    const channel = ably.channels.get(LOBBY_CHANNEL)

    let churnTimer = null
    let rtdbTimer = null
    let churnTick = 0
    let roomId = null

    async function timedPresence(action, arg) {
        const t0 = now()
        try {
            await channel.presence[action](arg)
        } catch {
            metrics.errors++
            return
        }
        const dt = now() - t0
        metrics.presenceOps++
        metrics.presenceOpTotalMs += dt
        metrics.presenceOpMaxMs = Math.max(metrics.presenceOpMaxMs, dt)
    }

    async function start() {
        await channel.attach()
        // Every bot subscribes, so it pays the same receive cost a real client does.
        channel.presence.subscribe(() => {
            metrics.presenceEventsReceived++
        })
        await timedPresence('enter', user)

        if (config.churnMs > 0) {
            churnTimer = setInterval(churn, config.churnMs)
        }
        if (isHost) {
            await createRoom()
            rtdbTimer = setInterval(churnRoom, config.rtdbChurnMs)
        }
    }

    async function churn() {
        churnTick++
        // Occasionally fully leave + re-enter (the heaviest presence transition).
        if (churnTick % config.rejoinEvery === 0) {
            await timedPresence('leave', user)
            await timedPresence('enter', user)
            return
        }
        // Otherwise mimic the debounced username/ready update from setupSelfUserWatcher().
        user.isReady = !user.isReady
        user.name = `bot-${String(index).padStart(2, '0')}~${churnTick}`
        await timedPresence('update', user)
    }

    /**
     * Optional RTDB room simulation (only runs when RTDB=1).
     */
    async function createRoom() {
        roomId = `room-loadtest-${permId.slice(0, 8)}`
        await rtdbWrite(roomId, {
            id: roomId,
            name: `LoadTest ${user.name}`,
            hostId: permId,
            communication: 'Ably',
            isStarted: false,
            isSavedGame: false,
            hasPassword: false,
            passwordHash: '',
            isCasual: true,
            allowSpectators: true,
            isFreeTable: false,
            roles: { [permId]: RoomRole.Player },
            competingPlayers: [],
        })
    }

    async function churnRoom() {
        if (!roomId) {
            return
        }
        // Toggle a field so the game-room list re-broadcasts to every lobby client.
        await rtdbUpdateRoom(roomId, { isStarted: churnTick % 2 === 0 })
    }

    async function stop() {
        if (churnTimer) clearInterval(churnTimer)
        if (rtdbTimer) clearInterval(rtdbTimer)
        try {
            if (roomId) {
                await rtdbRemove(roomId)
            }
            await channel.presence.leave(user)
            await channel.detach()
        } catch {
            // best-effort teardown
        }
        ably.close()
    }

    return {
        start,
        stop,
        get permId() {
            return permId
        },
    }
}

/**
 * RTDB helpers (lazy - only imported/used when enabled).
 */
async function initRtdb() {
    const { initializeApp } = await import('firebase/app')
    const db = await import('firebase/database')
    const app = initializeApp({
        apiKey: requireEnv('VITE_FIREBASE_API_KEY'),
        authDomain: requireEnv('VITE_FIREBASE_AUTH_DOMAIN'),
        databaseURL: requireEnv('VITE_FIREBASE_DATABASE_URL'),
        projectId: requireEnv('VITE_FIREBASE_PROJECT_ID'),
    })
    return { db, database: db.getDatabase(app) }
}

function roomRef(roomId) {
    return rtdb.db.ref(rtdb.database, `${GAME_ROOMS_KEY}/${roomId}`)
}
function rolesRef(roomId) {
    return rtdb.db.ref(rtdb.database, `${GAME_ROOMS_KEY}/${roomId}/roles`)
}
async function rtdbWrite(roomId, room) {
    await rtdb.db.set(roomRef(roomId), room)
}
async function rtdbUpdateRoom(roomId, patch) {
    await rtdb.db.update(roomRef(roomId), patch)
}
async function rtdbRemove(roomId) {
    await rtdb.db.remove(roomRef(roomId))
}
async function rtdbReadRoom(roomId) {
    const snapshot = await rtdb.db.get(roomRef(roomId))
    return snapshot.exists() ? snapshot.val() : null
}
// Per-user role child write : merges with concurrent writes on other users' keys.
async function rtdbUpdateRoles(roomId, patch) {
    await rtdb.db.update(rolesRef(roomId), patch)
}

/**
 * Room role helpers, mirrored from src/shared/multiplayer/roles.ts. Roles live in a single
 * permId -> role map, so exclusivity is structural : no clearing of parallel arrays.
 */
function normalizeRoom(room) {
    // RTDB strips empty containers, so re-default the map exactly like syncGameRooms does.
    room.roles ??= {}
}
function getRoomRole(room, permId) {
    return room.roles[permId] ?? null
}
function countPlayers(roles) {
    return Object.values(roles).filter(role => role === RoomRole.Player).length
}
function getRolePermIds(room, role) {
    return Object.keys(room.roles).filter(permId => room.roles[permId] === role)
}
function resolveRoomRole(room, permId) {
    const current = getRoomRole(room, permId)
    if (current) {
        return current
    }
    return countPlayers(room.roles) < MAX_PLAYERS ? RoomRole.Player : RoomRole.Spectator
}

/**
 * Room lifecycle scenario.
 *
 * Group the bots into rooms and run a realistic join / role-change sequence per room.
 * Role writes go through the same per-user protocol the client now uses : a child write on the
 * roles map, one key per user. Because each user owns their own key, overlapping writes merge
 * instead of clobbering, so the audit should stay clean ( the fix for roles jumping and users
 * vanishing ).
 */
function startRoomLifecycles() {
    const groups = []
    for (let i = 0; i < bots.length; i += config.roomSize) {
        groups.push(bots.slice(i, i + config.roomSize))
    }
    log(`Room lifecycle: ${groups.length} room(s), up to ${config.roomSize} bots each`)
    for (const group of groups) {
        runRoomLifecycle(group).catch(e => {
            metrics.errors++
            log(`lifecycle error: ${e && e.message ? e.message : e}`)
        })
    }
}

async function runRoomLifecycle(group) {
    const host = group[0]
    while (!stopping) {
        const roomId = await createLifecycleRoom(host)
        const participants = [host.permId]

        // The next 4 bots join as players (host + 4 = MAX_PLAYERS). Fired with a stagger
        // so near-simultaneous joins race on the whole-object write.
        const players = group.slice(1, 5)
        await fireStaggered(players.map(bot => () => joinSeat(roomId, bot.permId)))
        players.forEach(bot => participants.push(bot.permId))
        await sleep(config.stepMs)

        // One more bot joins (table full -> lands spectator) then moves to judge.
        const judge = group[5]
        if (judge) {
            await joinSeat(roomId, judge.permId)
            participants.push(judge.permId)
            await sleep(config.stepMs)
            await moveRole(roomId, judge.permId, RoomRole.Judge)
            await sleep(config.stepMs)
        }

        // One more bot joins and stays a spectator (table full).
        const spectator = group[6]
        if (spectator) {
            await joinSeat(roomId, spectator.permId)
            participants.push(spectator.permId)
            await sleep(config.stepMs)
        }

        // Some players -> spectators and some spectators -> players, concurrently.
        await shuffleSeats(roomId, group)
        await sleep(config.stepMs)

        // Surface any role that jumped or user that vanished during the churn.
        await auditRoom(roomId, participants)

        // Tear the room down and start a fresh cycle.
        await rtdbRemove(roomId)
        lifecycleRooms.delete(roomId)
        await sleep(config.lifecycleLoopMs)
    }
}

async function createLifecycleRoom(host) {
    const roomId = `room-lifecycle-${host.permId.slice(0, 8)}`
    lifecycleRooms.add(roomId)
    await rtdbWrite(roomId, {
        id: roomId,
        name: `Lifecycle ${host.permId.slice(0, 4)}`,
        hostId: host.permId,
        communication: 'Ably',
        isStarted: false,
        isSavedGame: false,
        hasPassword: false,
        passwordHash: '',
        isCasual: true,
        allowSpectators: true,
        isFreeTable: false,
        roles: { [host.permId]: RoomRole.Player },
        competingPlayers: [],
    })
    return roomId
}

async function shuffleSeats(roomId, group) {
    const room = await rtdbReadRoom(roomId)
    if (!room) {
        return
    }
    normalizeRoom(room)
    const hostId = group[0].permId
    const toSpectator = getRolePermIds(room, RoomRole.Player)
        .filter(permId => permId !== hostId)
        .slice(0, 2)
    const toPlayer = getRolePermIds(room, RoomRole.Spectator).slice(0, 2)
    await fireStaggered([
        ...toSpectator.map(permId => () => moveRole(roomId, permId, RoomRole.Spectator)),
        ...toPlayer.map(permId => () => moveRole(roomId, permId, RoomRole.Player)),
    ])
}

/**
 * Join a room : resolve the role client-side ( player while there is room, else spectator ),
 * then persist it with a per-user child write, mirroring commitRoomRole. MAX_PLAYERS is only
 * guarded optimistically ( resolveRoomRole ), like the client.
 */
async function joinSeat(roomId, permId) {
    const room = await rtdbReadRoom(roomId)
    if (!room) {
        return null
    }
    normalizeRoom(room)
    const role = resolveRoomRole(room, permId)
    await rtdbUpdateRoles(roomId, { [permId]: role })
    return role
}

/**
 * Deliberately move a seated user to another role, mirroring commitRoomRole : a per-user child
 * write on the roles map, which merges with concurrent moves on other users.
 */
async function moveRole(roomId, permId, role) {
    await rtdbUpdateRoles(roomId, { [permId]: role })
}

/**
 * Fire each action after a short stagger, then wait for them all. With a stagger smaller than
 * an RTDB round-trip the writes overlap, but each targets its own roles key, so they merge.
 */
async function fireStaggered(actions) {
    const jobs = []
    for (const action of actions) {
        if (stopping) {
            break
        }
        jobs.push(action())
        await sleep(config.joinJitterMs)
    }
    await Promise.all(jobs)
}

/**
 * Read the room back and flag the reported symptoms : a participant sitting in no role
 * (vanished), or the table over capacity. A participant in two roles at once is now
 * structurally impossible ( one key per user in the roles map ), which is the point.
 */
async function auditRoom(roomId, participants) {
    const room = await rtdbReadRoom(roomId)
    if (!room) {
        return
    }
    normalizeRoom(room)
    const problems = []
    for (const permId of participants) {
        if (!getRoomRole(room, permId)) {
            problems.push(`${permId.slice(0, 4)} vanished (in no role)`)
        }
    }
    const players = getRolePermIds(room, RoomRole.Player).length
    if (players > MAX_PLAYERS) {
        problems.push(`players over capacity (${players}/${MAX_PLAYERS})`)
    }
    const summary =
        `players=${players} judges=${getRolePermIds(room, RoomRole.Judge).length} ` +
        `spectators=${getRolePermIds(room, RoomRole.Spectator).length}`
    if (problems.length) {
        metrics.errors += problems.length
        log(`ANOMALY ${roomId}: ${summary} :: ${problems.join('; ')}`)
    } else {
        log(`ok ${roomId}: ${summary}`)
    }
}

/**
 * Metrics reporting
 */
function startReporting() {
    let totalEvents = 0
    setInterval(() => {
        // All figures below are per interval : op latency recovers between bursts, so a
        // cumulative avg/max would hide that. Reset the accumulators after each report.
        const avgOp =
            metrics.presenceOps ? (metrics.presenceOpTotalMs / metrics.presenceOps).toFixed(0) : '0'
        totalEvents += metrics.presenceEventsReceived
        log(
            `events=${metrics.presenceEventsReceived} (total ${totalEvents}) ` +
                `ops=${metrics.presenceOps} ` +
                `avgOp=${avgOp}ms maxOp=${metrics.presenceOpMaxMs.toFixed(0)}ms ` +
                `errors=${metrics.errors}`,
        )
        metrics.presenceEventsReceived = 0
        metrics.presenceOps = 0
        metrics.presenceOpTotalMs = 0
        metrics.presenceOpMaxMs = 0
        metrics.errors = 0
    }, config.reportMs)
}

/**
 * Teardown
 */
async function shutdown() {
    if (stopping) {
        return
    }
    stopping = true
    log(`Shutting down ${bots.length} bots...`)
    await Promise.all(bots.map(b => b.stop()))
    if (rtdb && lifecycleRooms.size) {
        await Promise.all([...lifecycleRooms].map(id => rtdbRemove(id).catch(() => {})))
    }
    log('Done.')
    process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

/**
 * Small utilities
 */
function now() {
    return Number(process.hrtime.bigint() / 1000000n)
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}
function log(msg) {
    const t = new Date().toISOString().slice(11, 23)
    console.log(`[${t}] ${msg}`)
}
function int(name, fallback) {
    const v = process.env[name]
    return v === undefined || v === '' ? fallback : Number.parseInt(v, 10)
}
function bool(name, fallback) {
    const v = process.env[name]
    if (v === undefined || v === '') {
        return fallback
    }
    return v === '1' || v.toLowerCase() === 'true'
}
function requireEnv(name) {
    const v = process.env[name]
    if (!v) {
        throw new Error(`Missing required env var ${name} (expected in .env.local)`)
    }
    return v
}
function loadEnvLocal(path) {
    let content
    try {
        content = readFileSync(path, 'utf8')
    } catch {
        throw new Error(`Cannot read ${path} - run from the repo root`)
    }
    for (const raw of content.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) {
            continue
        }
        const eq = line.indexOf('=')
        if (eq === -1) {
            continue
        }
        const key = line.slice(0, eq).trim()
        let value = line.slice(eq + 1).trim()
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1)
        }
        if (process.env[key] === undefined) {
            process.env[key] = value
        }
    }
}

main().catch(e => {
    console.error(e)
    process.exit(1)
})
