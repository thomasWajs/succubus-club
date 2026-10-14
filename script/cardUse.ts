import { GameState } from '@/shared/state/gameState.ts'
import { Card } from '@/shared/model/Card.ts'
import { CardOid, PlayerOid } from '@/shared/types/model.ts'
import { MinionActionType } from '@/shared/types/state.ts'
import { BotOption } from '@/shared/bot/types.ts'
import { BotStep } from '@/shared/bot/driver.ts'

/**
 * What became of each library card a Methuselah drew, to find the cards a bot leaves dead in its
 * hand: a card is dead when the engine offered a play of it at some decision and the bot never
 * played it. A card the engine never offered is not the bot's fault, so it is counted apart.
 */

export type CardFate = 'played' | 'discarded' | 'held' | 'other'

export type CardRecord = {
    name: string
    // The engine offered a play of the card (a discard is not a play) at some decision
    offered: boolean
    // The kinds of decision that offered a play of the card
    kinds: string[]
    fate: CardFate
}

const DISCARDS = new Set<BotOption['type']>(['discard', 'discardExcess', 'cleanup'])

function cardsOf(option: BotOption): Card[] {
    switch (option.type) {
        case 'declareAction':
            return option.action.type == MinionActionType.ActionCardFromHand ?
                    [option.action.card]
                :   []
        case 'playModifier':
            return [option.modifier.card]
        case 'cleanup':
            return option.cards
        default:
            return 'card' in option && option.card ? [option.card] : []
    }
}

export function createCardUse(gameState: GameState) {
    const records = new Map<
        CardOid,
        Omit<CardRecord, 'kinds'> & { kinds: Set<string>; owner: PlayerOid }
    >()
    let hands: Record<PlayerOid, Set<CardOid>> = {}

    return {
        // Call before each step: the hands, and the cards drawn since the last step
        before() {
            hands = {}
            for (const player of gameState.orderedPlayers) {
                const hand = new Set<CardOid>()
                for (const card of player.hand.cards) {
                    hand.add(card.oid)
                    if (!records.has(card.oid)) {
                        records.set(card.oid, {
                            name: card.name,
                            offered: false,
                            kinds: new Set(),
                            fate: 'held',
                            owner: player.oid,
                        })
                    }
                }
                hands[player.oid] = hand
            }
        },

        // Call after each step: what the decision offered and what the bot did
        after(step: BotStep) {
            const hand = hands[step.decision.player.oid]
            if (!hand) {
                return
            }
            for (const option of step.decision.options) {
                if (DISCARDS.has(option.type)) {
                    continue
                }
                for (const card of cardsOf(option)) {
                    const record = hand.has(card.oid) ? records.get(card.oid) : undefined
                    if (record) {
                        record.offered = true
                        record.kinds.add(step.decision.kind)
                    }
                }
            }
            const fate = DISCARDS.has(step.option.type) ? 'discarded' : 'played'
            for (const card of cardsOf(step.option)) {
                const record = hand.has(card.oid) ? records.get(card.oid) : undefined
                if (record) {
                    record.fate = fate
                }
            }
        },

        // Call when the game is over (the state may be gone): the cards in a hand at the last step are held, those gone with no play nor discard are other
        finish(): Record<PlayerOid, CardRecord[]> {
            const result: Record<PlayerOid, CardRecord[]> = {}
            const inHand = new Set<CardOid>()
            for (const [owner, hand] of Object.entries(hands)) {
                result[owner] = []
                for (const oid of hand) {
                    inHand.add(oid)
                }
            }
            for (const [oid, record] of records) {
                const fate = record.fate == 'held' && !inHand.has(oid) ? 'other' : record.fate
                result[record.owner]?.push({
                    name: record.name,
                    offered: record.offered,
                    kinds: [...record.kinds],
                    fate,
                })
            }
            return result
        },
    }
}
