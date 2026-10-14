// Headless bot-vs-bot games, 2 to 5 players. Run from the repo root:
//   npx tsx script/botHarness.mjs [--games N] [--agents govern,random] [--players N] [--max-turns N]
//       [--deck NAME] [--deck-of 2=malkav,3=brujah] [--seed N] [--check-ledger] [--explain] [--trace] [--cards]
//       [--variant NAME:path=value,path=value]
// --agents lists one agent per seat; with --players N the list is cycled (or cut) to N players,
// e.g. `--players 4 --agents govern` is 4 govern bots. The agents: govern, random, utility.
// --deck is the deck of every seat, --deck-of overrides the deck of some seats (seat numbers start at 1).
// --seed N replays the same games (game k is drawn from the seed N + k): every random pick is seeded.
//   Without it a random seed is drawn and printed at the end, so a failing run can be replayed.
// --check-ledger fills the mutation history like the client does and checks that the ledger rebuilt
//   from it is the one folded live (slow).
// --explain prints the trace of the decisions of the utility agents.
// --variant NAME:... defines a variant of the utility profile ( --variant b:influence.floor=4,plan.caution=1.2 ),
//   which the agent utility@NAME plays: two profiles meet at the same table ( --agents utility,utility@b ).
// --cards lists, per agent, the cards left dead in hand the most (offered by the engine, never played).
// Exits with code 1 if any game hits a hard failure (invalid move, stall, exception, broken invariant).
import { readFileSync } from 'node:fs'
import { registerLogger, setGameResources } from '@/shared/registries.ts'
import { initWasmHasher } from '@/shared/hashing.ts'
import {
    createHeadlessGame,
    describeOption,
    playHeadlessGame,
    recordMutations,
    registerSyncMutationTrigger,
} from './harness.ts'
import { createDiagnostics } from './diagnostics.ts'
import { createCardUse } from './cardUse.ts'
import { GovernAgent } from '@/shared/bot/agents/governAgent.ts'
import { RandomAgent } from '@/shared/bot/agents/randomAgent.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { BrujahDeck, GovernDeck, MalkavDeck, NosferatuDeck } from '@/shared/bot/decks.ts'
import { AttachDeck, PoolDeck, PostBlockDeck } from './attachDeck.ts'
import { BOT_NAME } from '@/shared/const/bot.ts'
import { MAX_PLAYERS } from '@/shared/const/model.ts'

// The first turns of a Methuselah whose pool and crew are averaged
const CURVE_TURNS = 10

const DECKS = {
    govern: GovernDeck,
    malkav: MalkavDeck,
    brujah: BrujahDeck,
    nosferatu: NosferatuDeck,
    attach: AttachDeck,
    pool: PoolDeck,
    postblock: PostBlockDeck,
}

const AGENTS = {
    govern: () => new GovernAgent(),
    random: () => new RandomAgent(),
    // The utility bot knows its own decklist, never the others'
    utility: (deck, explain, profile) => new UtilityAgent(deck, profile, explain),
}

function parseArgs(argv) {
    const args = {
        games: 1,
        agents: ['govern', 'govern'],
        players: null,
        maxTurns: 200,
        deck: 'govern',
        deckOf: {},
        seed: null,
        checkLedger: false,
        explain: false,
        trace: false,
        cards: false,
        variants: {},
    }
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] == '--games') args.games = Number(argv[++i])
        else if (argv[i] == '--agents') args.agents = argv[++i].split(',')
        else if (argv[i] == '--players') args.players = Number(argv[++i])
        else if (argv[i] == '--max-turns') args.maxTurns = Number(argv[++i])
        else if (argv[i] == '--deck') args.deck = argv[++i]
        else if (argv[i] == '--deck-of') {
            for (const pair of argv[++i].split(',')) {
                const [seat, deck] = pair.split('=')
                args.deckOf[Number(seat)] = deck
            }
        } else if (argv[i] == '--seed') args.seed = Number(argv[++i])
        else if (argv[i] == '--check-ledger') args.checkLedger = true
        else if (argv[i] == '--cards') args.cards = true
        else if (argv[i] == '--variant') {
            const [name, changes] = argv[++i].split(':')
            args.variants[name] = changes.split(',').map(change => change.split('='))
        } else if (argv[i] == '--explain') args.explain = true
        else if (argv[i] == '--trace') args.trace = true
        else throw new Error(`Unknown argument ${argv[i]}`)
    }
    if (args.players !== null) {
        args.agents = Array.from(
            { length: args.players },
            (_, i) => args.agents[i % args.agents.length],
        )
    }
    args.decks = args.agents.map((_, i) => args.deckOf[i + 1] ?? args.deck)
    for (const deck of args.decks) {
        if (!DECKS[deck]) throw new Error(`Unknown deck '${deck}' (${Object.keys(DECKS)})`)
    }
    for (const name of args.agents) {
        const [agent, variant] = name.split('@')
        if (!AGENTS[agent]) throw new Error(`Unknown agent '${agent}' (${Object.keys(AGENTS)})`)
        if (variant && !args.variants[variant]) throw new Error(`Unknown variant '${variant}'`)
    }
    if (args.agents.length < 2 || args.agents.length > MAX_PLAYERS) {
        throw new Error(`A game needs 2 to ${MAX_PLAYERS} players, got ${args.agents.length}`)
    }
    return args
}

// mulberry32: a small seeded generator, replaces Math.random so a failing game can be replayed
function seededRandom(seed) {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const args = parseArgs(process.argv.slice(2))

// The default profile with the changes of a variant ( paths of numbers, like influence.floor )
function profileOf(variant) {
    const profile = structuredClone(DEFAULT_PROFILE)
    for (const [path, value] of args.variants[variant] ?? []) {
        const keys = path.split('.')
        const last = keys.pop()
        const holder = keys.reduce((object, key) => object[key], profile)
        if (typeof holder[last] != 'number')
            throw new Error(`${path} is not a number of the profile`)
        holder[last] = Number(value)
    }
    return profile
}

registerLogger({
    captureException: error => console.error(error),
    captureMessage: message => console.warn(message),
})
await initWasmHasher()
setGameResources('cardbase', JSON.parse(readFileSync('public/assets/cardbase.json', 'utf-8')))
registerSyncMutationTrigger()

const baseSeed = args.seed ?? Math.floor(Math.random() * 1e9)
const failures = []
const winsByName = {}
const winsByAgent = {}
const winsBySeat = {}
// What happened to the seats of an agent, over all the games
const statsByAgent = {}
let turnLimits = 0
let totalTurns = 0
const startTime = performance.now()

// Bots are named Bot1, Bot2... in the order of the agent list
const seatOfName = name => Number(name.slice(BOT_NAME.length)) - 1
const agentOfName = name => `${args.agents[seatOfName(name)]} (${name})`
const increment = (record, key) => (record[key] = (record[key] ?? 0) + 1)

function addStats(agentName, seat) {
    const stats = (statsByAgent[agentName] ??= {
        seats: 0,
        wins: 0,
        ousted: 0,
        ousters: {},
        poolLostToBleeds: 0,
        turns: 0,
        cardUse: {},
        curve: [],
    })
    stats.seats++
    stats.turns += seat.turns
    stats.wins += seat.won ? 1 : 0
    if (seat.ouster !== null) {
        stats.ousted++
        increment(stats.ousters, seat.ouster.kind)
        // Minions that stood unlocked but had no block to make
        if (seat.ouster.kind == 'noBlockOffered' && seat.ouster.unlocked > 0) {
            increment(stats.ousters, 'noBlockOffered with unlocked minions')
        }
    }
    seat.curve.slice(0, CURVE_TURNS).forEach((point, turn) => {
        const row = (stats.curve[turn] ??= { pool: 0, minions: 0, capacity: 0, seats: 0 })
        row.pool += point.pool
        row.minions += point.minions
        row.capacity += point.capacity
        row.seats++
    })
    for (const card of seat.cards) {
        const use = (stats.cardUse[card.name] ??= {
            seen: 0,
            played: 0,
            dead: 0,
            unplayable: 0,
            other: 0,
            kinds: {},
        })
        use.seen++
        if (card.fate == 'played') use.played++
        else if (card.fate == 'other') use.other++
        else if (card.offered) {
            use.dead++
            for (const kind of card.kinds) increment(use.kinds, kind)
        } else use.unplayable++
    }
    for (const key of [
        'poolLostToBleeds',
        'blocksAttempted',
        'blocksSucceeded',
        'blocksFailed',
        'blocksWithdrawn',
        'blocksDeclined',
        'actionsBlocked',
        'bleedsDeclared',
        'bleedsLanded',
        'bouncesPlayed',
        'torporTaken',
        'torporInflicted',
    ]) {
        stats[key] = (stats[key] ?? 0) + seat[key]
    }
}

for (let game = 1; game <= args.games; game++) {
    Math.random = seededRandom(baseSeed + game)
    const recorder = recordMutations({ history: args.checkLedger })
    const { gameState, players } = createHeadlessGame(args.decks.map(deck => DECKS[deck]))
    const diagnostics = createDiagnostics(gameState)
    const cardUse = createCardUse(gameState)
    const explain =
        args.explain ?
            entry => {
                console.log(
                    `T${gameState.turnNumber} ${entry.kind} ${entry.player} -> ${describeOption(entry.chosen)}${entry.note ? ` [${entry.note}]` : ''}`,
                )
                for (const { option, score, parts } of entry.candidates) {
                    console.log(
                        `    ${score.toFixed(2)} ${describeOption(option)} ${JSON.stringify(parts)}`,
                    )
                }
            }
        :   undefined
    const agents = new Map(
        players.map((player, i) => [
            player.oid,
            (([agent, variant]) =>
                AGENTS[agent](
                    DECKS[args.decks[i]],
                    explain,
                    variant ? profileOf(variant) : undefined,
                ))(args.agents[i].split('@')),
        ]),
    )

    try {
        const report = playHeadlessGame(gameState, agents, {
            maxTurns: args.maxTurns,
            maxSteps: 100000,
            recorder,
            beforeStep: () => {
                diagnostics.before()
                cardUse.before()
            },
            onStep: step => {
                diagnostics.after(step)
                cardUse.after(step)
                if (args.trace) {
                    console.log(
                        `T${gameState.turnNumber} ${step.decision.kind} ${step.decision.player.name}${step.forced ? ' (forced)' : ''}: ${describeOption(step.option)}`,
                    )
                }
            },
        })
        totalTurns += report.turns
        const outcome = diagnostics.finish(recorder.ledger, report.turns, report.winner)
        const cards = cardUse.finish()
        for (const [i, player] of players.entries()) {
            addStats(args.agents[i], {
                ...outcome.seats[player.oid],
                turns: report.turns,
                cards: cards[player.oid],
            })
        }
        if (report.outcome == 'win') {
            increment(winsByName, report.winner)
            increment(winsByAgent, agentOfName(report.winner))
            increment(winsBySeat, `seat ${report.winnerSeat + 1}`)
        } else {
            turnLimits++
        }
        console.log(
            `game ${game}: ${report.outcome}${report.winner ? ` ${report.winner}` : ''}, ${report.turns} turns, ${report.steps} steps, ${report.players.map(p => `${p.name} pool ${p.pool} VP ${p.victoryPoints}`).join(' | ')}`,
        )
    } catch (error) {
        failures.push(error)
        console.error(`game ${game}: FAILURE (replay with --seed ${baseSeed}) ${error.message}`)
    } finally {
        recorder.stop()
    }
}

const seconds = ((performance.now() - startTime) / 1000).toFixed(1)
const sorted = record =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)))
console.log(
    `\n${args.games} games of ${args.agents.length} players in ${seconds}s (seed ${baseSeed}), ${failures.length} failures, ` +
        `${turnLimits} turn limits, avg ${(totalTurns / Math.max(1, args.games - failures.length)).toFixed(1)} turns`,
)
console.log(`wins by bot:   ${JSON.stringify(sorted(winsByName))}`)
console.log(`wins by agent: ${JSON.stringify(sorted(winsByAgent))}`)
console.log(`wins by seat:  ${JSON.stringify(sorted(winsBySeat))}`)

// The matchup: the win rate of each agent against the one expected from the table size
// ( 1 / players: the same brain everywhere gives it ), then how the seats of each agent fared
const expected = (100 / args.agents.length).toFixed(1)
for (const [agentName, stats] of Object.entries(statsByAgent).sort(([a], [b]) =>
    a < b ? -1 : 1,
)) {
    const perSeat = value => (value / stats.seats).toFixed(2)
    const ousted =
        stats.ousted > 0 ?
            `${stats.ousted} ousted (${Object.entries(stats.ousters)
                .map(([kind, count]) => `${count} ${kind}`)
                .join(', ')})`
        :   'never ousted'
    const uses = Object.entries(stats.cardUse)
    const total = key => uses.reduce((sum, [, use]) => sum + use[key], 0)
    const seen = Math.max(1, total('seen'))
    const share = key => ((100 * total(key)) / seen).toFixed(1)
    console.log(
        `cards ${agentName}: ${perSeat(total('seen'))} drawn per game, ${share('played')}% played, ${share('dead')}% dead ` +
            `(offered, never played), ${share('unplayable')}% never offered, ${share('other')}% gone otherwise`,
    )
    if (args.cards) {
        const rows = uses.filter(([, use]) => use.dead > 0).sort(([, a], [, b]) => b.dead - a.dead)
        for (const [name, use] of rows.slice(0, 25)) {
            console.log(
                `    ${name}: ${use.dead} dead of ${use.seen} (${use.played} played, ${use.unplayable} never offered) in ${Object.keys(use.kinds).join('/')}`,
            )
        }
    }
    const curve = stats.curve.map(
        row =>
            `${(row.pool / row.seats).toFixed(0)}/${(row.minions / row.seats).toFixed(1)}/${(row.capacity / row.seats).toFixed(0)}`,
    )
    console.log(
        `curve ${agentName} (pool/minions/capacity at the end of turns 1-${CURVE_TURNS}): ${curve.join(' ')}`,
    )
    console.log(
        `matchup ${agentName}: ${stats.wins}/${stats.seats} wins ${((100 * stats.wins) / stats.seats).toFixed(1)}% ` +
            `(expected ${expected}%), pool lost to bleeds ${(stats.poolLostToBleeds / Math.max(1, stats.turns)).toFixed(2)} per turn, ${ousted}, ` +
            `blocks ${perSeat(stats.blocksAttempted)} attempted ${perSeat(stats.blocksSucceeded)} won ${perSeat(stats.blocksFailed)} failed ` +
            `${perSeat(stats.blocksWithdrawn)} withdrawn ${perSeat(stats.blocksDeclined)} declined per game, actions blocked ${perSeat(stats.actionsBlocked)}, ` +
            `bleeds ${perSeat(stats.bleedsLanded)}/${perSeat(stats.bleedsDeclared)} landed/declared, bounces ${perSeat(stats.bouncesPlayed)}, ` +
            `torpor taken ${perSeat(stats.torporTaken)} inflicted ${perSeat(stats.torporInflicted)} per game`,
    )
}
process.exit(failures.length > 0 ? 1 : 0)
