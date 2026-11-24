/**
 * Version comparison between clients, and between a client and the server.
 *
 * Versions are dotted numbers ( "1.12.3" ). Any change of version means a potential
 * change in the game mutations, so the rule is simple : everybody must run the same one,
 * and the older side is the one that has to reload.
 */

// A version that was not announced at all ( client from before the version announce )
// is older than any announced version.
function parseVersion(version: string | undefined): number[] | null {
    if (!version) {
        return null
    }
    return version.split('.').map(part => {
        const value = parseInt(part, 10)
        return Number.isNaN(value) ? 0 : value
    })
}

/**
 * Returns a negative number if `a` is older than `b`, a positive number if `a` is newer,
 * and 0 if they are the same.
 */
export function compareVersions(a: string | undefined, b: string | undefined): number {
    const partsA = parseVersion(a)
    const partsB = parseVersion(b)
    if (!partsA || !partsB) {
        return (partsA ? 1 : 0) - (partsB ? 1 : 0)
    }

    const length = Math.max(partsA.length, partsB.length)
    for (let i = 0; i < length; i++) {
        const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0)
        if (diff != 0) {
            return diff
        }
    }
    return 0
}

/**
 * The newest of the given versions, ignoring the missing ones.
 */
export function newestVersion(versions: (string | undefined)[]): string | undefined {
    let newest: string | undefined = undefined
    for (const version of versions) {
        if (version && compareVersions(version, newest) > 0) {
            newest = version
        }
    }
    return newest
}
