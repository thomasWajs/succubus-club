/**
 * The zero-vtes protocol : the JSON messages of the rules engine ( zvtes-wasm ).
 * The same messages are spoken in-process ( LocalEngineHost ) and, later, by a server.
 */

import { DeckList } from '@/shared/types/gateway.ts'

export type EnginePlayer = { kind: 'human' } | { kind: 'bot'; style: string }

export type EngineSeatSpec = {
    name: string
    deck: DeckList
    player: EnginePlayer
}

export type EngineGameSpec = {
    seed: number
    time_limit?: number
    seats: EngineSeatSpec[]
}

// A physical card : `copy` is stable across views, `id` is the KRCG id when the viewer may know it
export type EngineCard = {
    copy: number
    id: number | null
    crypt: boolean
}

export type EngineInPlay = {
    card_id: number
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
    | { kind: 'uncontrolled'; slot: number }
    | { kind: 'card'; card_id: number }

export type EnginePhase = 'unlock' | 'master' | 'minion' | 'influence' | 'discard' | 'over'

export type EngineView = {
    viewer: number | null
    decision: number
    turn: number
    active: number
    phase: EnginePhase
    seats: EngineSeat[]
    action: {
        seat: number
        acting: number
        kind: string
        card: number | null
        target: EngineTarget | null
        bleed_target: number | null
    } | null
    combat: { minions: [number, number]; round: number; range: string } | null
    referendum: {
        caller: number
        calling: number | null
        votes_for: number
        votes_against: number
        chosen: number | null // The Methuselah the terms chose
        allocated: [number, number][] // The points allocated so far : [seat, points]
    } | null
}

export type EngineOption = {
    index: number
    kind: string
    text: string
    card?: { id: number | null; copy: number | null; card_id: number | null }
    minion?: number
    actor?: number
    target?: EngineTarget
    action?: string // The action a minion takes : 'bleed', 'hunt', ...
    amount?: number
    favor?: boolean
}

export type EngineOut =
    | {
          type: 'decision'
          decision: number
          seat: number
          window: string
          options: EngineOption[]
          undo: boolean // The previous step of this multi-step choice can be taken back
          view: EngineView
      }
    | {
          type: 'decided'
          decision: number
          seat: number
          window: string
          choice: EngineOption
          view: EngineView
      }
    | { type: 'over'; vps: number[]; view: EngineView }

export type EngineDeckError =
    | { error: 'unsupported'; ids: string[] }
    | { error: 'too_small'; crypt: number; library: number }
