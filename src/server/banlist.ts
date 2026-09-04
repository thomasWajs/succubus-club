import logger from './logger.ts'
import { BanRecord, saveBan } from './persistence.ts'

/**
 * Behavior-based IP banlist.
 *
 * Some clients (likely bots) connect repeatedly without ever sending a SetUser
 * message, getting kicked by the SetUser timeout, then reconnecting in a loop.
 * We track those failed connections per IP and, past a threshold within a
 * sliding window, ban the IP for a while so verifyClient can refuse it upfront.
 */

// Number of failed (no-SetUser) connections within the window before banning.
// A working client sends SetUser within seconds, so repeatedly connecting and
// staying silent is almost certainly a bot: we can keep this low safely.
const BAN_THRESHOLD = parseInt(process.env.SCS_BAN_THRESHOLD ?? '3')

// Sliding window over which failures are counted.
const BAN_WINDOW_MS = parseInt(process.env.SCS_BAN_WINDOW_MS ?? String(10 * 60_000))

// How long an IP stays banned once the threshold is reached.
const BAN_DURATION_MS = parseInt(process.env.SCS_BAN_DURATION_MS ?? String(6 * 60 * 60_000))

type BanEntry = {
    // Timestamps of recent failed connections (within the window).
    failures: number[]
    // Epoch ms until which the IP is banned, or 0 when not banned.
    bannedUntil: number
}

const entries = new Map<string, BanEntry>()

function getEntry(ip: string): BanEntry {
    let entry = entries.get(ip)
    if (!entry) {
        entry = { failures: [], bannedUntil: 0 }
        entries.set(ip, entry)
    }
    return entry
}

/**
 * Whether the given IP is currently banned.
 * Also lazily forgets IPs whose ban and failures have fully expired.
 */
export function isBanned(ip: string): boolean {
    const entry = entries.get(ip)
    if (!entry) {
        return false
    }

    const now = Date.now()

    if (entry.bannedUntil > now) {
        return true
    }

    // Ban expired (or never set): drop stale failures outside the window.
    entry.bannedUntil = 0
    entry.failures = entry.failures.filter(timestamp => now - timestamp < BAN_WINDOW_MS)

    if (entry.failures.length === 0) {
        entries.delete(ip)
    }

    return false
}

/**
 * Record a connection that was closed for never identifying (no SetUser).
 * Bans the IP once too many failures happen within the window.
 */
export function recordFailedConnection(ip: string): void {
    const now = Date.now()
    const entry = getEntry(ip)

    entry.failures = entry.failures.filter(timestamp => now - timestamp < BAN_WINDOW_MS)
    entry.failures.push(now)

    if (entry.failures.length >= BAN_THRESHOLD) {
        entry.bannedUntil = now + BAN_DURATION_MS
        entry.failures = []
        saveBan(ip, entry.bannedUntil)
        logger.warn(
            `Banned IP ${ip} for ${Math.round(BAN_DURATION_MS / 60_000)}min - ` +
                `${BAN_THRESHOLD} failed connections (no SetUser) within ` +
                `${Math.round(BAN_WINDOW_MS / 60_000)}min`,
        )
    }
}

/**
 * Load still-active bans from persistence into memory. Call once at startup so
 * bans survive a server restart.
 */
export function restoreBans(bans: BanRecord[]): void {
    for (const ban of bans) {
        entries.set(ban.ip, { failures: [], bannedUntil: ban.bannedUntil })
    }
}
