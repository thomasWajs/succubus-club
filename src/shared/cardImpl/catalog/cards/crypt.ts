import { ABRAHAM_MELLON_ID } from '@/shared/cardImpl/cardIds.ts'
import { defineCrypt } from '@/shared/cardImpl/catalog/builders.ts'

export const CRYPT_CARDS = [
    defineCrypt('201628', 'Jason "Son" Newberry', { bleed: 1 }),
    defineCrypt(ABRAHAM_MELLON_ID, 'Abraham Mellon', { handSize: 1 }),
    defineCrypt('201614', 'Valeriya Zinovieva', { strength: 1 }),
    defineCrypt('201613', 'Theo Bell', { strength: 1, canEnterCombat: true }),
    defineCrypt('200132', 'Ariane', { undirectedStealth: -1 }),
    defineCrypt('201585', 'Elen Kamjian', { mustBleedWhileMinionLocked: true }),
]
