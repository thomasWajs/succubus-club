/**
 * The log of a game with the rules engine, composed from the events' data ( not their English
 * text ) : short names, grouped lines. Seats are "P1", "P2"… ; a vampire is the first word of its
 * name when no other name seen starts with it. Draws, passes and failures are left out ; a seat's
 * influence phase is one line ; an action is one line ( what it is, then how it ended ) folding the
 * plays, blocks and votes during it ; a combat in it folds its strike rounds, one line each. Pool
 * and blood moved are told on the line of the move that moved them.
 */

import type {
    ActionKind,
    Card,
    Effect,
    Event,
    OptionView,
    StruckSide,
    TableView,
    Window,
} from '@/client/engine/api.ts'
import { actionName, strikeName } from '@/client/engine/labels.ts'
import type { TextSegment } from '@/client/engine/cardNames.ts'
import { isCryptId } from '@/shared/model/Card.ts'

// A piece of a log line : text, a card's name, or a seat ( "P2", in its color )
export type LogSegment = TextSegment & { seat?: number }

export type EngineLogEntry = {
    id: number
    // Its author's seat ; null for the table ( a turn, a combat )
    seat: number | null
    segments: LogSegment[]
    // The lines it folds : an action's plays, blocks, votes and combat ; a combat's rounds
    children: EngineLogEntry[]
    // An action or a combat under way
    live: boolean
    // The same line in a log rebuilt after an undo : the user's folding kept by it
    key: string
    time: Date
}

// The windows choosing a card's or an action's terms
const TERMS: Window[] = [
    'play_terms',
    'rider_terms',
    'action_terms',
    'referendum_terms',
    'resolution_choice',
    'entry_effect',
]

// A copy the viewer does not know ( an uncontrolled vampire of another seat ) : not in the protocol,
// as the server sends it
const UNKNOWN_COPY = 4294967295

// How an action reads after its minion : "Theo bleeds P3", "Anson calls Kine Resources Contested"
const VERBS: Partial<Record<ActionKind, string>> = {
    bleed: 'bleeds',
    hunt: 'hunts',
    leave_torpor: 'leaves torpor',
    rescue: 'rescues',
    diablerie: 'diablerizes',
    employ: 'employs',
    recruit: 'recruits',
    political: 'calls',
    card: 'plays',
    burn_card: 'burns',
    steal_card: 'steals',
    equip: 'equips',
    equip_from: 'equips from',
    equip_found: 'equips',
    ability: 'acts',
    become_anarch: 'becomes Anarch',
    red_list_hunt: 'hunts',
}

const OUTCOMES: Record<string, string> = {
    succeeds: 'succeeds',
    blocked: 'blocked',
    fails: 'fails',
    fizzles: 'fizzles',
    ousted: 'ends, its target ousted',
    ends: 'ends',
}

// The effects told by their amount ( "+1 stealth", "−1 blood" )
const COUNTED = new Set([
    'stealth',
    'intercept',
    'bleed',
    'strength',
    'votes',
    'pool',
    'blood',
    'life',
    'damage',
    'prevent',
    'press',
    'maneuver',
    'draw',
    'discard',
    'transfers',
    'counters',
    'hand_size',
    'corruption',
])
// Effects the line says otherwise, or that say nothing more ( an action declared, a card kept )
const UNTOLD = new Set(['action', 'referendum', 'keep', 'role', 'cost'])

function signed(n: number) {
    return n > 0 ? `+${n}` : `−${-n}`
}

function effectsText(effects: Effect[] | null | undefined): string {
    return (effects ?? [])
        .filter(effect => !effect.cost && !UNTOLD.has(effect.kind))
        .map(effect => {
            const name = effect.kind.replace(/_/g, ' ')
            if (effect.kind == 'end_combat') {
                return 'ends combat'
            }
            if (COUNTED.has(effect.kind) && effect.n != null) {
                return `${effect.x ? `${signed(effect.n)}X` : signed(effect.n)} ${name}`
            }
            if (effect.kind == 'strike' && effect.strike) {
                return strikeName(effect.strike)
            }
            return name
        })
        .join(', ')
}

// The words a name's short form skips : articles and titles ( "Doctor Morocco" is Morocco )
const TITLES =
    /^(the|la|le|el|doctor|dr\.?|sir|lady|lord|dame|madame|mister|mr\.?|mrs\.?|miss|father|mother|sister|brother|saint|st\.?|prince|princess|king|queen|baron|baroness|count|countess|duke|duchess|captain|general|professor|bishop|archbishop|cardinal|abbot|uncle|aunt)$/i

// A name's first word that is not an article or a title ( the last one, if all are ) ; quotes and
// commas left out
function firstWord(name: string): string {
    const words = name.replace(/[",]/g, '').split(/\s+/)
    return words.find(word => !TITLES.test(word)) ?? words[words.length - 1]
}

type Known = { id: number; numbered?: number | null }
type Influence = {
    entry: EngineLogEntry
    seat: number
    // Pool transferred, by the vampire's copy ( UNKNOWN_COPY : another seat's, unseen )
    pool: Map<number, number>
    // Blood moved back to the pool, by the vampire's copy
    back: Map<number, number>
    // Influenced out ( its card, told as it enters play ) ; crypt cards drawn
    out: Card[]
    crypt: number
}
type Action = {
    entry: EngineLogEntry
    acting: number
    referendum: boolean
    card?: number
    // The Methuselah bled
    bled?: number
}

// What the log was told, in order : replayed after an undo
type Told =
    | { event: Event; at: Date }
    | { say: { seat: number; text: string }; at: Date }
    | { preys: number[] }

export class EngineLogBuilder {
    private nextId = 1
    private told: Told[] = []
    // When what is told now was told : a line keeps its time through a rebuild
    private at = new Date()
    // The lines told at the decision under way : a line's key
    private lines = 0
    // The minions and cards met, by copy
    private copies = new Map<number, Known>()
    // The crypt cards' names met : a short name is the first word only when no other starts with it
    private cryptNames = new Set<string>()
    private seatNames: string[] = []
    // Each seat's prey, as the view tells it and ousts change it : whom a bleed targets by default
    private preys: number[] = []
    private matcher: RegExp | null = null
    private matched = new Map<string, LogSegment>()
    // The decision of the last view learned : a view told again ( several steps share it ) does
    // not undo what the events told since
    private viewed = -1
    private decision = 0
    private influence: Influence | null = null
    private action: Action | null = null
    private combat: EngineLogEntry | null = null
    // The last round's strikes end the combat
    private endingStrike = false
    // The line the next pool, blood and card movements are told on ; and the card it plays
    private current: EngineLogEntry | null = null
    private currentCard: number | null = null
    // Block attempts under way, by the blocking minion : a failed one with no card played since is
    // taken out of the log
    private blocks = new Map<number, { entry: EngineLogEntry; parent: EngineLogEntry[] }>()
    // Cards played, by id, until they resolve : what they do told on their line
    private plays = new Map<number, EngineLogEntry>()
    // A successful bleed's outcome on its line : the pool bled told in its place
    private bleeding: { entry: EngineLogEntry; index: number; seat: number } | null = null

    constructor(
        // The log's lines : a reactive array, its entries changed through it
        private root: EngineLogEntry[],
        private cardName: (id: number) => string | undefined,
        // Told of every line added or grown
        private changed: () => void = () => {},
    ) {}

    // The table as it stands : the minions and cards it shows, by copy
    learn(view: TableView) {
        this.seatNames = view.seats.map(seat => seat.name)
        if (view.decision > this.viewed) {
            this.viewed = view.decision
            this.preys = view.seats.map(seat => seat.prey)
            this.told.push({ preys: this.preys })
        }
        for (const seat of view.seats) {
            for (const minion of [...seat.ready, ...seat.torpor]) {
                this.know(minion.card)
                for (const card of minion.cards) {
                    this.know(card.card)
                }
            }
            for (const slot of seat.uncontrolled) {
                this.know(slot.card)
            }
            for (const card of [...seat.ash_heap, ...seat.in_play.map(c => c.card)]) {
                this.know(card)
            }
        }
    }

    private know(card: Card | null | undefined) {
        if (!card || card.id == null) {
            return
        }
        const crypt = isCryptId(card.id)
        if (card.copy != null && card.copy != UNKNOWN_COPY) {
            const known = this.copies.get(card.copy)
            this.copies.set(card.copy, { id: card.id, numbered: card.numbered ?? known?.numbered })
        }
        const name = this.cardName(card.id)
        if (name && !this.matched.has(name)) {
            if (crypt) {
                this.cryptNames.add(name)
            }
            this.matched.set(name, { text: name, krcgId: String(card.id), isCrypt: crypt })
            this.matcher = null
        }
    }

    // A vampire's short name : its first word, unless another vampire met starts with it
    shortName(name: string): string {
        const first = firstWord(name)
        for (const other of this.cryptNames) {
            if (other != name && firstWord(other) == first) {
                return name
            }
        }
        return first
    }

    private cardSegment(id: number | null | undefined, numbered?: number | null): LogSegment {
        const name = id != null ? this.cardName(id) : undefined
        if (id == null || !name) {
            return { text: 'a card' }
        }
        const crypt = isCryptId(id)
        const shown = crypt ? this.shortName(name) : name
        return {
            text: numbered ? `${shown} (${numbered})` : shown,
            krcgId: String(id),
            isCrypt: crypt,
        }
    }

    // A minion or card in play, by copy
    private copySegment(copy: number | null | undefined): LogSegment {
        const known = copy != null ? this.copies.get(copy) : undefined
        if (!known) {
            return { text: copy == UNKNOWN_COPY ? 'an uncontrolled vampire' : 'a minion' }
        }
        return this.cardSegment(known.id, known.numbered)
    }

    private seatSegment(seat: number): LogSegment {
        return { text: `P${seat + 1}`, seat }
    }

    // An English line of the engine, its names shortened : what the data does not say better
    private fromText(text: string): LogSegment[] {
        if (!this.matcher) {
            const names = [...this.matched.keys(), ...this.seatNames]
                .sort((a, b) => b.length - a.length)
                .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            this.matcher =
                names.length ? new RegExp(`(?<!\\w)(?:${names.join('|')})(?!\\w)`, 'g') : null
        }
        if (!this.matcher) {
            return [{ text }]
        }
        const segments: LogSegment[] = []
        let last = 0
        for (const match of text.matchAll(this.matcher)) {
            if (match.index === undefined) {
                continue
            }
            const seat = this.seatNames.indexOf(match[0])
            const card = this.matched.get(match[0])
            const segment =
                seat >= 0 ? this.seatSegment(seat)
                : card ? { ...card, text: card.isCrypt ? this.shortName(card.text) : card.text }
                : undefined
            if (!segment) {
                continue
            }
            if (match.index > last) {
                segments.push({ text: text.slice(last, match.index) })
            }
            segments.push(segment)
            last = match.index + match[0].length
        }
        if (last < text.length) {
            segments.push({ text: text.slice(last) })
        }
        return segments
    }

    private line(
        seat: number | null,
        segments: LogSegment[],
        parent: EngineLogEntry[] = this.container(),
    ): EngineLogEntry {
        parent.push({
            id: this.nextId++,
            seat,
            segments,
            children: [],
            live: false,
            key: `${this.decision}.${this.lines++}`,
            time: this.at,
        })
        this.changed()
        // The reactive entry, to change it later
        return parent[parent.length - 1]
    }

    // Where a line goes : in the combat under way, else in the action, else the log
    private container(): EngineLogEntry[] {
        return this.combat?.children ?? this.action?.entry.children ?? this.root
    }

    // Told after a line : "…, P3 −2 pool"
    private append(entry: EngineLogEntry, segments: LogSegment[], separator = ', ') {
        if (segments.length == 0) {
            return
        }
        entry.segments.push({ text: separator }, ...segments)
        this.changed()
    }

    // What happened, told on the current line, else a table line
    private tell(segments: LogSegment[]) {
        if (this.current) {
            this.append(this.current, segments)
        } else {
            this.current = this.line(null, segments)
        }
    }

    // A line of the driver's own ( an undo )
    say(seat: number, text: string) {
        this.at = new Date()
        this.told.push({ say: { seat, text }, at: this.at })
        this.said(seat, text)
    }

    private said(seat: number, text: string) {
        this.closeInfluence()
        this.current = this.line(seat, this.fromText(text))
    }

    event(e: Event) {
        if (e.kind == 'undone') {
            this.undo(e.to)
            return
        }
        this.at = new Date()
        this.told.push({ event: e, at: this.at })
        this.apply(e)
    }

    private apply(e: Event) {
        if (e.kind == 'decided' || e.kind == 'auto_passed') {
            if (e.decision != this.decision) {
                this.decision = e.decision
                this.lines = 0
            }
            // The pool a bleed takes is told right after its end
            this.bleeding = null
        }
        switch (e.kind) {
            case 'decided':
                this.decided(e.seat, e.window, e.choice, e.text)
                return
            case 'auto_passed':
            case 'draw':
            case 'strike_declared':
                return
            case 'turn':
                this.closeInfluence()
                this.endAction()
                this.current = null
                this.bleeding = null
                return
            // Costs and consequences are left out : only the pool a bleed takes is told
            case 'pool': {
                const bleeding = this.bleeding
                if (bleeding && bleeding.seat == e.seat && e.delta < 0) {
                    bleeding.entry.segments.splice(bleeding.index, 1, {
                        text: `${-e.delta} pool`,
                    })
                    this.bleeding = null
                }
                return
            }
            case 'blood':
            case 'edge':
                return
            case 'enters_play':
                this.know(e.card)
                if (this.influence && e.minion) {
                    this.influence.out.push(e.card)
                    this.updateInfluence()
                    return
                }
                // The card the line plays : that it is in play goes without saying
                if (e.card.id == this.currentCard) {
                    return
                }
                this.tell(
                    e.on != null ?
                        [this.cardSegment(e.card.id), { text: ' on ' }, this.copySegment(e.on)]
                    :   [this.cardSegment(e.card.id, e.card.numbered), { text: ' in play' }],
                )
                return
            case 'leaves_play':
                this.know(e.card)
                if (e.card.id == this.currentCard) {
                    return
                }
                this.tell([
                    this.cardSegment(e.card.id, e.card.numbered),
                    {
                        text:
                            e.to == 'ash_heap' || !e.to ?
                                ' burned'
                            :   ` to ${e.to.replace(/_/g, ' ')}`,
                    },
                ])
                return
            case 'resolved': {
                this.know(e.card)
                const effects = effectsText(e.effects)
                const played = this.played(e.card)
                if (played) {
                    if (effects) {
                        this.append(played, [{ text: effects }], ': ')
                    }
                    return
                }
                this.tell([
                    this.cardSegment(e.card.id),
                    ...(effects ? [{ text: `: ${effects}` }] : []),
                ])
                return
            }
            case 'canceled': {
                this.know(e.card)
                const played = this.played(e.card)
                if (played) {
                    this.append(played, [{ text: 'canceled' }], ': ')
                    return
                }
                this.tell([this.cardSegment(e.card.id), { text: ' canceled' }])
                return
            }
            case 'block_fails': {
                const block = this.blocks.get(e.minion)
                this.blocks.delete(e.minion)
                if (!block) {
                    return
                }
                // No card played in the attempt : it goes without saying
                if (block.parent[block.parent.length - 1] === block.entry) {
                    block.parent.pop()
                    if (this.current === block.entry) {
                        this.current = null
                    }
                    return
                }
                this.append(block.entry, [{ text: 'fails' }])
                return
            }
            case 'ousted':
                this.preys = this.preys.map(prey => (prey == e.seat ? this.preys[e.seat] : prey))
                this.line(e.seat, [{ text: 'ousted' }], this.root)
                return
            case 'action_ends': {
                const action = this.action
                if (!action) {
                    return
                }
                const outcome = OUTCOMES[e.outcome] ?? e.outcome
                // A political action's referendum tells how it went
                if (action.bled != null && e.outcome == 'succeeds') {
                    this.append(action.entry, [{ text: outcome }], ': ')
                    this.bleeding = {
                        entry: action.entry,
                        index: action.entry.segments.length - 1,
                        seat: action.bled,
                    }
                } else if (!(action.referendum && e.outcome == 'succeeds')) {
                    this.append(
                        action.entry,
                        e.outcome == 'blocked' && e.blocker != null ?
                            [{ text: 'blocked by ' }, this.copySegment(e.blocker)]
                        :   [{ text: outcome }],
                        ': ',
                    )
                }
                this.endAction()
                // What follows its end ( the pool bled, the Edge ) : on its line
                this.current = action.entry
                this.currentCard = action.card ?? null
                return
            }
            case 'referendum_ends': {
                const outcome =
                    e.outcome == 'canceled' ?
                        'canceled'
                    :   `${e.outcome} ${e.votes_for}–${e.votes_against}`
                if (this.action) {
                    this.action.referendum = true
                    this.append(this.action.entry, [{ text: outcome }], ': ')
                    this.current = this.action.entry
                } else {
                    this.current = this.line(null, [{ text: `The referendum ${outcome}` }])
                }
                return
            }
            case 'combat_begins': {
                const [acting, opposing] = e.minions
                this.combat = this.line(null, [
                    { text: 'Combat: ' },
                    this.copySegment(acting),
                    { text: ' vs ' },
                    this.copySegment(opposing),
                ])
                this.combat.live = true
                this.current = this.combat
                return
            }
            case 'strikes': {
                const side = (i: number): LogSegment[] => {
                    const struck = e.sides[i]
                    return struck ?
                            [this.copySegment(struck.minion), { text: ` ${roundStrike(struck)}` }]
                        :   []
                }
                const range = e.range == 'long' ? ' long' : ''
                this.endingStrike = e.sides.some(side => side.strike?.kind == 'combat_ends')
                this.current = this.line(null, [
                    { text: e.pair > 0 ? `R${e.round}+${range}: ` : `R${e.round}${range}: ` },
                    ...side(0),
                    { text: ' — ' },
                    ...side(1),
                ])
                return
            }
            case 'combat_ends': {
                const combat = this.combat
                if (!combat) {
                    return
                }
                // A strike ending it says so already
                if (!this.endingStrike) {
                    this.append(this.current ?? combat, [{ text: 'combat ends' }])
                }
                this.endingStrike = false
                combat.live = false
                this.combat = null
                this.current = combat
                return
            }
            default:
                // A card moved, torpor, a card revealed… : as the engine tells it
                if (e.text) {
                    this.tell(this.fromText(e.text))
                }
        }
    }

    // The card played's line, once it resolves or is canceled : what follows is told on it
    private played(card: Card): EngineLogEntry | undefined {
        const played = card.id != null ? this.plays.get(card.id) : undefined
        if (played && card.id != null) {
            this.plays.delete(card.id)
            this.current = played
            this.currentCard = card.id
        }
        return played
    }

    private decided(seat: number, window: Window, choice: OptionView, text?: string | null) {
        const influences = ['transfer', 'withdraw', 'influence_out', 'draw_crypt']
        if (window == 'influence_transfers' && influences.includes(choice.kind)) {
            this.influenced(seat, choice)
            return
        }
        this.closeInfluence()
        if (choice.kind == 'pass') {
            return
        }
        // A strike chosen : its round's line tells it ; a card discarded in the discard phase
        if (window == 'combat_strike' && choice.kind != 'play') {
            return
        }
        if (window == 'discard_phase' && choice.kind == 'discard') {
            return
        }
        // Nothing allocated : nothing done
        if (choice.kind == 'allocate_to' && !choice.amount) {
            return
        }
        const told = text ?? choice.text
        // A choice of the terms of the card played or the action : on its line
        if (TERMS.includes(window) && this.current && told) {
            this.append(this.current, this.fromText(told[0].toLowerCase() + told.slice(1)))
            return
        }
        const declared = choice.effects?.find(effect => effect.kind == 'action' && !!effect.action)
        const kind = choice.kind == 'take_action' ? choice.action : declared?.action
        if (kind) {
            this.declare(seat, kind, choice)
            return
        }
        if (!TERMS.includes(window)) {
            this.currentCard = null
        }
        switch (choice.kind) {
            case 'play':
                this.current = this.line(seat, this.playSegments(choice))
                this.currentCard = choice.card?.id ?? null
                if (this.currentCard != null) {
                    this.plays.set(this.currentCard, this.current)
                }
                return
            case 'edge_pool':
                this.current = this.line(seat, [{ text: '+1 pool from the Edge' }])
                return
            case 'declare_block': {
                const blocker = choice.minion ?? choice.actor
                const parent = this.container()
                this.current = this.line(
                    seat,
                    [this.copySegment(blocker), { text: ' blocks' }],
                    parent,
                )
                if (blocker != null) {
                    this.blocks.set(blocker, { entry: this.current, parent })
                }
                return
            }
            case 'cast_votes':
                this.current = this.line(seat, [
                    this.copySegment(choice.minion),
                    { text: ` ${votesText(choice)}` },
                ])
                return
            case 'cast_card_vote':
                this.current = this.line(seat, [{ text: `the card's vote: ${votesText(choice)}` }])
                return
            case 'burn_for_vote':
                this.current = this.line(seat, [
                    { text: 'burns ' },
                    this.cardSegment(choice.card?.id),
                    { text: `: 1 ${choice.favor ? 'for' : 'against'}` },
                ])
                return
            case 'cast_edge':
                this.current = this.line(seat, [
                    { text: `burns the Edge: 1 ${choice.favor ? 'for' : 'against'}` },
                ])
                return
            case 'use_ability': {
                const effects = effectsText(choice.effects)
                // A vampire's own ability : the vampire
                const user = choice.user?.kind == 'minion' ? choice.user.copy : undefined
                this.current = this.line(seat, [
                    ...(choice.card ?
                        this.playSegments(choice)
                    :   [this.copySegment(choice.minion ?? user), ...this.targetSegments(choice)]),
                    ...(effects ? [{ text: `: ${effects}` }] : []),
                ])
                return
            }
        }
        if (told) {
            this.current = this.line(seat, this.fromText(told))
        }
    }

    // A card played : "Form of the Cobra [PRO] by Doctor on P3" ( its player told when it is not
    // the action's acting minion )
    private playSegments(choice: OptionView): LogSegment[] {
        const segments = [this.cardSegment(choice.card?.id)]
        const disciplines = (choice.mode?.disciplines ?? [])
            .filter(d => d.discipline != 'action modifier')
            .map(d => (d.superior ? d.discipline.toUpperCase() : d.discipline))
        if (disciplines.length > 0) {
            segments.push({ text: ` [${disciplines.join(' ')}]` })
        }
        if (choice.actor != null && choice.actor != this.action?.acting) {
            segments.push({ text: ' by ' }, this.copySegment(choice.actor))
        }
        segments.push(...this.targetSegments(choice))
        return segments
    }

    private targetSegments(choice: OptionView): LogSegment[] {
        const target = choice.target
        if (!target) {
            return []
        }
        return target.kind == 'seat' ?
                [{ text: ' on ' }, this.seatSegment(target.seat)]
            :   [{ text: ' on ' }, this.copySegment(target.copy)]
    }

    // An action declared : its line, folding what happens until it ends
    private declare(seat: number, kind: ActionKind, choice: OptionView) {
        this.endAction()
        const acting = choice.actor ?? (choice.user?.kind == 'minion' ? choice.user.copy : null)
        const segments: LogSegment[] = [
            this.copySegment(acting),
            { text: ` ${VERBS[kind] ?? actionName(kind)}` },
        ]
        const card = choice.card?.id ?? undefined
        const bleedTarget =
            kind == 'bleed' ?
                choice.target?.kind == 'seat' ?
                    choice.target.seat
                :   this.preys[seat]
            :   undefined
        if (bleedTarget != null) {
            segments.push({ text: ' ' }, this.seatSegment(bleedTarget))
        }
        if (card != null) {
            const named = ['political', 'employ', 'recruit', 'equip', 'equip_found', 'card']
            segments.push({ text: named.includes(kind) ? ' ' : ' with ' }, this.cardSegment(card))
        }
        if (bleedTarget == null) {
            segments.push(...this.targetSegments(choice))
        }
        const entry = this.line(seat, segments, this.root)
        entry.live = true
        this.action = {
            entry,
            acting: acting ?? -1,
            referendum: false,
            card,
            bled: bleedTarget ?? undefined,
        }
        this.bleeding = null
        this.current = entry
        this.currentCard = card ?? null
    }

    private endAction() {
        if (this.action) {
            this.action.entry.live = false
        }
        if (this.combat) {
            this.combat.live = false
        }
        this.action = null
        this.combat = null
        this.blocks.clear()
        this.plays.clear()
        this.current = null
        this.currentCard = null
    }

    // A transfer, a blood moved back, a vampire influenced out, a crypt card drawn : on the seat's
    // influence line
    private influenced(seat: number, choice: OptionView) {
        if (this.influence?.seat != seat) {
            this.closeInfluence()
            this.influence = {
                entry: this.line(seat, [], this.root),
                seat,
                pool: new Map(),
                back: new Map(),
                out: [],
                crypt: 0,
            }
        }
        const influence = this.influence
        const copy = choice.target?.kind == 'card' ? choice.target.copy : UNKNOWN_COPY
        if (choice.kind == 'transfer') {
            influence.pool.set(copy, (influence.pool.get(copy) ?? 0) + 1)
        } else if (choice.kind == 'withdraw') {
            influence.back.set(copy, (influence.back.get(copy) ?? 0) + 1)
        } else if (choice.kind == 'draw_crypt') {
            influence.crypt++
        }
        this.current = null
        this.updateInfluence()
    }

    private updateInfluence() {
        const influence = this.influence
        if (!influence) {
            return
        }
        const parts: LogSegment[][] = []
        let first = true
        for (const [copy, n] of influence.pool) {
            const to = copy == UNKNOWN_COPY ? { text: 'uncontrolled' } : this.copySegment(copy)
            parts.push([{ text: first ? `${n} pool to ` : `${n} to ` }, to])
            first = false
        }
        for (const [copy, n] of influence.back) {
            parts.push([this.copySegment(copy), { text: ` ${n} blood back to pool` }])
        }
        for (const card of influence.out) {
            parts.push([{ text: 'influences out ' }, this.cardSegment(card.id, card.numbered)])
        }
        if (influence.crypt > 0) {
            parts.push([{ text: `${influence.crypt} crypt card${influence.crypt > 1 ? 's' : ''}` }])
        }
        influence.entry.segments = parts.flatMap((part, i) =>
            i == 0 ? part : [{ text: ', ' }, ...part],
        )
        this.changed()
    }

    private closeInfluence() {
        this.influence = null
    }

    // Decisions taken back : the log told again up to them, what it told since left out ( a line
    // grown since, an action ended since, a combat begun since )
    private undo(to: number) {
        const cut = this.told.findIndex(
            told =>
                'event' in told &&
                (told.event.kind == 'decided' || told.event.kind == 'auto_passed') &&
                told.event.decision >= to,
        )
        // The driver's own lines stay : its undo's is told before the undo reaches the log
        const kept =
            cut < 0 ?
                this.told
            :   [...this.told.slice(0, cut), ...this.told.slice(cut).filter(told => 'say' in told)]
        this.told = []
        this.decision = 0
        this.lines = 0
        this.preys = []
        // The next view, a decision back, tells the preys again
        this.viewed = -1
        this.influence = null
        this.action = null
        this.combat = null
        this.endingStrike = false
        this.current = null
        this.currentCard = null
        this.blocks.clear()
        this.plays.clear()
        this.bleeding = null
        // What the views taught ( names, copies ) is kept : views are not replayed
        this.root.splice(0)
        for (const told of kept) {
            this.told.push(told)
            if ('event' in told) {
                this.at = told.at
                this.apply(told.event)
            } else if ('say' in told) {
                this.at = told.at
                this.said(told.say.seat, told.say.text)
            } else {
                this.preys = told.preys
            }
        }
        this.changed()
    }
}

// A strike in a round's line, with the damage it dealt : "hands (1)", "hands" ( at long range ),
// "dodge", "no strike"
function roundStrike(struck: StruckSide): string {
    if (!struck.strike) {
        return 'no strike'
    }
    return strikeName({ ...struck.strike, n: struck.damage > 0 ? struck.damage : null })
}

function votesText(choice: OptionView): string {
    const votes = choice.effects?.find(effect => effect.kind == 'votes')
    const n = votes?.n ?? 1
    return `${n} ${choice.favor ? 'for' : 'against'}`
}
