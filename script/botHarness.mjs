// Headless bot-vs-bot games, 2 to 5 players. Run from the repo root:
//   npx tsx script/botHarness.mjs [--games N] [--agents govern,random] [--players N] [--max-turns N] [--trace]
// --agents lists one agent per seat; with --players N the list is cycled (or cut) to N players,
// e.g. `--players 4 --agents govern` is 4 govern bots.
// Exits with code 1 if any game hits a hard failure (invalid move, stall, exception, broken invariant).
import { readFileSync } from 'node:fs'
import { registerLogger, setGameResources } from '@/shared/registries.ts'
import { initWasmHasher } from '@/shared/serialization.ts'
import {
    createHeadlessGame,
    describeOption,
    playHeadlessGame,
    registerSyncMutationTrigger,
} from '@/shared/bot/harness.ts'
import { GovernAgent } from '@/shared/bot/agents/governAgent.ts'
import { RandomAgent } from '@/shared/bot/agents/randomAgent.ts'
import { GovernDeck } from '@/shared/bot/decks.ts'
import { BOT_NAME } from '@/shared/const/bot.ts'
import { MAX_PLAYERS } from '@/shared/const/model.ts'

const AGENTS = {
    govern: () => new GovernAgent(),
    random: () => new RandomAgent(),
}

function parseArgs(argv) {
    const args = {
        games: 1,
        agents: ['govern', 'govern'],
        players: null,
        maxTurns: 200,
        trace: false,
    }
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] == '--games') args.games = Number(argv[++i])
        else if (argv[i] == '--agents') args.agents = argv[++i].split(',')
        else if (argv[i] == '--players') args.players = Number(argv[++i])
        else if (argv[i] == '--max-turns') args.maxTurns = Number(argv[++i])
        else if (argv[i] == '--trace') args.trace = true
        else throw new Error(`Unknown argument ${argv[i]}`)
    }
    if (args.players !== null) {
        args.agents = Array.from(
            { length: args.players },
            (_, i) => args.agents[i % args.agents.length],
        )
    }
    for (const name of args.agents) {
        if (!AGENTS[name]) throw new Error(`Unknown agent '${name}' (${Object.keys(AGENTS)})`)
    }
    if (args.agents.length < 2 || args.agents.length > MAX_PLAYERS) {
        throw new Error(`A game needs 2 to ${MAX_PLAYERS} players, got ${args.agents.length}`)
    }
    return args
}

const args = parseArgs(process.argv.slice(2))

registerLogger({
    captureException: error => console.error(error),
    captureMessage: message => console.warn(message),
})
await initWasmHasher()
setGameResources('cardbase', JSON.parse(readFileSync('public/assets/cardbase.json', 'utf-8')))
registerSyncMutationTrigger()

const failures = []
const winsByName = {}
const winsByAgent = {}
const winsBySeat = {}
let turnLimits = 0
let totalTurns = 0
const startTime = performance.now()

// Bots are named Bot1, Bot2... in the order of the agent list
const agentOfName = name => `${args.agents[Number(name.slice(BOT_NAME.length)) - 1]} (${name})`
const increment = (record, key) => (record[key] = (record[key] ?? 0) + 1)

for (let game = 1; game <= args.games; game++) {
    const { gameState, players } = createHeadlessGame(args.agents.map(() => GovernDeck))
    const agents = new Map(players.map((player, i) => [player.oid, AGENTS[args.agents[i]]()]))

    try {
        const report = playHeadlessGame(gameState, agents, {
            maxTurns: args.maxTurns,
            maxSteps: 100000,
            onStep:
                args.trace ?
                    step =>
                        console.log(
                            `T${gameState.turnNumber} ${step.decision.kind} ${step.decision.player.name}${step.forced ? ' (forced)' : ''}: ${describeOption(step.option)}`,
                        )
                :   undefined,
        })
        totalTurns += report.turns
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
        console.error(`game ${game}: FAILURE ${error.message}`)
    }
}

const seconds = ((performance.now() - startTime) / 1000).toFixed(1)
const sorted = record =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)))
console.log(
    `\n${args.games} games of ${args.agents.length} players in ${seconds}s, ${failures.length} failures, ` +
        `${turnLimits} turn limits, avg ${(totalTurns / Math.max(1, args.games - failures.length)).toFixed(1)} turns`,
)
console.log(`wins by bot:   ${JSON.stringify(sorted(winsByName))}`)
console.log(`wins by agent: ${JSON.stringify(sorted(winsByAgent))}`)
console.log(`wins by seat:  ${JSON.stringify(sorted(winsBySeat))}`)
process.exit(failures.length > 0 ? 1 : 0)
