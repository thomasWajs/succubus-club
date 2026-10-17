import { Player } from '@/shared/model/Player.ts'
import { DeckList } from '@/shared/types/gateway.ts'

// The decklist of a player rebuilt from the game: every card it owns, in whatever region it is now
export function ownDeckOf(player: Player): DeckList {
    const deck: DeckList = {}
    for (const card of Object.values(player.gameState.cards)) {
        const krcgId = card.krcgId
        if (card.ownerOid == player.oid && krcgId) {
            deck[krcgId] = (deck[krcgId] ?? 0) + 1
        }
    }
    return deck
}
