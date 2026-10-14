/**
 * The table as the interface of a game with the rules engine ( GameType.Engine ).
 *
 * The engine's options are whole combinations : a card, played in a mode, by a
 * minion, on a target. The table shows what can be used : the cards that can be
 * played or used ( the ability of a card in play, the action it grants ) and
 * the minions that can act glow, and so do the cards a decision picks among. A click keeps the options about that card, then what still
 * differs among them is asked in table order : the card ( when a minion was
 * clicked : what it plays ), the minion playing it, the Disciplines and level
 * ( chips in the central box ), the target. The candidates of each step glow ;
 * a choice that is not a card of the table is a button in the central box.
 * Once a single option is left, it is taken. Escape or a right click cancels.
 *
 * A minion that can take an action opens SC's own menu of actions instead
 * ( see minionMenuOptions ), its entries narrowed to what the engine offers.
 */

import { computed } from 'vue'
import { Card } from '@/shared/model/Card.ts'
import type { ActionKind, OptionView, Target } from '@/client/engine/api.ts'
import { modeTags } from '@/client/engine/labels.ts'
import { useEngineStore } from '@/client/store/engine.ts'
import {
    chooseEngineOption,
    engineAlikeCards,
    engineCard,
    engineOptionCards,
    engineRoles,
    engineZoneRegion,
} from '@/client/engine/driver.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { Colors } from '@/client/colors.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { GameType } from '@/shared/types/state.ts'
import { onCardLabel } from '@/client/engine/gestures.ts'
import { getOverlappingCards } from '@/client/game/utils.ts'

// How a card of the table is highlighted : a card that can be played, a minion that can act
// ( or play something ), a candidate of the choice under way ( or of a pick ), the card that
// choice is about
export type Highlight = 'usable' | 'actor' | 'candidate' | 'staged'

// One way to narrow the choice under way : its options, and the card that stands for it
export type StagingChoice = { key: string; options: OptionView[]; card?: Card; label: string }

// What the choice under way asks next
export type StagingStep = {
    ask: 'card' | 'actor' | 'mode' | 'target' | 'option'
    choices: StagingChoice[]
}

// The decisions that pick a card of the table : the card glows as a candidate, a click picks it
// ( draw_stored : a card drawn from a card in play instead of the library, Shilmulo Tarot : the
// card glows, a click lists its cards )
const PICKS = [
    'choose_minion',
    'choose_card',
    'slot',
    'take_equipment',
    'round_strike',
    'draw_stored',
]

export function isPick(option: OptionView): boolean {
    return (
        (PICKS.includes(option.kind) && (option.kind != 'round_strike' || !!option.card)) ||
        // A card discarded from hand for an effect ( an exchange, a cost ) : not the discard
        // phase's, answered by the 🔥 of the card
        (option.kind == 'discard' && useEngineStore().pending?.window != 'discard_phase')
    )
}

// The cards chosen by name in a zone ( a library or ash heap search, a vampire in the ash heap,
// a card employed from hand ) : the zone glows, its cards of that name are candidates
const SEARCHES = ['find_card', 'take_from', 'ash_vampire', 'employ_from_hand']

export function searchCards(option: OptionView): Card[] {
    const id = option.card?.id
    if (!SEARCHES.includes(option.kind) || id == null) {
        return []
    }
    const region = engineZoneRegion(option.zone)
    return region ? region.cards.filter(card => card.krcgId == String(id)) : []
}

// The stacks a draw is offered from now ( the library, the crypt ) : they glow, a click draws
export const drawnRegions = computed((): AnyCardRegion[] => {
    const pending = useEngineStore().pending
    if (!pending) {
        return []
    }
    const regions: AnyCardRegion[] = []
    for (const [kind, zone] of [
        ['draw_library', 'library'],
        ['draw_crypt', 'crypt'],
    ] as const) {
        const region =
            pending.options.some(o => o.kind == kind) ?
                engineZoneRegion({ seat: pending.seat, zone })
            :   undefined
        if (region) {
            regions.push(region)
        }
    }
    return regions
})

// The regions searched now : they glow, a click on them opens them
export const searchedRegions = computed((): AnyCardRegion[] => {
    const regions: AnyCardRegion[] = []
    for (const option of useEngineStore().pending?.options ?? []) {
        const region = searchCards(option).length > 0 ? engineZoneRegion(option.zone) : undefined
        if (region && !regions.includes(region)) {
            regions.push(region)
        }
    }
    return regions
})

// An option a click on its card starts : a card played from hand, the ability of a card in play
// ( what it grants : an action to burn or steal it, an equip, a tap ). A vampire's own ability
// is the vampire's, which acts ( see minionMenuOptions )
function isUse(option: OptionView): boolean {
    return option.kind == 'play' || (option.kind == 'use_ability' && !!option.card)
}

// A vampire's own ability ( its card text ), during a combat or an action : a card of the
// central box, as a card in play's is ( Flávio Gonçalves's dodge, Abaddon's maneuver ). Out of
// them, the minion's menu holds it
function isOwnAbility(option: OptionView): boolean {
    return (
        option.kind == 'use_ability' &&
        !option.card &&
        (!!useEngineStore().pending?.combat || !!useGameStateStore().action)
    )
}

// The card of the table an option is about : the card played or used, the minion acting, the
// card picked
function cardOf(option: OptionView): Card | undefined {
    return engineOptionCards(option)[0]
}

// The minion playing a card or using an ability
function actorOf(option: OptionView): Card | undefined {
    return option.kind == 'play' || option.kind == 'use_ability' ?
            engineRoles(option).actor
        :   undefined
}

function is(a: Card | undefined, b: Card | undefined) {
    return !!a && !!b && a.oid == b.oid
}

// The copies alike to a card ( itself included ) : the engine offers one choice for the copies of
// a card in hand ( or stored on the same card ), about the first. Any of them stands for it
function alike(card: Card | undefined): Card[] {
    return card ? engineAlikeCards(card) : []
}

// The card is this one, or a copy alike
function isAlike(a: Card | undefined, b: Card | undefined) {
    return !!a && !!b && (a.oid == b.oid || alike(a).some(card => card.oid == b.oid))
}

function targetKey(target: Target | null | undefined): string {
    return target ? JSON.stringify(target) : 'none'
}

function pendingOptions(): OptionView[] {
    return useEngineStore().pending?.options ?? []
}

function stagedOptions(): OptionView[] {
    const indexes = new Set(useEngineStore().staging ?? [])
    return pendingOptions().filter(option => indexes.has(option.index))
}

function group(
    options: OptionView[],
    keyOf: (option: OptionView) => string,
    describe: (option: OptionView) => { card?: Card; label: string },
): StagingChoice[] {
    const choices = new Map<string, StagingChoice>()
    for (const option of options) {
        const key = keyOf(option)
        const choice = choices.get(key)
        if (choice) {
            choice.options.push(option)
        } else {
            choices.set(key, { key, options: [option], ...describe(option) })
        }
    }
    return [...choices.values()]
}

function modeLabel(option: OptionView): string {
    const tags = modeTags(option.mode)
    return tags.length > 0 ? tags.map(tag => `[${tag}]`).join('') : (option.text ?? '')
}

function targetLabel(option: OptionView): string {
    // The text ends with the target : "Play X with A on B"
    const text = option.text ?? ''
    const on = text.lastIndexOf(' on ')
    return option.target?.kind == 'seat' && on >= 0 ? text.slice(on + 4) : text
}

// The card of the table a target is : a minion, a card in play, a vampire in the uncontrolled
// region ( Govern the Unaligned, Enchant Kindred at superior )
function targetCard(option: OptionView): Card | undefined {
    const target = engineRoles(option).target
    return target instanceof Card ? target : undefined
}

/**
 * What the choice under way asks next : the first of its card, the minion
 * playing it, its mode, its target that differs among the options left.
 */
export function stagingStep(options: OptionView[]): StagingStep {
    const cards = group(
        options,
        option => cardOf(option)?.oid ?? 'none',
        option => {
            const card = cardOf(option)
            return { card, label: card?.name ?? option.text ?? '' }
        },
    )
    if (cards.length > 1) {
        return { ask: 'card', choices: cards }
    }
    const actors = group(
        options,
        option => String(option.actor ?? 'none'),
        option => {
            const card = engineCard(option.actor)
            return { card, label: card?.name ?? 'Your Methuselah' }
        },
    )
    if (actors.length > 1) {
        return { ask: 'actor', choices: actors }
    }
    // By printed line : a line the engine splits ( by target, by effect ) is one choice of
    // Disciplines, the target or what the mode does asked next
    const modes = group(
        options,
        option => String(option.mode?.line ?? option.mode?.index ?? 'none'),
        option => ({ label: modeLabel(option) }),
    )
    if (modes.length > 1) {
        return { ask: 'mode', choices: modes }
    }
    const targets = group(
        options,
        option => targetKey(option.target),
        option => ({ card: targetCard(option), label: targetLabel(option) }),
    )
    if (targets.length > 1) {
        return { ask: 'target', choices: targets }
    }
    // Options alike in all of this : by their text ( what sets their mode apart )
    return {
        ask: 'option',
        choices: options.map(option => ({
            key: String(option.index),
            options: [option],
            label: option.text ?? '',
        })),
    }
}

// The choice under way, if any : the card it is about ( when it is about one ) and what it
// asks next
export const staging = computed(() => {
    const options = stagedOptions()
    if (options.length == 0) {
        return null
    }
    const card = cardOf(options[0])
    const same = options.every(option => is(cardOf(option), card))
    return { card: same ? card : undefined, step: stagingStep(options) }
})

/**
 * The options SC's menu of actions offers for a minion, by entry ( see
 * FloatingActionsCloud ) : the actions it can take, the cards it can play
 * from hand, the abilities it can use. Null when it can take no action.
 */
export function minionMenuOptions(minion: Card): Record<string, OptionView[]> | null {
    const options = pendingOptions()
    // The minion taking an action : the option's actor
    const actions = options.filter(o => o.kind == 'take_action' && is(engineCard(o.actor), minion))
    if (actions.length == 0) {
        return null
    }
    const named: ActionKind[] = ['bleed', 'hunt', 'diablerie', 'rescue', 'leave_torpor']
    const by = (kind: ActionKind) => actions.filter(o => o.action == kind)
    return {
        Bleed: by('bleed'),
        Hunt: by('hunt'),
        Diablerize: by('diablerie'),
        Rescue: by('rescue'),
        'Leave Torpor': by('leave_torpor'),
        'Card In Hand': options.filter(o => o.kind == 'play' && is(actorOf(o), minion)),
        // Its own card's too ( an ally's Ⓓ action : Freakish Conglomeration )
        'Card In Play': options.filter(
            o => o.kind == 'use_ability' && (is(actorOf(o), minion) || is(cardOf(o), minion)),
        ),
        'Other Actions': actions.filter(o => !o.action || !named.includes(o.action)),
    }
}

// The highlight of each card of the table, by oid
const highlights = computed(() => {
    const map = new Map<string, Highlight>()
    const current = staging.value
    if (current) {
        for (const choice of current.step.choices) {
            for (const card of alike(choice.card)) {
                map.set(card.oid, 'candidate')
            }
        }
        for (const card of alike(current.card)) {
            map.set(card.oid, 'staged')
        }
        return map
    }
    for (const option of pendingOptions()) {
        for (const found of searchCards(option)) {
            map.set(found.oid, 'candidate')
        }
        const card = cardOf(option)
        if (!card) {
            continue
        }
        if (isUse(option) || isOwnAbility(option)) {
            for (const copy of alike(card)) {
                map.set(copy.oid, 'usable')
            }
        } else if (isPick(option)) {
            for (const copy of alike(card)) {
                map.set(copy.oid, 'candidate')
            }
        } else if (option.kind == 'take_action' && !map.has(card.oid)) {
            map.set(card.oid, 'actor')
        }
        const actor = actorOf(option)
        if (actor && !map.has(actor.oid)) {
            map.set(actor.oid, 'actor')
        }
    }
    return map
})

export function engineHighlight(card: Card): Highlight | null {
    return highlights.value.get(card.oid) ?? null
}

/**
 * The glow of a card in a game with the rules engine : its color, or null for
 * none. Undefined in any other game ( SC's own glow applies ).
 */
export function engineGlow(card: Card): number | null | undefined {
    if (useGameStateStore().gameType != GameType.Engine) {
        return undefined
    }
    const highlight = highlights.value.get(card.oid)
    return (
        highlight == 'usable' || highlight == 'actor' ? Colors.CARD_GLOW.color
        : highlight == 'candidate' ? Colors.CARD_GLOW_CANDIDATE.color
        : highlight == 'staged' ? Colors.CARD_GLOW_STAGED.color
        : null
    )
}

/**
 * A click on this card is the engine's ( engineCardClick ), not SC's selection :
 * any glowing card but a minion that can take an action ( it opens SC's menu
 * of actions, which needs it selected ) — even one whose card can be used, its
 * abilities in the menu ( an ally : Freakish Conglomeration ). A candidate or
 * the card staged is the choice under way's.
 */
export function engineClaims(card: Card): boolean {
    const highlight = engineHighlight(card)
    return (
        !!highlight &&
        (highlight == 'candidate' || highlight == 'staged' || !minionMenuOptions(card))
    )
}

// Narrow the choice under way to these options : taken when a single one is left
export function narrowStaging(options: OptionView[]) {
    const engine = useEngineStore()
    if (options.length == 1) {
        engine.staging = null
        chooseEngineOption(options[0].index)
        return
    }
    engine.staging = options.length > 1 ? options.map(option => option.index) : null
}

export function cancelStaging() {
    useEngineStore().staging = null
}

/**
 * A click on a card of the table : true when it was taken as ( part of ) a
 * choice. A candidate narrows the choice under way ; otherwise the options
 * about the card start one : the card played or picked, what a minion can
 * play or use. Anything else cancels the choice under way.
 */
export function engineCardClick(card: Card): boolean {
    if (!useEngineStore().pending) {
        return false
    }
    const current = staging.value
    if (current) {
        const choice = current.step.choices.find(c => isAlike(c.card, card))
        if (choice) {
            narrowStaging(choice.options)
            return true
        }
        if (isAlike(current.card, card)) {
            return true
        }
        // A card over a candidate took the click meant for it : ignored, the choice kept
        const candidates = current.step.choices.flatMap(c => alike(c.card))
        if (
            card.isIn.play &&
            getOverlappingCards(card).some(other => candidates.some(c => c.oid == other.oid))
        ) {
            return true
        }
        cancelStaging()
    }
    if (!engineClaims(card)) {
        return false
    }
    const options = pendingOptions()
    const about = options.filter(
        o => (isUse(o) || isPick(o) || isOwnAbility(o)) && isAlike(cardOf(o), card),
    )
    const played = options.filter(
        o => (o.kind == 'play' || o.kind == 'use_ability') && is(actorOf(o), card),
    )
    const found = options.filter(o => searchCards(o).some(c => c.oid == card.oid))
    const picked =
        found.length > 0 ? found
        : about.length > 0 ? about
        : played
    if (picked.length == 0) {
        return false
    }
    narrowStaging(picked)
    return true
}

/**
 * Dev autoplay : a card played the way the user does, by narrowing its plays
 * one step at a time at random ( see stagingStep ). Throws when a step offers
 * nothing, or doesn't narrow : the narrowing must end on a single option.
 */
export function autoplayStaging(options: OptionView[]): OptionView | null {
    const usable = options.filter(o => isUse(o) || o.kind == 'take_action' || isPick(o))
    if (usable.length == 0) {
        return null
    }
    const first = usable[Math.floor(Math.random() * usable.length)]
    const card = cardOf(first)
    // An action : the entry of the minion's menu that holds it ; else the options about its card
    const menu = first.kind == 'take_action' && card ? minionMenuOptions(card) : null
    let left =
        menu ?
            (Object.values(menu).find(entry => entry.includes(first)) ?? [first])
        :   usable.filter(o => o.kind == first.kind && is(cardOf(o), card))
    while (left.length > 1) {
        const { choices } = stagingStep(left)
        const total = choices.reduce((n, choice) => n + choice.options.length, 0)
        if (choices.length < 2 || total != left.length) {
            throw new Error(`staging ${first.text} : ${choices.length} choices for ${left.length}`)
        }
        left = choices[Math.floor(Math.random() * choices.length)].options
    }
    return left[0]
}

// The values X can take, in order, when there is a choice ( the lowest first ) : a stepper
export function xOptions(options: OptionView[]): OptionView[] {
    const values = options.filter(option => option.kind == 'set_x')
    return values.length > 1 ? values.sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0)) : []
}

// The steps of a combat ( and what follows a block ) : buttons, together under the combat
const COMBAT = [
    'hand_strike',
    'strike_combat_ends',
    'committed_strike',
    'use_maneuver',
    'use_press',
    'use_prevent',
    'take_damage_after_resolution',
    'gain_strength',
    'burn_blood_to_avoid',
    'continue_action',
    'diablerise',
]

export function isCombatOption(option: OptionView): boolean {
    return COMBAT.includes(option.kind) || (option.kind == 'round_strike' && !option.card)
}

export function combatOptions(options: OptionView[]): OptionView[] {
    return options.filter(isCombatOption)
}

/**
 * The cards that can be played or used now, during a combat or an action, one
 * entry per card for the central box : a strike from a weapon in play, a card
 * from hand ( a strike, a maneuver, a prevention, a modifier, a reaction ). An
 * entry starts the choice about its card, as a click on it does ( its
 * Disciplines, its target… ) : the card keeps glowing on the table too.
 */
export function cardChoices(options: OptionView[]): StagingChoice[] {
    const engine = useEngineStore()
    if (!engine.pending?.combat && !useGameStateStore().action) {
        return []
    }
    const about = options.filter(
        option =>
            isUse(option) ||
            isOwnAbility(option) ||
            (option.kind == 'round_strike' && !!option.card),
    )
    return group(
        about,
        option => cardOf(option)?.oid ?? `option:${option.index}`,
        option => {
            const card = cardOf(option)
            return { card, label: card?.name ?? option.text ?? '' }
        },
    ).map(choice => ({
        ...choice,
        label:
            choice.options.length == 1 ? (choice.options[0].text ?? '')
            : choice.options[0].kind == 'play' ? `Play ${choice.label}`
            : `Use ${choice.label}`,
    }))
}

/**
 * The option has a place on the table or in the central box : a glowing card
 * ( a play, a pick, an ability ), a minion's menu, a button on a card, a vote
 * box, the action's or the referendum's pass, the central box's menus. The
 * console lists the others, and every option on demand ( 2.17 ).
 */
export function answeredOnTable(option: OptionView): boolean {
    const pending = useEngineStore().pending
    const gameState = useGameStateStore()
    const options = pending?.options ?? []
    switch (option.kind) {
        case 'take_action':
            return !!engineCard(option.actor)
        case 'cast_votes':
        case 'declare_block':
            return !!engineCard(option.minion)
        case 'pass':
            return !!gameState.action || !!gameState.referendum
        case 'allocate_to':
        case 'allocate_to_card':
            return !!pending?.allocation
        case 'set_x':
            return xOptions(options).length > 0
        // The Edge glows : a click gains its pool or casts its vote ( see edgeOptions ) ; the votes
        // panel holds the Edge's and the political action card's vote too
        case 'edge_pool':
        case 'cast_edge':
        case 'cast_card_vote':
            return true
        // The hand card's own button glows ( 🔥, To Bottom : see CardInHandGO )
        case 'burn_for_vote':
        case 'bottom':
            return !!cardOf(option)
        case 'draw_crypt':
        case 'pay_block_toll':
            return actionButtons.value.includes(option)
    }
    if (isUse(option) || isPick(option) || isOwnAbility(option)) {
        return !!cardOf(option)
    }
    // A search : in its zone ( it glows ), else a button of the central box
    if (SEARCHES.includes(option.kind)) {
        return searchCards(option).length > 0
    }
    // A vampire's own ability : in its menu, when it can act
    if (option.kind == 'use_ability') {
        const actor = actorOf(option)
        return !!actor && minionMenuOptions(actor) !== null
    }
    if (onCardLabel(option) !== null) {
        return !!cardOf(option) || !!engineCard(option.minion)
    }
    return isCombatOption(option)
}

// The options answered by a button beside the pass in the action's panel ( see actionButtons )
const ACTION_BUTTONS = ['draw_crypt', 'pay_block_toll']

/**
 * During an action, the options answered beside the pass in the action's panel : the acting
 * player's crypt draw for blood ( Enthrall [OBF]/[PRE] : "this vampire can burn 1 blood to draw 1
 * card from your crypt", after a successful bleed ), a block attempt's toll ( Where the Veil Thins
 * [OBL] : pay it, or resign the attempt with the pass )
 */
export const actionButtons = computed((): OptionView[] => {
    const pending = useEngineStore().pending
    if (!pending || !useGameStateStore().action) {
        return []
    }
    return pending.options.filter(o => ACTION_BUTTONS.includes(o.kind))
})

// The Edge, usable now : its pool in the unlock phase, its vote in a polling — it glows, a click
// on it takes the option ( see gestures.ts changeTheEdgeControl )
export const edgeOptions = computed((): OptionView[] =>
    (useEngineStore().pending?.options ?? []).filter(
        option => option.kind == 'edge_pool' || option.kind == 'cast_edge',
    ),
)

// The votes of a polling that are no vampire's : the Edge's, the political action card's ( buttons
// beside "All my votes" )
export const methuselahVoteOptions = computed((): OptionView[] =>
    (useEngineStore().pending?.options ?? []).filter(
        option => option.kind == 'cast_edge' || option.kind == 'cast_card_vote',
    ),
)

// The influence phase's transfers : SC's own moves on the table ( dragging blood )
const TABLE_MOVES = ['transfer', 'withdraw', 'influence_out']

/**
 * The options nothing else answers ( see answeredOnTable ), for the central box with the
 * decision's prompt : a library search, an exchange, a cost, a draw alternative ( Shilmulo Tarot ),
 * the political action card's vote, the Edge's pool, a contest… The influence and discard
 * phases' own moves stay on the table, a phase's end on the turn controls.
 */
export const leftoverOptions = computed((): OptionView[] => {
    const pending = useEngineStore().pending
    if (!pending) {
        return []
    }
    // A pass that does something is one answer of a yes / no : the other ( a card's button,
    // Priority Contract's "Burn: gain 3 pool" on a minion across the table ) beside it
    const effectPass = pending.options.some(isEffectPass)
    // The terms of a card played are its question : beside its prompt, even those a button on a
    // card answers ( Vessel's "burn a Blood Doll", on a vampire across the table )
    const terms = pending.window == 'play_terms'
    return pending.options.filter(option =>
        option.kind == 'pass' ?
            isEffectPass(option)
        :   !TABLE_MOVES.includes(option.kind) &&
            !(option.kind == 'discard' && pending.window == 'discard_phase') &&
            !(option.kind == 'draw_crypt' && pending.window == 'influence_transfers') &&
            (!answeredOnTable(option) || ((effectPass || terms) && onCardLabel(option) !== null)),
    )
})

/**
 * A pass that does something ( Anarch Convert's "Gain 1 pool", "Keep him in play", "Stop
 * searching" ) : a choice like the others, in the central box beside them — the fixed Pass says
 * only "Pass". A plain pass ( "Pass (no block)", "End the minion phase" ) stays there alone.
 */
export function isEffectPass(option: OptionView): boolean {
    return option.kind == 'pass' && !/^(Pass\b|End the )/.test(option.text ?? '')
}
