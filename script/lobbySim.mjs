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
    bots: int('BOTS', 20),
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
}

const ABLY_KEY = requireEnv('VITE_ABLY_API_KEY')
// In dev the lobby channel is prefixed (see lobby.ts). This script targets dev.
const LOBBY_CHANNEL = '{dev} Lobby'
const GAME_ROOMS_KEY = 'gameRooms'

// Shared metrics across all bots.
const metrics = {
    presenceEventsReceived: 0,
    presenceOps: 0, // enter/update/leave calls we issued
    presenceOpTotalMs: 0,
    presenceOpMaxMs: 0,
    errors: 0,
}

const bots = []
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
        const isHost = config.rtdb && i < config.rtdbRooms
        const bot = createBot(i, isHost)
        bots.push(bot)
        await bot.start()
        await sleep(config.rampMs)
    }

    log(`All ${bots.length} bots connected.`)
    startReporting()
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
            enableAids: true,
            allowSpectators: true,
            players: [permId],
            competingPlayers: [],
            spectators: [],
            judges: [],
        })
    }

    async function churnRoom() {
        if (!roomId) {
            return
        }
        // Toggle a field so the game-room list re-broadcasts to every lobby client.
        await rtdbUpdate(roomId, { isStarted: churnTick % 2 === 0 })
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
async function rtdbWrite(roomId, room) {
    await rtdb.db.set(roomRef(roomId), room)
}
async function rtdbUpdate(roomId, patch) {
    await rtdb.db.update(roomRef(roomId), patch)
}
async function rtdbRemove(roomId) {
    await rtdb.db.remove(roomRef(roomId))
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
