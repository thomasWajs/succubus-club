// The table assessment of the utility bot ( step 3.2 ), as a dev tool. Run from the repo root:
//   npm run bot:assess -- [--players N] [--deck NAME] [--deck-of 2=malkav,3=brujah] [--turn N] [--seed N]
//     plays a headless game with the Govern rules up to a turn, then prints what each player makes of
//     the table, through its player view. The decks: govern, malkav, brujah, nosferatu. Defaults: 3
//     players, govern, turn 12, seed 1.
//   npm run bot:assess -- --sweep N [--seed N]
//     the gate used by bot:check: plays N games of 2 to 5 players on the four decks and assesses the table
//     for the player that decides, every few steps, failing on any number that is not finite, any chance
//     outside 0 to 1, any weight below its floor, and any exception.
import { readFileSync } from 'node:fs'
import { registerLogger, setGameResources } from '@/shared/registries.ts'
import { initWasmHasher } from '@/shared/hashing.ts'
import {
    createHeadlessGame,
    HarnessFailure,
    playHeadlessGame,
    recordMutations,
    registerSyncMutationTrigger,
} from './harness.ts'
import { GovernAgent } from '@/shared/bot/agents/governAgent.ts'
import { BrujahDeck, GovernDeck, MalkavDeck, NosferatuDeck } from '@/shared/bot/decks.ts'
import { createPlayerView } from '@/shared/bot/playerView.ts'
import { getDecidingPlayer, getDecisionPoint } from '@/shared/bot/referee.ts'
import { Assessment, assess, survivalCurve } from '@/shared/bot/utility/assessment.ts'
import { DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { describeAssessment, describeTurnPlan } from '@/shared/bot/utility/describeAssessment.ts'
import { candidateOf, planTurn, TurnPlan } from '@/shared/bot/utility/turnPlan.ts'
import { DecisionKind, optionsOfType } from '@/shared/bot/types.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { TurnPhase } from '@/shared/const/model.ts'

const DECKS: Record<string, DeckList> = {
    govern: GovernDeck,
    malkav: MalkavDeck,
    brujah: BrujahDeck,
    nosferatu: NosferatuDeck,
}

function parseArgs(argv: string[]) {
    const args = {
        players: 3,
        deck: 'govern',
        deckOf: {} as Record<number, string>,
        turn: 12,
        seed: 1,
        sweep: 0,
    }
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] == '--players') args.players = Number(argv[++i])
        else if (argv[i] == '--deck') args.deck = argv[++i]
        else if (argv[i] == '--deck-of') {
            for (const pair of argv[++i].split(',')) {
                const [seat, deck] = pair.split('=')
                args.deckOf[Number(seat)] = deck
            }
        } else if (argv[i] == '--turn') args.turn = Number(argv[++i])
        else if (argv[i] == '--seed') args.seed = Number(argv[++i])
        else if (argv[i] == '--sweep') args.sweep = Number(argv[++i])
        else throw new Error(`Unknown argument ${argv[i]}`)
    }
    return args
}

// mulberry32, like botHarness: the same seed plays the same game
function seededRandom(seed: number) {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// What a sane assessment looks like, whatever the board
function findProblems(assessment: Assessment): string[] {
    const problems: string[] = []
    const check = (value: number, what: string, min: number, max = Infinity) => {
        if (!Number.isFinite(value) || value < min - 1e-9 || value > max + 1e-9) {
            problems.push(`${what} is ${value}`)
        }
    }
    for (const [oid, power] of Object.entries(assessment.power)) {
        check(power, `power of ${oid}`, 0)
    }
    for (const [oid, densities] of Object.entries(assessment.densities)) {
        for (const [role, density] of Object.entries(densities)) {
            check(density, `${role} density of ${oid}`, 0, 1)
        }
    }
    for (const [oid, threat] of Object.entries(assessment.threat)) {
        check(threat.bleed, `bleed threat of ${oid}`, 0)
        check(threat.combat, `combat threat of ${oid}`, 0)
        check(threat.chanceOfOust, `chance of ouster by ${oid}`, 0, 1)
        check(threat.bounced, `bounced pool of the bleeds of ${oid}`, 0)
    }
    for (const [oid, opportunity] of Object.entries(assessment.opportunity)) {
        check(opportunity.drain, `drain of ${oid}`, 0)
        check(opportunity.chanceOfOust, `chance to oust ${oid}`, 0, 1)
        check(opportunity.blockedShare, `blocked share of ${oid}`, 0, 1)
        check(opportunity.bounced, `bounced pool of ${oid}`, 0)
        check(opportunity.chanceOfBounce, `chance of bounce of ${oid}`, 0, 1)
        // Nothing is bounced when there is nowhere to send it: with two Methuselahs left
        if (assessment.table.others.length < 2 && opportunity.chanceOfBounce > 0) {
            problems.push(`${oid} bounces with two Methuselahs left`)
        }
    }
    // Only ready minions are kept back, and only by the Methuselahs that are not me
    for (const other of assessment.table.others) {
        const ready = other.minions.filter(minion => minion.state != 'torpor')
        for (const oid of assessment.held[other.oid] ?? []) {
            if (!ready.some(minion => minion.oid == oid)) {
                problems.push(`${other.name} keeps ${oid} back, which is not a ready minion of it`)
            }
        }
    }
    const { floor } = assessment.profile.stakes
    for (const [oid, stake] of Object.entries(assessment.stakes)) {
        check(stake.weight, `stake of ${oid}`, floor * stake.ring)
        check(stake.leader, `leader of ${oid}`, 0)
    }
    for (const opening of assessment.rescues) {
        check(opening.chance, `rescue chance of ${opening.vampire.name}`, 0, 1)
        check(opening.value, `rescue value of ${opening.vampire.name}`, -Infinity)
    }
    const curve = survivalCurve(assessment).map(point => point.chanceOfOust)
    curve.forEach((chance, reserved) => {
        check(chance, `chance of ouster with ${reserved} unlocked`, 0, 1)
        // Each blocker helps ( or changes nothing ): never the other way
        if (reserved > 0 && chance > curve[reserved - 1] + 1e-9) {
            problems.push(
                `blocker ${reserved} makes the chance of ouster rise: ${curve.map(value => value.toFixed(3)).join(', ')}`,
            )
        }
    })
    return problems
}

// What a sane turn plan looks like, whatever the board
function findPlanProblems(plan: TurnPlan, assessment: Assessment): string[] {
    const problems: string[] = []
    const check = (value: number, what: string, min: number, max = Infinity) => {
        if (!Number.isFinite(value) || value < min - 1e-9 || value > max + 1e-9) {
            problems.push(`${what} is ${value}`)
        }
    }
    const unlocked = assessment.table.me.minions.filter(minion => minion.state == 'unlocked')
    for (const minion of plan.reserved) {
        if (!unlocked.some(one => one.oid == minion.oid)) {
            problems.push(`${minion.name} is kept home and is not an unlocked minion`)
        }
    }
    const acting = new Map<string, string>()
    for (const action of plan.actions) {
        check(action.value, `value of ${action.kind} by ${action.actor.name}`, -Infinity)
        if (plan.reserved.some(minion => minion.oid == action.actor.oid)) {
            problems.push(`${action.actor.name} is kept home and acts`)
        }
        const key = `${action.actor.oid}/${action.kind}`
        if (acting.has(key)) {
            problems.push(`${action.actor.name} does ${action.kind} twice in the plan`)
        }
        acting.set(key, action.kind)
    }
    if (plan.posture != 'forced') {
        if (plan.cases.length != unlockedWithActions(plan) + 1) {
            problems.push(`${plan.cases.length} reserves played out`)
        }
        const best = Math.max(...plan.cases.map(one => one.equity))
        if (plan.cases[plan.chosen]?.equity === undefined) {
            problems.push('no reserve is chosen')
        } else if (plan.cases[plan.chosen].equity < best - 1e-9) {
            problems.push('the reserve chosen is not the best')
        }
        for (const one of plan.cases) {
            check(one.equity, 'equity', -Infinity)
            check(one.chanceToOust, 'chance to oust', 0, 1)
            check(one.chanceOfBeingOusted, 'chance of being ousted', 0, 1)
            check(one.combat, 'fights', 0)
            check(one.cards, 'cards', 0)
        }
    }
    return problems
}

// The minions that could act: the reserves played out are one more than that
function unlockedWithActions(plan: TurnPlan): number {
    return plan.cases.length > 0 ? plan.cases[0].kept.length : 0
}

registerLogger({
    captureException: error => console.error(error),
    captureMessage: message => console.warn(message),
})
await initWasmHasher()
setGameResources('cardbase', JSON.parse(readFileSync('public/assets/cardbase.json', 'utf-8')))
registerSyncMutationTrigger()

const args = parseArgs(process.argv.slice(2))
const deckNames = Object.keys(DECKS)

function playGame(
    seed: number,
    decks: DeckList[],
    beforeStep: (gameState: ReturnType<typeof createHeadlessGame>['gameState']) => void,
    maxTurns = 1000,
) {
    Math.random = seededRandom(seed)
    const recorder = recordMutations({ history: false })
    const { gameState, players } = createHeadlessGame(decks)
    const agents = new Map(players.map(player => [player.oid, new GovernAgent()]))
    playHeadlessGame(gameState, agents, {
        maxTurns,
        maxSteps: 100000,
        recorder,
        beforeStep: () => beforeStep(gameState),
    })
}

if (args.sweep > 0) {
    let assessments = 0
    let plans = 0
    const failures: string[] = []
    for (let game = 1; game <= args.sweep; game++) {
        const players = 2 + (game % 4)
        const names = Array.from({ length: players }, (_, i) => deckNames[(game + i) % 4])
        let steps = 0
        try {
            playGame(
                args.seed + game,
                names.map(name => DECKS[name]),
                gameState => {
                    steps++
                    const minionPhase =
                        gameState.turnPhase == TurnPhase.Minion &&
                        !gameState.action &&
                        !gameState.combat
                    const deciding =
                        steps % 7 == 0 || minionPhase ? getDecidingPlayer(gameState) : null
                    if (!deciding) {
                        return
                    }
                    const view = createPlayerView(gameState, deciding)
                    try {
                        const assessment = assess(view.gameState, view.player, DEFAULT_PROFILE)
                        const problems = steps % 7 == 0 ? findProblems(assessment) : []
                        const decision =
                            minionPhase ? getDecisionPoint(view.gameState, view.player) : null
                        if (decision?.kind == DecisionKind.Minion) {
                            const plan = planTurn({
                                assessment,
                                candidates: optionsOfType(decision.options, 'declareAction')
                                    .map(candidateOf)
                                    .filter(candidate => candidate.kind != 'other'),
                                mandatory: !decision.options.some(
                                    option => option.type == 'endPhase',
                                ),
                                unlockCards: 0,
                            })
                            plans++
                            problems.push(...findPlanProblems(plan, assessment))
                            if (process.env.ASSESS_DEBUG && problems.length > 0) {
                                console.log(describeTurnPlan(plan).join(String.fromCharCode(10)))
                            }
                        }
                        assessments++
                        if (problems.length > 0) {
                            if (process.env.ASSESS_DEBUG && failures.length == 0) {
                                console.log(
                                    describeAssessment(assess(view.gameState, view.player)).join(
                                        String.fromCharCode(10),
                                    ),
                                )
                            }
                            failures.push(
                                `FAILURE game ${game} ( ${names.join(',')} ), turn ${gameState.turnNumber}, ${deciding.name}: ${problems.join('; ')}`,
                            )
                        }
                    } finally {
                        view.dispose()
                    }
                },
                80,
            )
        } catch (error) {
            const reason = error instanceof Error ? error.stack : String(error)
            failures.push(`FAILURE game ${game} ( ${names.join(',')} ): ${reason}`)
        }
    }
    failures.forEach(failure => console.log(failure))
    console.log(
        `${args.sweep} games of 2 to 5 players, ${assessments} assessments, ${plans} turn plans, ${failures.length} failures`,
    )
    process.exit(failures.length > 0 ? 1 : 0)
}

for (const name of [args.deck, ...Object.values(args.deckOf)]) {
    if (!DECKS[name]) {
        throw new Error(`Unknown deck '${name}' (${deckNames})`)
    }
}
const decks = Array.from({ length: args.players }, (_, i) => DECKS[args.deckOf[i + 1] ?? args.deck])

let dumped = false
try {
    playGame(args.seed, decks, gameState => {
        if (gameState.turnNumber < args.turn || gameState.turnPhase != TurnPhase.Minion || dumped) {
            return
        }
        dumped = true
        console.log(`Turn ${gameState.turnNumber}, phase ${gameState.turnPhase}, seed ${args.seed}`)
        for (const player of gameState.competingPlayers) {
            const view = createPlayerView(gameState, player)
            try {
                console.log(`\n=== The table as ${player.name} sees it`)
                console.log(describeAssessment(assess(view.gameState, view.player)).join('\n'))
            } finally {
                view.dispose()
            }
        }
        throw new HarnessFailure('dumped')
    })
} catch (error) {
    if (!(error instanceof HarnessFailure && error.message.startsWith('dumped'))) {
        throw error
    }
}
if (!dumped) {
    console.log(`The game ended before turn ${args.turn}`)
}
