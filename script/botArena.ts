// The combat arena: the plan of a combat ( src/shared/bot/utility/combatPlan.ts ) against the default policy and
// against a policy with other values and against a side that only strikes with its hands, on the random combats of combatFixtures.ts.
//   npx tsx script/botArena.ts [--combats N] [--seed N] [--samples N] [--caution X] [--depth N] [--print N] [--known] [--check]
// Every combat is played twice for each pair of arms, each arm once as the acting minion and once as the
// defending one. The edge of an arm is what its opponent lost, less what it lost ( pool, by the weights of the
// profile: blood, torpor, retainers, cards ), averaged over the games. The planner does not see the hand of the
// other side: it believes one from the disciplines of the minion, as the bot does at a table. The policy and the
// strikes-only arm play with the real hands ( --known gives them to the planner too, to see what the doubt costs ).
import { deleteGameState } from '@/shared/registries.ts'
import { profileMinion } from '@/shared/bot/utility/minionProfile.ts'
import { roleDensities } from '@/shared/bot/utility/capabilities.ts'
import { applyMove, CombatSim, legalMoves, Move, Side } from '@/shared/bot/utility/combatModel.ts'
import { chooseMove } from '@/shared/bot/utility/combatPolicy.ts'
import {
    costSince,
    describeMove,
    planCombat,
    planWeightsOf,
} from '@/shared/bot/utility/combatPlan.ts'
import { DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { Combat, createCombat, initCombatFixtures, seededRandom } from './combatFixtures.ts'

type Arm = 'planner' | 'policy' | 'rival' | 'strikes'

const PAIRS: [Arm, Arm][] = [
    ['planner', 'policy'],
    ['planner', 'rival'],
    ['planner', 'strikes'],
    ['policy', 'strikes'],
]

function parseArgs(argv: string[]) {
    const args = {
        combats: 60,
        seed: 1,
        samples: 0,
        caution: -1,
        depth: -1,
        print: 0,
        known: false,
        check: false,
    }
    for (let i = 0; i < argv.length; i++) {
        const value = Number(argv[i + 1])
        if (argv[i] == '--known') {
            args.known = true
            continue
        }
        if (argv[i] == '--check') {
            args.check = true
            continue
        }
        if (argv[i] == '--combats') {
            args.combats = value
        } else if (argv[i] == '--seed') {
            args.seed = value
        } else if (argv[i] == '--samples') {
            args.samples = value
        } else if (argv[i] == '--caution') {
            args.caution = value
        } else if (argv[i] == '--depth') {
            args.depth = value
        } else if (argv[i] == '--print') {
            args.print = value
        } else {
            continue
        }
        i++
    }
    return args
}

const args = parseArgs(process.argv.slice(2))
const profile = {
    ...DEFAULT_PROFILE,
    combat: {
        ...DEFAULT_PROFILE.combat,
        samples: args.samples > 0 ? args.samples : DEFAULT_PROFILE.combat.samples,
        caution: args.caution >= 0 ? args.caution : DEFAULT_PROFILE.combat.caution,
        planDepth: args.depth >= 0 ? args.depth : DEFAULT_PROFILE.combat.planDepth,
    },
}
const weights = planWeightsOf(profile)
// A policy that values the outcomes of a fight otherwise than the planner assumes: blood twice as dear, torpor
// cheap, retainers dear, cards dear
const RIVAL = {
    loss: { blood: weights.policy.loss.blood * 2, torporShare: 0.2, retainer: 3 },
    card: 0.6,
}

const opposite = (side: Side): Side => (side == 'acting' ? 'defending' : 'acting')

function strikesOnly(sim: CombatSim): Move {
    const moves = legalMoves(sim)
    return (
        moves.find(move => move.type == 'strike' && move.strike.isHand) ??
        moves.find(move => move.type == 'pass') ??
        moves[0]
    )
}

// What a Methuselah can know of the other minion's hand: its size and the roles its disciplines give
function beliefOf(combat: Combat, sim: CombatSim, other: Side) {
    const fighter = combat.fighters[other]
    const minion = profileMinion(fighter.minion)
    return {
        minion,
        hand: {
            size: Math.max(0, fighter.handAtStart - sim[other].spent),
            densities: roleDensities(
                [minion.disciplines],
                {},
                profile.opponentPrior,
                minion.title ? [minion.title] : [],
            ),
        },
    }
}

let plannerMoves = 0
let plannerSeconds = 0

function moveOf(arm: Arm, combat: Combat, sim: CombatSim): Move {
    switch (arm) {
        case 'planner': {
            const started = performance.now()
            const move = planCombat(
                profile,
                sim,
                args.known ? undefined : beliefOf(combat, sim, opposite(sim.impulsePlayer)),
            ).move
            plannerSeconds += (performance.now() - started) / 1000
            plannerMoves++
            return move
        }
        case 'policy':
            return chooseMove(weights.policy, sim)
        case 'rival':
            return chooseMove(RIVAL, sim)
        case 'strikes':
            return strikesOnly(sim)
    }
}

type Result = {
    // What the arm lost, in pool, less what its opponent did ( negative: it lost less )
    edge: number
    torpor: number
    burned: number
    cards: number
}

function play(combat: Combat, arms: Record<Side, Arm>, print: boolean): Record<Side, Result> {
    const start = combat.sim
    let sim = start
    for (let moves = 0; !sim.closed && moves < 400; moves++) {
        const arm = arms[sim.impulsePlayer]
        const move = moveOf(arm, combat, sim)
        if (print && move.type != 'pass') {
            console.log(`    ${sim.impulsePlayer} (${arm}): ${describeMove(sim, move)}`)
        }
        sim = applyMove(sim, move).sim
    }
    const result = (side: Side): Result => ({
        edge:
            costSince({ ...weights, credit: 1 }, start, sim, opposite(side)) -
            costSince({ ...weights, credit: 1 }, start, sim, side),
        torpor: sim[side].state == 'torpor' ? 1 : 0,
        burned: sim[side].state == 'burned' ? 1 : 0,
        cards: sim[side].spent,
    })
    return { acting: result('acting'), defending: result('defending') }
}

const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length

function standardError(values: number[]): number {
    const average = mean(values)
    const variance = values.reduce((total, value) => total + (value - average) ** 2, 0)
    return Math.sqrt(variance / Math.max(1, values.length - 1) / values.length)
}

await initCombatFixtures()
const results = new Map<string, Result[]>()
const started = performance.now()
for (let k = 0; k < args.combats; k++) {
    Math.random = seededRandom(args.seed + k)
    const combat = createCombat()
    try {
        for (const [first, second] of PAIRS) {
            for (const swapped of [false, true]) {
                const arms: Record<Side, Arm> =
                    swapped ?
                        { acting: second, defending: first }
                    :   { acting: first, defending: second }
                const print = k < args.print
                if (print) {
                    console.log(`  combat ${k}: ${arms.acting} acts, ${arms.defending} defends`)
                }
                const played = play(combat, arms, print)
                const mine = swapped ? played.defending : played.acting
                const theirs = swapped ? played.acting : played.defending
                results.set(`${first} vs ${second}`, [
                    ...(results.get(`${first} vs ${second}`) ?? []),
                    mine,
                ])
                results.set(`${second} vs ${first}`, [
                    ...(results.get(`${second} vs ${first}`) ?? []),
                    theirs,
                ])
            }
        }
    } finally {
        deleteGameState(combat.gameState.gameId)
    }
}

const pct = (values: number[]) => `${Math.round(mean(values) * 100)} %`
for (const [first, second] of PAIRS) {
    const mine = results.get(`${first} vs ${second}`) ?? []
    const theirs = results.get(`${second} vs ${first}`) ?? []
    const edges = mine.map(result => result.edge)
    console.log(
        `${first.padEnd(8)} vs ${second.padEnd(8)} edge ${mean(edges) >= 0 ? '+' : ''}${mean(edges).toFixed(2)} ` +
            `(+-${standardError(edges).toFixed(2)}, ${mine.length} games) | ` +
            `${first}: torpor ${pct(mine.map(result => result.torpor))}, burned ${pct(mine.map(result => result.burned))}, ` +
            `cards ${mean(mine.map(result => result.cards)).toFixed(2)} | ` +
            `${second}: torpor ${pct(theirs.map(result => result.torpor))}, burned ${pct(theirs.map(result => result.burned))}, ` +
            `cards ${mean(theirs.map(result => result.cards)).toFixed(2)}`,
    )
}
const seconds = ((performance.now() - started) / 1000).toFixed(1)
console.log(
    `${args.combats} combats, ${seconds}s (seed ${args.seed}, samples ${profile.combat.samples}, caution ${profile.combat.caution}, depth ${profile.combat.planDepth}), ` +
        `the planner took ${plannerMoves} decisions, ${((plannerSeconds / Math.max(1, plannerMoves)) * 1000).toFixed(1)} ms each`,
)
// The plan must win against both policies, or something broke
const losing = PAIRS.filter(
    ([first, second]) =>
        first == 'planner' &&
        second != 'strikes' &&
        mean((results.get(`${first} vs ${second}`) ?? []).map(result => result.edge)) <= 0,
)
if (args.check && losing.length > 0) {
    console.error(
        `The planner does not win against ${losing.map(([, second]) => second).join(', ')}`,
    )
    process.exit(1)
}
process.exit(0)
