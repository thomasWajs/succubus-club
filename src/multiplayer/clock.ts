import { LamportClockVersion, PermanentId, Tick, VectorClockVersion } from '@/multiplayer/common.ts'
import { useCoreStore } from '@/store/core.ts'

/**
 * Lamport Clock
 */

export class LamportClock implements LamportClockVersion {
    constructor(
        public permId: PermanentId,
        public tick: Tick = 0, // Increment when we advance the clock
    ) {}

    // Advance when we send local mutations
    advance(): LamportClockVersion {
        // Increment tick
        this.tick++
        // We made the mutation, set our permid
        this.permId = useCoreStore().userProfile.permanentId
        return this
    }

    // Update when we receive remote mutations
    update(remote: LamportClockVersion): LamportClockVersion {
        // Update the tick
        this.tick = Math.max(this.tick, remote.tick) + 1
        // Set remote permId
        this.permId = remote.permId
        return this
    }

    compare(remote: LamportClockVersion): number {
        // Baseline case : ordered mutations
        if (this.tick !== remote.tick) {
            return this.tick - remote.tick
        }
        // Concurrent case : arbitrary consistent tie-breaker with permId
        return this.permId.localeCompare(remote.permId)
    }
}

/**
 * Vector Clock
 */

export enum ClockCompare {
    LowerThan,
    GreaterThan,
    Equals,
    Concurrent,
}

export class VectorClock {
    public readonly _version: VectorClockVersion
    private readonly selfPermId: PermanentId

    constructor(initial?: VectorClockVersion) {
        this._version = {}
        this.selfPermId = useCoreStore().userProfile.permanentId

        if (initial) {
            this.merge(initial)
        }
    }

    // Always returns a copy of the internal version, not a reference to the actual object !
    get version(): VectorClockVersion {
        return { ...this._version }
    }

    /** Get tick value for a player (defaults to 0) */
    get(permId: PermanentId): Tick {
        return this._version[permId] ?? 0
    }

    /** Increment the counter for a player */
    advance(): VectorClockVersion {
        this._version[this.selfPermId] = this.get(this.selfPermId) + 1
        return this.version
    }

    /** Merge another vector clock into this one (take max of each entry) */
    merge(remoteVersion: VectorClockVersion): VectorClockVersion {
        for (const permId in remoteVersion) {
            this._version[permId] = Math.max(this.get(permId), remoteVersion[permId])
        }
        return this.version
    }

    /** Compare two vector clocks */
    compare(remoteVersion: VectorClockVersion): ClockCompare {
        let less = false
        let greater = false

        const allPermIds = new Set([...Object.keys(this._version), ...Object.keys(remoteVersion)])
        for (const permId of allPermIds) {
            const localTick = this.get(permId)
            const remoteTick = remoteVersion[permId] ?? 0
            if (localTick < remoteTick) less = true
            if (localTick > remoteTick) greater = true
        }

        if (less && greater) return ClockCompare.Concurrent
        if (less) return ClockCompare.LowerThan
        if (greater) return ClockCompare.GreaterThan
        return ClockCompare.Equals
    }

    /**
     * Check if a mutation is the exact next one we’re waiting for.
     * - Sender's tick must be exactly +1 over local
     * - All others must be <= local
     */
    isNextMutation(remoteVersion: VectorClockVersion, remotePermId: PermanentId): boolean {
        const expected = this.get(remotePermId) + 1
        if (remoteVersion[remotePermId] !== expected) {
            return false
        }

        for (const [permId, tick] of Object.entries(remoteVersion)) {
            if (permId === remotePermId) continue
            if (tick > this.get(permId)) {
                return false
            }
        }
        return true
    }
}
