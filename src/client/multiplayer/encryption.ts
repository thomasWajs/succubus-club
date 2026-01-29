// hardcode salt, we don't care about rainbow attack.
const SALT = 'salt'

export type Key = {
    buffer: ArrayBuffer
    hash: string
}

export async function computeKey(password: string): Promise<Key> {
    const encoder = new TextEncoder()
    const saltBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(SALT))
    const salt = new Uint8Array(saltBuffer.slice(0, 16)) // Use first 16 bytes

    const cryptoKey = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations: 100000,
            hash: 'SHA-256',
        },
        await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
            'deriveKey',
        ]),
        { name: 'AES-CBC', length: 256 },
        true,
        ['encrypt', 'decrypt'],
    )
    // Export the CryptoKey to ArrayBuffer for Ably
    const buffer = await crypto.subtle.exportKey('raw', cryptoKey)
    // Compute the key hash for quick comparison
    const hash = Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
    return { buffer, hash }
}
