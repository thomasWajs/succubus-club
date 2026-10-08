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
    '102113': 8, // Vessel
    '100866': 8, // Guardian Angel
    '100913': 8, // Heroic Might
}

// The Govern deck with the Animalism cards that hurt, to fight with them in the harness
export const CrowsDeck = <DeckList>{
    ...GovernDeck,
    '100301': 8, // Carrion Crows
    '100515': 8, // Deep Song
    '101254': 8, // Murder of Crows
}

// The Govern deck with Cats' Guidance and vampires with Animalism, to block and play it in the
// post block window in the harness ( kept apart: the attachment scenarios draw from AttachDeck )
export const PostBlockDeck = <DeckList>{
    ...GovernDeck,
    '100308': 8, // Cats' Guidance
    '200017': 2, // Aeron
    '200013': 2, // Adhiambo
}
