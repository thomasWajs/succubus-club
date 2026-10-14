/**
 * The user's moves, read as decisions for the rules engine ( GameType.Engine ).
 *
 * The engine offers options ; the user acts on the table as usual ( drag a
 * card, influence a vampire, lock a minion, declare an action or a block,
 * go to the next phase ). Each move is matched to the options it can mean :
 * a single one is taken ; several are put forward in the decision panel,
 * which also holds the options no move expresses ( a value for X, a vote... ).
 * The move itself is never applied : the engine's answer moves the table.
 */

import { AnyGameMutation } from '@/shared/state/gameMutations.ts'
import { Card } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { MinionAction, MinionActionType, NO_BLOCK } from '@/shared/types/state.ts'
import { EngineOption } from '@/client/engine/protocol.ts'
import { Projection } from '@/client/engine/projection.ts'
import { getCardRectangle } from '@/client/game/utils.ts'

// What an option names, as cards on the table
type Named = {
    option: EngineOption
    card?: Card
    minion?: Card
    actor?: Card
    target?: Card
    targetPlayer?: Player
}

// The engine's action kinds ( EngineOption.action ) for the actions declared here
const ACTIONS: Partial<Record<MinionActionType, string[]>> = {
    [MinionActionType.Bleed]: ['bleed'],
    [MinionActionType.Hunt]: ['hunt'],
    [MinionActionType.LeaveTorpor]: ['leave torpor'],
    [MinionActionType.RescueFromTorpor]: ['rescue'],
    [MinionActionType.Diablerize]: ['diablerie'],
}

function named(projection: Projection, option: EngineOption): Named {
    const target = option.target
    return {
        option,
        card: projection.card(option.card?.copy),
        minion: projection.minion(option.minion),
        actor: projection.minion(option.actor),
        target:
            target?.kind == 'minion' ? projection.minion(target.minion)
            : target?.kind == 'card' ? projection.card(target.copy)
            : undefined,
        targetPlayer: target?.kind == 'seat' ? projection.player(target.seat) : undefined,
    }
}

function is(a: Card | undefined, b: Card | undefined) {
    return !!a && !!b && a.oid == b.oid
}

// The option's card is the card moved, or a copy alike : copies alike in hand ( or stored on the
// same card ) are one choice, about the first of them ( see Projection.alike )
function isMoved(projection: Projection, a: Card | undefined, moved: Card) {
    return !!a && projection.alike(moved).some(card => card.oid == a.oid)
}

// Any role of the option is this card
function names(n: Named, card: Card) {
    return is(n.card, card) || is(n.minion, card) || is(n.actor, card) || is(n.target, card)
}

// The card under a point of a play region, topmost first ( a card dropped onto a minion )
function cardAt(region: AnyCardRegion, x: number, y: number, except: Card): Card | undefined {
    return [...region.cards]
        .reverse()
        .find(card => card.oid != except.oid && getCardRectangle(card).contains(x, y))
}

function playedFromHand(
    projection: Projection,
    all: Named[],
    card: Card,
    params: Record<string, unknown>,
    to: AnyCardRegion,
): Named[] {
    let plays = all.filter(n => n.option.kind == 'play' && isMoved(projection, n.card, card))
    if (plays.length <= 1) {
        return plays
    }
    // Dropped onto a minion, or played with one ( SC's guess : the acting minion ) : the minion
    // playing it, else its target. Where it is dropped comes first : that is the user's intent
    const x = params.x as number | undefined
    const y = params.y as number | undefined
    const onto =
        (x !== undefined && y !== undefined ? cardAt(to, x, y, card) : undefined) ??
        (params.byMinion as Card | undefined)
    if (onto) {
        const by = plays.filter(n => is(n.actor, onto))
        const at = plays.filter(n => is(n.target, onto))
        plays =
            by.length > 0 ? by
            : at.length > 0 ? at
            : plays
    }
    // Dropped in another player's region : played on that player
    if (to.owner && plays.length > 1) {
        const at = plays.filter(n => n.targetPlayer?.oid == to.owner?.oid)
        plays = at.length > 0 ? at : plays
    }
    return plays
}

function declaredAction(all: Named[], action: MinionAction): Named[] {
    const acting = action.actingMinion
    if (
        action.type == MinionActionType.ActionCardFromHand ||
        action.type == MinionActionType.ActionInPlay
    ) {
        const byCard = all.filter(
            n => is(n.card, action.card) && (is(n.actor, acting) || is(n.minion, acting)),
        )
        const target = action.target
        if (byCard.length > 1 && target) {
            const at = byCard.filter(n =>
                target instanceof Card ? is(n.target, target) : n.targetPlayer?.oid == target.oid,
            )
            return at.length > 0 ? at : byCard
        }
        return byCard
    }
    const kinds = ACTIONS[action.type] ?? []
    const actions = all.filter(
        n =>
            n.option.kind == 'take_action' &&
            is(n.minion, acting) &&
            kinds.includes(n.option.action ?? ''),
    )
    const target = action.target
    if (actions.length > 1 && target instanceof Card) {
        const at = actions.filter(n => is(n.target, target))
        return at.length > 0 ? at : actions
    }
    return actions
}

/**
 * The options a move of the user can mean, among those offered.
 */
export function matchGesture(
    projection: Projection,
    options: EngineOption[],
    gameMutation: AnyGameMutation,
): EngineOption[] {
    const all = options.map(option => named(projection, option))
    const params = gameMutation.params as Record<string, unknown>
    const card = gameMutation.card ?? undefined
    const kind = (...kinds: string[]) => all.filter(n => kinds.includes(n.option.kind))
    const moved = (named: Named) => !!card && isMoved(projection, named.card, card)
    let found: Named[] = []

    switch (gameMutation.name) {
        // Blood moved onto, or off, an uncontrolled vampire
        case 'influence':
        case 'changeBlood': {
            const amount = params.amount as number
            if (card?.isIn.uncontrolled) {
                found = kind(amount > 0 ? 'transfer' : 'withdraw').filter(n => is(n.card, card))
                // Its "Influence" button with no transfer left to make : bring it out, if it can
                if (found.length == 0 && gameMutation.name == 'influence' && amount > 0) {
                    found = kind('influence_out').filter(n => is(n.card, card))
                }
            } else if (card) {
                found = all.filter(n => names(n, card))
                // Blood moved onto or off a vampire : the ability moving it that way, if any
                // ( a Blood Doll on it )
                const moving = found.filter(
                    n => n.option.blood !== undefined && n.option.blood * amount > 0,
                )
                found = moving.length > 0 ? moving : found
            }
            break
        }

        case 'moveCardToRegion':
        case 'playFaceDown':
        case 'discard':
        case 'moveToBottom': {
            if (!card) {
                break
            }
            const from = card.region
            const to = (params.toCardRegion as AnyCardRegion | undefined) ?? card.owner.ashHeap
            if (gameMutation.name == 'moveToBottom') {
                found = kind('bottom').filter(moved)
            } else if (from.is.uncontrolled && to.is.controlled) {
                found = kind('influence_out').filter(n => is(n.card, card))
            } else if (from.is.hand && (to.is.ashHeap || gameMutation.name == 'discard')) {
                found = kind('discard', 'burn_for_vote').filter(moved)
            } else if (from.is.hand && to.is.library) {
                found = kind('bottom').filter(moved)
            } else if (from.is.hand) {
                found = playedFromHand(projection, all, card, params, to)
            } else if (to.is.ashHeap) {
                found = kind('burn_in_play', 'yield_contest').filter(n => is(n.card, card))
            }
            // Any other move of a card : whatever is offered about it ( or a copy alike )
            if (found.length == 0) {
                found = all.filter(n => names(n, card) || moved(n))
            }
            break
        }

        case 'drawCrypt':
            found = kind('draw_crypt')
            break

        case 'drawLibrary':
            found = kind('draw_library')
            break

        // Next phase, next turn : the pass that ends the phase
        case 'goToTurnPhase':
        case 'goToTurn':
            found = kind('pass')
            break

        // Locking a minion : it acts, or blocks ; locking a card : it is used
        case 'setLock':
            if (card) {
                // A card in play locked : its ability ( a location, a master card )
                // ( not a Blood Doll's blood, moved by changing the vampire's blood )
                found = all.filter(
                    n =>
                        n.option.blood === undefined &&
                        (is(n.minion, card) || is(n.actor, card) || is(n.card, card)),
                )
                const acts = found.filter(n =>
                    ['take_action', 'declare_block'].includes(n.option.kind),
                )
                found = acts.length > 0 ? acts : found
            }
            break

        case 'ACTION_declareAction':
            found = declaredAction(all, params.minionAction as MinionAction)
            break

        case 'ACTION_declareBlock': {
            const block = params.block as Card | typeof NO_BLOCK | null
            found =
                block instanceof Card ?
                    kind('declare_block').filter(n => is(n.minion, block))
                :   kind('pass')
            break
        }

        // An action modifier or a reaction played, or none ( the pass )
        case 'ACTION_declareActionModifier':
        case 'ACTION_declareReaction': {
            const declared = params.actionModifier ?? params.reaction
            const played =
                declared instanceof Card ? declared
                : typeof declared == 'object' && declared !== null ?
                    (declared as { card: Card }).card
                :   undefined
            found =
                played ?
                    kind('play').filter(n => isMoved(projection, n.card, played))
                :   kind('pass')
            break
        }

        case 'ACTION_resolveAction':
        case 'ACTION_resolveBlock':
        case 'ACTION_endAction':
            found = kind('pass')
            break

        // The Edge burned : for a vote
        case 'changeTheEdgeControl':
            found = kind('cast_edge', 'edge_pool')
            break

        // Pool gained : the Edge's ; pool lost : a cost
        case 'changePool':
            found =
                (params.amount as number) > 0 ?
                    kind('edge_pool')
                :   kind('burn_pool', 'pay_contest', 'pay_block_toll', 'pay_to_cancel')
            break

        default:
            if (card) {
                found = all.filter(n => names(n, card))
            }
    }

    return found.map(n => n.option)
}

// The options answered by a button on the card they are about ( SC's floating actions ) : what a
// card or minion in play can be made to do ( picks glow instead : engine/interaction.ts ). The
// label is short : the button sits under the card.
const ON_CARD: Record<string, (option: EngineOption) => string> = {
    resolve_rider: () => 'Resolve',
    resolve_printed: () => 'Resolve',
    burn_blood_from: () => 'Burn 1 blood',
    burn_blood_for_intercept: () => '+1 intercept',
    unlock_for_blood: () => 'Burn blood to unlock',
    burn_corruption_to_fail: () => 'Block fails',
    burn_corruption_to_unlock: () => 'Unlock',
    draw_stored: option => option.text,
    burn_weapon_strike: () => 'Burn to strike',
    // A contest, under the card or minion contested
    pay_contest: () => 'Pay to contest',
    yield_contest: () => 'Yield',
    // A card in play burned to pay ( Spectral Servitor, a Blood Doll )
    burn_in_play: () => 'Burn',
    unlock_infernal: () => 'Unlock ( 1 pool )',
}

/**
 * The label of the button on the card an option is about, or null when the
 * option is not answered there.
 */
export function onCardLabel(option: EngineOption): string | null {
    return ON_CARD[option.kind]?.(option) ?? null
}
