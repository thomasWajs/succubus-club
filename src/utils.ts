export class TimeoutError extends Error {}

export function waitUntil(
    isTrue: () => boolean,
    interval: number,
    maxTry: number = 0,
    whenFalse?: () => void,
) {
    let attempts = 0

    return new Promise((resolve, reject) => {
        const intervalId = setInterval(() => {
            const ret = isTrue()
            if (ret) {
                clearInterval(intervalId)
                resolve(ret)
            } else {
                whenFalse?.()

                if (maxTry > 0 && ++attempts >= maxTry) {
                    clearInterval(intervalId)
                    reject(new TimeoutError('Timeout'))
                }
            }
        }, interval)
    })
}

// Directly taken from https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
export function shuffleArray<T>(array: T[]) {
    for (let i = array.length - 1; i >= 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[array[i], array[j]] = [array[j], array[i]]
    }
    return array
}

export class Mutex {
    private queue: Promise<void> = Promise.resolve()

    lock(): Promise<() => void> {
        let unlockNext: () => void
        const willLock = new Promise<void>(resolve => {
            unlockNext = () => resolve()
        })

        const willUnlock = this.queue.then(() => unlockNext)
        this.queue = willLock

        return willUnlock
    }

    async withLock<T>(callback: () => T | Promise<T>): Promise<T> {
        const unlock = await this.lock()
        try {
            return await callback()
        } finally {
            unlock()
        }
    }
}
