import { GovernDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'

// The Govern deck with equipment, retainers and the other cards put on a minion, to play many
// attachments in the harness
export const AttachDeck = <DeckList>{
    ...GovernDeck,
    '100001': 8, // .44 Magnum
    '101550': 8, // Raven Spy
    '100199': 8, // Blood Doll
    '101483': 8, // Preternatural Strength
}

// The Govern deck with Cats' Guidance and vampires with Animalism, to block and play it in the
// post block window in the harness ( kept apart: the attachment scenarios draw from AttachDeck )
export const PostBlockDeck = <DeckList>{
    ...GovernDeck,
    '100308': 8, // Cats' Guidance
    '200017': 2, // Aeron
    '200013': 2, // Adhiambo
}
