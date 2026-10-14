/**
 * Names for the server's ids where the table shows them : windows, actions.
 */

import type { ActionKind, Mode, Window } from '@/client/engine/api.ts'

// A window's name
const WINDOWS: Partial<Record<Window, string>> = {
    unlock_abilities: 'Unlock phase',
    master_phase: 'Master phase',
    play_terms: 'Terms of the play',
    rider_terms: 'Paying an effect',
    phase_impulse: 'End of phase',
    card_as_played: 'As the card is played',
    minion_phase: 'Minion phase',
    action_as_announced: 'As the action is announced',
    action_block: 'Block attempts',
    action_after_resolution: 'After resolution',
    action_would_be_successful: 'Action would be successful',
    action_blocks_declined: 'Blocks declined',
    action_blocked: 'Action blocked',
    action_after_combat: 'After combat',
    torpor_block: 'Blocked leave torpor',
    rescue_cost: 'Rescue cost',
    entry_effect: 'Entering play',
    resolution_choice: 'Resolving an effect',
    block_toll: 'Block toll',
    distribution: 'Distributing blood',
    blood_hunt_polling: 'Blood hunt',
    referendum_terms: 'Referendum terms',
    referendum_polling: 'Referendum',
    discard_down: 'Discard down to hand size',
    action_terms: 'Terms of the action',
    library_search: 'Library search',
    action_exchange: 'Exchange',
    draw: 'Draw',
    bottom_cards: "Cards to the library's bottom",
    influence_transfers: 'Influence phase',
    discard_phase: 'Discard phase',
    combat_before_range: 'Combat: before range',
    combat_determine_range: 'Combat: range',
    combat_before_strikes: 'Combat: before strikes',
    combat_strike: 'Combat: strike',
    combat_before_resolution: 'Combat: before resolution',
    combat_prevention: 'Combat: damage prevention',
    combat_prevention_allocation: 'Combat: aggravated damage prevented',
    combat_additional_strikes: 'Combat: additional strikes',
    combat_press: 'Combat: press',
    combat_end_of_round: 'Combat: end of round',
}

// An action's name
const ACTIONS: Partial<Record<ActionKind, string>> = {
    bleed: 'bleed',
    hunt: 'hunt',
    leave_torpor: 'leave torpor',
    rescue: 'rescue',
    diablerie: 'diablerie',
    employ: 'employ',
    recruit: 'recruit',
    political: 'political action',
    card: 'action',
    burn_card: 'burn card',
    steal_card: 'steal card',
    equip: 'equip',
    equip_from: 'equip from a minion',
    equip_found: 'equip from the library',
    ability: 'action',
    become_anarch: 'become Anarch',
    red_list_hunt: 'enter combat with a Red List minion',
}

export const windowName = (w: Window) => WINDOWS[w] ?? w.replace(/_/g, ' ')
export const actionName = (a: ActionKind) => ACTIONS[a] ?? a.replace(/_/g, ' ')

// A mode's printed tags : its Disciplines ( 'dom' basic, 'DOM' superior ), its card type ( 'COMBAT' )
export function modeTags(mode: Mode | null | undefined): string[] {
    const tags = (mode?.disciplines ?? []).map(d =>
        d.superior ? d.discipline.toUpperCase() : d.discipline,
    )
    if (mode?.card_type) {
        tags.push(mode.card_type.replace(/_/g, '').toUpperCase())
    }
    return tags
}
