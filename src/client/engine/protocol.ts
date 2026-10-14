/**
 * The rules engine's messages as the driver reads them : the server's ( ./api.ts ) translated by
 * EngineHost ( ./host.ts ) — minions, cards in play and options in the table's terms.
 */

// A physical card : `copy` is stable across views, `id` is the KRCG id when the viewer may know it
export type EngineCard = {
    copy: number
    id: number | null
    crypt: boolean
}

export type EngineInPlay = {
    card: EngineCard
    controller: number
    locked: boolean
    counters: number
    contested: boolean
    stored: EngineCard[]
}

export type EngineMinion = {
    minion: number
    card: EngineCard
    kind: 'vampire' | 'ally' | 'created' | 'token'
    name: string
    blood: number
    capacity: number | null
    locked: boolean
    contested: boolean
    title: string | null
    owner: number | null
    cards: EngineInPlay[]
    markers: string[]
    corruption?: number // Corruption counters on it, all Methuselahs'
}

export type EngineSlot = {
    card: EngineCard
    counters: number
    banished: boolean
}

export type EngineSeat = {
    seat: number
    pool: number
    vps: number
    ousted: boolean
    edge: boolean
    prey: number
    predator: number
    crypt: EngineCard[] // top last
    library: EngineCard[] // top last
    hand: EngineCard[]
    ash_heap: EngineCard[]
    removed: EngineCard[]
    uncontrolled: EngineSlot[]
    ready: EngineMinion[]
    torpor: EngineMinion[]
    in_play: EngineInPlay[]
    limbo: EngineCard[]
}

export type EngineTarget =
    | { kind: 'minion'; minion: number }
    | { kind: 'seat'; seat: number }
    | { kind: 'card'; copy: number } // A card in play, a vampire in an uncontrolled region

export type EngineCombatSide = {
    minion: number
    strike?: string
    maneuvers: number
    presses: number
}

export type EnginePhase = 'unlock' | 'master' | 'minion' | 'influence' | 'discard' | 'over'

export type EngineView = {
    viewer: number | null
    decision: number
    turn: number
    active: number
    phase: EnginePhase
    seats: EngineSeat[]
    transfers?: number // The active seat's transfers left, during its influence phase
    action: {
        seat: number
        acting: number
        kind: string
        card: number | null
        target: EngineTarget | null
        bleed_target: number | null
        source: number | null // The card in play granting the action ( engine card id )
        // 'announced', 'open', 'attempt', 'declined', 'would succeed', 'blocked', 'after combat', 'resolved'
        step: string
        stealth: number
        bleed: number | null // For a bleed
        blocker: number | null // The minion attempting the block, or that blocked
        intercept: number | null // The blocker's
        declined: number[] // The Methuselahs who declined to block
        mode?: EngineMode // The action card's Disciplines and level
        x?: number // The action card's X
    } | null
    combat: {
        minions: [number, number]
        round: number
        range: string
        // Each side, the acting minion's first : the strike it declared this round ( its text, absent
        // until declared ), the maneuvers and presses it has for the round
        sides?: EngineCombatSide[]
    } | null
    referendum: {
        caller: number
        calling: number | null
        votes_for: number
        votes_against: number
        chosen: number | null // The Methuselah the terms chose
        allocated: [number, number][] // The points allocated so far : [seat, points]
        // The other terms chosen : Methuselahs, minions, a clan, cards in play ( engine card ids )
        seats: number[]
        minions: number[]
        clan?: string
        cards: number[]
        card_allocated: [number, number][] // [card id, points]
        step: 'terms' | 'polling' | 'shortfall'
        votes: EngineVote[] // Every vote cast so far
    } | null
}

// Votes cast : by whom, from what ( a vampire, votes printed on one, the Edge, a political action
// card, a card in play ), which way, how many ; canceled ones are not tallied
export type EngineVote = {
    seat: number
    source: 'vampire' | 'printed' | 'edge' | 'card' | 'in_play'
    minion?: number
    copy?: number // The card in play's
    favor: boolean
    n: number
    canceled: boolean
}

export type EngineOption = {
    index: number
    kind: string
    text: string
    card?: { id: number | null; copy: number | null }
    minion?: number
    actor?: number
    target?: EngineTarget
    action?: string // The action a minion takes : 'bleed', 'hunt', ...
    amount?: number
    favor?: boolean
    mode?: EngineMode // A card played : its mode
    blood?: number // The blood an ability moves onto ( + ) or off ( − ) its vampire ( minion )
    // A card chosen by name ( a search ) : where it is taken from, and whose
    zone?: EngineZone
}

// The mode a card is played in : its index, its printed tags ( 'dom' basic, 'DOM' superior,
// 'COMBAT'... ), the printed line it is from ( a line the engine splits is several modes ) and
// what sets it apart from the others of its line ( 'gain 3 blood' ), when its effects say ; what
// its target is for, when the play chooses another minion after it ( Toreador Grand Ball )
export type EngineMode = {
    index: number
    tags: string[]
    line?: number
    label?: string
    target?: string
}

// A seat's zone a search takes a card from
export type EngineZone = { seat: number; zone: 'library' | 'ash_heap' | 'hand' | 'crypt' }

// A recipient of referendum points : a Methuselah ( seat ) or a card in play
export type EngineRecipient = {
    name: string
    seat?: number
    card?: { id: number | null; copy: number | null }
    cap?: number // At most this many ( a shortfall : what the terms gave )
}

// An allocation of points under way, whole : answered at once ( EngineHost.allocate )
export type EngineAllocation = {
    points: number // All of them, in the end
    recipients: EngineRecipient[] // In the order the engine asks them
    min_nonzero: number // How many recipients must get a point at least
}

// The votes castable now, each way, by the user's vampires and calling card ( EngineHost.voteAll )
export type EngineVotes = { favor: number; against: number }

export type EngineOut =
    | {
          type: 'decision'
          decision: number
          seat: number
          window: string
          options: EngineOption[]
          prompt?: string // What the choice is for, when the options alone do not say ( a referendum's terms )
          undo: boolean // The previous step of this multi-step choice can be taken back
          allocation?: EngineAllocation
          votes?: EngineVotes
          events?: string[] // What happened since the previous message
          view: EngineView
      }
    | {
          type: 'decided'
          decision: number
          seat: number
          window: string
          choice: EngineOption
          events?: string[]
          view: EngineView
      }
    | { type: 'over'; vps: number[]; events?: string[]; view: EngineView }
