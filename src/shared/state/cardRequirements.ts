import { LibraryCard } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'

/**
 * What a player must control to play a library card, on top of its cost.
 */

// The clan of a library card means "requires a ready vampire of this clan" ( "A/B": either one )
export function meetsClanRequirement(player: Player, card: LibraryCard): boolean {
    if (!card.clan) {
        return true
    }
    const clans = card.clan.split('/').map(clan => clan.toLowerCase())
    return player.vampiresReady.some(vampire =>
        clans.includes(vampire.vampireAttrs.clan.toLowerCase()),
    )
}

// Another copy of a unique card is in play ( in anybody's ready region, the bot's own
// included ): this one cannot be played. The "contesting" rule is ignored.
export function hasUniqueCopyInPlay(player: Player, card: LibraryCard): boolean {
    if (!card.isUnique) {
        return false
    }
    return Object.values(player.gameState.players).some(holder =>
        holder.ready.cards.some(
            inPlay =>
                inPlay !== card && inPlay instanceof LibraryCard && inPlay.krcgId == card.krcgId,
        ),
    )
}
