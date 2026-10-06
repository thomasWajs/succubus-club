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

    // Vampires with Potence
    '201613': 2, // Theo Bell
    '201576': 2, // Aline Gadeke
    '201585': 2, // Elen Kamjian
}
