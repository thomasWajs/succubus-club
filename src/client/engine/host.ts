/**
 * Where the rules engine runs. The game code only knows this interface :
 * LocalEngineHost runs the engine in the browser ( wasm ) ; a remote host will
 * carry the same messages over a WebSocket.
 */

import init, { catalog, checkDeck, Game } from 'zvtes-wasm'
import { DeckList } from '@/shared/types/gateway.ts'
import { EngineDeckError, EngineGameSpec, EngineOut } from '@/client/engine/protocol.ts'

export interface EngineHost {
    // The next message : a decision for the human, a decision taken by a bot, or the end of the game
    advance(): Promise<EngineOut>
    // Answer the pending human decision
    answer(decision: number, index: number): Promise<EngineOut>
    // Answer the allocation under way at once ( a decision's `allocation` ), in its recipients' order :
    // one decision taken per step the engine asked
    allocate(decision: number, amounts: number[]): Promise<EngineOut[]>
    // Cast all the votes one way ( a decision's `votes` ) : this one now, the others as their turn
    // comes in this polling ( `advance` takes them )
    voteAll(decision: number, favor: boolean): Promise<EngineOut>
    // Take back the previous step of the multi-step choice under way ( when a decision says `undo` )
    undo(): Promise<void>
    // Whether the user is asked on their opportunities ( on by default ) : off, a wake only on their
    // prey's or predator's actions or one directed at them, an ability usable at any time only where
    // the decision pauses anyway, and a decision left with a pass alone passes by itself
    setOpportunities(on: boolean): Promise<void>
    // The game as a replay ( JSON ) : the spec and every decision
    replay(): Promise<string>
}

let ready: Promise<unknown> | null = null

function loadEngine() {
    if (!ready) {
        ready = init()
    }
    return ready
}

export class LocalEngineHost implements EngineHost {
    private constructor(private game: Game) {}

    // policy : the trained network's weights, for the bots of style 'network'
    static async create(spec: EngineGameSpec, policy?: Uint8Array): Promise<LocalEngineHost> {
        await loadEngine()
        const game =
            policy ? Game.withPolicy(JSON.stringify(spec), policy) : new Game(JSON.stringify(spec))
        return new LocalEngineHost(game)
    }

    async advance(): Promise<EngineOut> {
        return JSON.parse(this.game.advance())
    }

    async answer(decision: number, index: number): Promise<EngineOut> {
        return JSON.parse(this.game.answer(decision, index))
    }

    async allocate(decision: number, amounts: number[]): Promise<EngineOut[]> {
        return JSON.parse(this.game.allocate(decision, Uint8Array.from(amounts)))
    }

    async voteAll(decision: number, favor: boolean): Promise<EngineOut> {
        return JSON.parse(this.game.voteAll(decision, favor))
    }

    async undo(): Promise<void> {
        this.game.undo()
    }

    async setOpportunities(on: boolean): Promise<void> {
        this.game.setOpportunities(on)
    }

    async replay(): Promise<string> {
        return this.game.replay()
    }
}

// The trained network's weights, if the app serves them : the bots play the
// network with them, the engine's scripted bots without.
const POLICY_URL = '/assets/zvtes-policy.zvp'

export async function loadEnginePolicy(): Promise<Uint8Array | undefined> {
    try {
        const response = await fetch(POLICY_URL)
        // A missing asset may be answered by the app's page : check it's the weights file
        if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
            return undefined
        }
        return new Uint8Array(await response.arrayBuffer())
    } catch {
        return undefined
    }
}

// The decks the engine ships : [name, deck list]
export async function engineCatalog(): Promise<[string, DeckList][]> {
    await loadEngine()
    return JSON.parse(catalog())
}

// null when the engine can play this deck
export async function checkEngineDeck(deckList: DeckList): Promise<EngineDeckError | null> {
    await loadEngine()
    return JSON.parse(checkDeck(JSON.stringify(deckList)))
}
