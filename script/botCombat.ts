// Differential check of the combat model ( src/shared/bot/utility/combatModel.ts ) against the engine.
//   npx tsx script/botCombat.ts [--combats N] [--seed N] [--trace]
// Each combat is built at random in the engine ( vampires with disciplines and blood, attached weapons and
// retainers, a hand of combat cards, a pool ), and described to the model from the same minions and cards.
// Then, at every decision of the combat: the model offers the same moves as the referee, a random one is
// played in both, and the two states are equal ( step, range, impulse, blood, pending damage, strikes, state
// of the minions, life of the retainers, pool, cards played ). The first difference stops the run and prints
// the moves of the combat. Every random pick is seeded ( combat k is drawn from the seed N + k ).
import { LibraryCard, Minion } from '@/shared/model/Card.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { deleteGameState } from '@/shared/registries.ts'
import { isRetainer } from '@/shared/cardImpl/catalog/attached.ts'
import { applyOption, getDecidingPlayer, getDecisionPoint } from '@/shared/bot/referee.ts'
import { BotOption, DecisionKind } from '@/shared/bot/types.ts'
import {
    applyMove,
    CombatSim,
    legalMoves,
    Side,
    SimCombatant,
} from '@/shared/bot/utility/combatModel.ts'
import {
    combatCardsOf,
    simStrikeKey,
    strikeKey,
    moveKey,
    optionKey,
    optionOfMove,
    simOfCombat,
} from '@/shared/bot/utility/combatBridge.ts'
import { cardFactsOf } from '@/shared/bot/utility/combatSetup.ts'
import { chooseMove } from '@/shared/bot/utility/combatPolicy.ts'
import { planCombat } from '@/shared/bot/utility/combatPlan.ts'
import { profileMinion } from '@/shared/bot/utility/minionProfile.ts'
import { policyWeightsOf } from '@/shared/bot/utility/combatPosition.ts'
import { DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import {
    Combat,
    createCombat,
    Difference,
    initCombatFixtures,
    pick,
    seededRandom,
} from './combatFixtures.ts'

const POLICY_WEIGHTS = policyWeightsOf(DEFAULT_PROFILE)
const BELIEVED_DENSITIES = { strike: 0.3, dodge: 0.2, maneuver: 0.2, additionalStrike: 0.1 }

// What the combats went through, to see that the rules were exercised
const coverage = new Map<string, number>()
const count = (what: string) => coverage.set(what, (coverage.get(what) ?? 0) + 1)

/**
 * Comparing the states
 */

function regionOf(minion: Minion): string {
    return (
        minion.isIn.torpor ? 'torpor'
        : minion.isIn.ashHeap ? 'ashHeap'
        : 'ready'
    )
}

function engineSnapshot(combat: Combat, side: Side): object {
    const { gameState, fighters } = combat
    const fighter = fighters[side]
    const opposing = fighters[side == 'acting' ? 'defending' : 'acting']
    const engine = gameState.combat
    const combatant = engine?.[side]
    const strike = combatant?.strike
    return {
        blood: fighter.minion.blood,
        region: regionOf(fighter.minion),
        pool: fighter.player.pool,
        spent: fighter.handAtStart - fighter.player.hand.length,
        life: fighter.attached.map(card => (isRetainer(card) ? Math.max(0, card.blood) : 0)),
        combatant:
            combatant ?
                {
                    strength: combatant.strength,
                    strike: strike ? strikeKey(strike, opposing.attached) : null,
                    pending: [combatant.pendingDamage.regular, combatant.pendingDamage.aggravated],
                    bloodLost: combatant.bloodLost,
                    additionalStrikes: combatant.additionalStrikes,
                    limited: combatant.limitedAdditionalGained,
                    inPair: combatant.strikesInPair,
                    presses: combatant.pressesGranted,
                    bonus: combatant.strengthBonus,
                    free: combatant.freeManeuvers,
                    environmental: combatant.environmentalDamage,
                    played: [
                        engine?.playedThisRound[fighter.minion.oid] ?? [],
                        engine?.playedThisCombat[fighter.minion.oid] ?? [],
                    ],
                }
            :   null,
    }
}

function simSnapshot(sim: CombatSim, side: Side): object {
    const combatant = sim[side]
    const strike = combatant.strike
    return {
        blood: combatant.blood,
        region: combatant.state == 'burned' ? 'ashHeap' : combatant.state,
        pool: combatant.pool,
        spent: combatant.spent,
        life: combatant.attached.map(card => (card.retainer ? Math.max(0, card.life) : 0)),
        combatant:
            sim.closed ? null : (
                {
                    strength: combatant.strength,
                    strike:
                        strike ? simStrikeKey({ ...strike, retainer: retainerOf(strike) }) : null,
                    pending: [combatant.pendingDamage.regular, combatant.pendingDamage.aggravated],
                    bloodLost: combatant.bloodLost,
                    additionalStrikes: combatant.additionalStrikes,
                    limited: combatant.limitedAdditionalGained,
                    inPair: combatant.strikesInPair,
                    presses: combatant.pressesGranted,
                    bonus: combatant.strengthBonus,
                    free: combatant.freeManeuvers,
                    environmental: combatant.environmentalDamage,
                    played: [sim.playedThisRound[side] ?? [], sim.playedThisCombat[side] ?? []],
                }
            ),
    }
}

function retainerOf(strike: NonNullable<SimCombatant['strike']>): number | undefined {
    return typeof strike.retainer == 'number' ? strike.retainer : undefined
}

function combatSnapshot(combat: Combat, simSide: boolean): object | null {
    const engine = combat.gameState.combat
    const sim = combat.sim
    if (simSide ? sim.closed : !engine) {
        return null
    }
    const state = simSide ? sim : engine
    if (!state) {
        return null
    }
    return {
        round: state.round,
        step: state.step,
        range: state.range,
        impulse:
            simSide ? sim.impulsePlayer
            : engine?.impulsePlayer == combat.fighters.acting.player ? 'acting'
            : 'defending',
        pressed: state.pressed,
        tier: state.resolvedStrikeTier,
        pair: state.strikePair,
        handOnly: state.handStrikesOnly,
        closeNext: state.closeNextRound,
        environmentalApplied: state.environmentalApplied,
        isOver: state.isOver,
        weaponManeuvers: state.weaponManeuvers.length,
        preventions: state.attachedPreventions.length,
    }
}

function lastPlayerOf(combat: Combat): Side | null {
    const engine = combat.gameState.combat
    if (!engine?.lastPlayedBy) {
        return null
    }
    return engine.lastPlayedBy == combat.fighters.acting.player ? 'acting' : 'defending'
}

function compare(combat: Combat, history: string[]): void {
    const engineClosed = !combat.gameState.combat
    const problems: string[] = []
    if (engineClosed != combat.sim.closed) {
        problems.push(`closed: engine ${engineClosed}, model ${combat.sim.closed}`)
    }
    const check = (what: string, engine: unknown, model: unknown) => {
        if (JSON.stringify(engine) != JSON.stringify(model)) {
            problems.push(
                `${what}\n    engine ${JSON.stringify(engine)}\n    model  ${JSON.stringify(model)}`,
            )
        }
    }
    check('combat', combatSnapshot(combat, false), combatSnapshot(combat, true))
    check('last played', lastPlayerOf(combat), combat.sim.closed ? null : combat.sim.lastPlayedBy)
    for (const side of ['acting', 'defending'] as const) {
        check(side, engineSnapshot(combat, side), simSnapshot(combat.sim, side))
    }
    if (problems.length > 0) {
        throw new Difference(
            `${problems.join('\n  ')}\n  moves so far:\n    ${history.join('\n    ')}`,
        )
    }
}

/**
 * The combat read from the engine: the model built from the state of the engine at any point of the combat
 * ( what the agent does ) must be the model that was played from its start
 */

function projection(sim: CombatSim) {
    const side = (combatant: SimCombatant) => ({
        strength: combatant.strength,
        blood: combatant.blood,
        state: combatant.state,
        pool: combatant.pool,
        strike: combatant.strike?.name ?? null,
        pending: [combatant.pendingDamage.regular, combatant.pendingDamage.aggravated],
        bloodLost: combatant.bloodLost,
        additionalStrikes: combatant.additionalStrikes,
        limited: combatant.limitedAdditionalGained,
        inPair: combatant.strikesInPair,
        presses: combatant.pressesGranted,
        bonus: combatant.strengthBonus,
        free: combatant.freeManeuvers,
        environmental: combatant.environmentalDamage,
        life: combatant.attached.reduce(
            (total, card) => total + (card.retainer ? Math.max(0, card.life) : 0),
            0,
        ),
    })
    return {
        round: sim.round,
        step: sim.step,
        range: sim.range,
        impulse: sim.impulsePlayer,
        last: sim.lastPlayedBy,
        pressed: sim.pressed,
        tier: sim.resolvedStrikeTier,
        pair: sim.strikePair,
        handOnly: sim.handStrikesOnly,
        closeNext: sim.closeNextRound,
        environmentalApplied: sim.environmentalApplied,
        isOver: sim.isOver,
        weaponManeuvers: sim.weaponManeuvers.length,
        preventions: sim.attachedPreventions.length,
        played: [sim.playedThisRound, sim.playedThisCombat].map(record => [
            record.acting ?? [],
            record.defending ?? [],
        ]),
        acting: side(sim.acting),
        defending: side(sim.defending),
    }
}

// The model read from the engine, with the real hands of both sides: it must hold what the model played from
// the start holds, and offer the moves that the referee offers
function readCheck(combat: Combat, options: BotOption[], history: string[]) {
    const engine = combat.gameState.combat
    if (!engine) {
        throw new Difference('No combat to read')
    }
    const sim = simOfCombat(engine, player =>
        player.hand.cards.flatMap(card => (card instanceof LibraryCard ? [cardFactsOf(card)] : [])),
    )
    const cards = combatCardsOf(engine)
    const problems: string[] = []
    if (JSON.stringify(projection(sim)) != JSON.stringify(projection(combat.sim))) {
        problems.push(
            `the model read\n    read   ${JSON.stringify(projection(sim))}\n    played ${JSON.stringify(projection(combat.sim))}`,
        )
    }
    const me = sim.impulsePlayer
    const opposing = me == 'acting' ? 'defending' : 'acting'
    const readKeys = [...new Set(legalMoves(sim).map(move => moveKey(move, sim[me])))].sort()
    const referee = [
        ...new Set(options.map(option => optionKey(option, cards[me], cards[opposing]))),
    ].sort()
    if (JSON.stringify(readKeys) != JSON.stringify(referee)) {
        problems.push(
            `the moves of the model read differ\n    only the engine: ${referee.filter(key => !readKeys.includes(key)).join(' ; ')}\n    only the model: ${readKeys.filter(key => !referee.includes(key)).join(' ; ')}`,
        )
    }
    if (problems.length > 0) {
        throw new Difference(
            `${problems.join('\n  ')}\n  moves so far:\n    ${history.join('\n    ')}`,
        )
    }
    count('read')
    return { sim, cards }
}

/**
 * Playing a combat
 */

function playCombat(combat: Combat, trace: boolean): number {
    const history: string[] = []
    compare(combat, history)
    let moves = 0
    while (combat.gameState.combat) {
        if (moves++ > 400) {
            throw new Difference(`The combat does not end\n    ${history.join('\n    ')}`)
        }
        const player = getDecidingPlayer(combat.gameState)
        const side: Side = player == combat.fighters.acting.player ? 'acting' : 'defending'
        if (!player || player != combat.gameState.combat.impulsePlayer) {
            throw new Difference('The referee asks someone else than the impulse player')
        }
        const decision = getDecisionPoint(combat.gameState, player)
        if (!decision || decision.kind != DecisionKind.Combat) {
            throw new Difference(`The decision is ${decision?.kind}, not a combat one`)
        }
        const mine = combat.fighters[side]
        const opposing = combat.fighters[side == 'acting' ? 'defending' : 'acting']
        const options = decision.options.map(option => ({
            option,
            key: optionKey(option, mine.attached, opposing.attached),
        }))
        const me = combat.sim[combat.sim.impulsePlayer]
        const modelMoves = legalMoves(combat.sim).map(move => ({ move, key: moveKey(move, me) }))
        const engineKeys = [...new Set(options.map(({ key }) => key))].sort()
        const modelKeys = [...new Set(modelMoves.map(({ key }) => key))].sort()
        if (JSON.stringify(engineKeys) != JSON.stringify(modelKeys)) {
            throw new Difference(
                `The moves differ for the ${side} minion in ${combat.gameState.combat.step}\n` +
                    `    only the engine: ${engineKeys.filter(key => !modelKeys.includes(key)).join(' ; ')}\n` +
                    `    only the model: ${modelKeys.filter(key => !engineKeys.includes(key)).join(' ; ')}\n` +
                    `  moves so far:\n    ${history.join('\n    ')}`,
            )
        }
        const read = readCheck(combat, decision.options, history)
        // A third of the time the default policy of the position evaluator chooses, which must be a move of the
        // referee; the rest, mostly something else than a pass, or the combats would stay at their first round
        const active = options.filter(({ key }) => key != 'pass')
        let chosen = pick(active.length > 0 && Math.random() < 0.8 ? active : options)
        if (Math.random() < 0.34) {
            const policyKey = moveKey(chooseMove(POLICY_WEIGHTS, combat.sim), me)
            const policy = options.find(({ key }) => key == policyKey)
            if (!policy) {
                throw new Difference(
                    `The policy chose ${policyKey}, which the referee does not offer`,
                )
            }
            chosen = policy
            count('policy')
        }
        // And a fifth of the time the plan, against a believed hand: also a move of the referee
        if (Math.random() < 0.2) {
            const plan = planCombat(DEFAULT_PROFILE, read.sim, {
                minion: profileMinion(opposing.minion),
                hand: { size: opposing.player.hand.length, densities: BELIEVED_DENSITIES },
            })
            const option = optionOfMove(decision.options, plan.move, read.sim, read.cards)
            const planned = options.find(candidate => candidate.option == option)
            if (!planned) {
                throw new Difference(
                    `The plan chose ${moveKey(plan.move, read.sim[read.sim.impulsePlayer])}, which the referee does not offer`,
                )
            }
            chosen = planned
            count('plan')
        }
        history.push(`${side}: ${chosen.key}`)
        count(chosen.key.split('|')[0])
        if (chosen.key.includes(' at ')) {
            count('strike at a retainer')
        }
        if (trace) {
            console.log(`  ${side}: ${chosen.key}`)
        }
        const match = modelMoves.find(({ key }) => key == chosen.key)
        if (!match) {
            throw new Difference(`No model move for ${chosen.key}`)
        }
        applyOption(decision, chosen.option)
        combat.sim = applyMove(combat.sim, match.move).sim
        compare(combat, history)
    }
    for (const side of ['acting', 'defending'] as const) {
        const { minion, attached } = combat.fighters[side]
        count(`end: ${regionOf(minion)}`)
        count(`rounds: ${Math.min(3, combat.sim.round)}`)
        if (attached.some(card => isRetainer(card) && card.blood <= 0)) {
            count('a retainer burned')
        }
    }
    return moves
}

function parseArgs(argv: string[]) {
    const args = { combats: 300, seed: Math.floor(Math.random() * 1e9), trace: false }
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] == '--combats') {
            args.combats = Number(argv[++i])
        } else if (argv[i] == '--seed') {
            args.seed = Number(argv[++i])
        } else if (argv[i] == '--trace') {
            args.trace = true
        }
    }
    return args
}

await initCombatFixtures()

const args = parseArgs(process.argv.slice(2))
const failures: string[] = []
let totalMoves = 0
const started = Date.now()
for (let k = 0; k < args.combats; k++) {
    Math.random = seededRandom(args.seed + k)
    let gameState: GameState | null = null
    try {
        const combat = createCombat()
        gameState = combat.gameState
        totalMoves += playCombat(combat, args.trace)
    } catch (error) {
        failures.push(
            `combat ${k} (replay with --seed ${args.seed + k} --combats 1 --trace): ${error instanceof Error ? error.message : String(error)}`,
        )
    } finally {
        if (gameState) {
            deleteGameState(gameState.gameId)
        }
    }
}
console.log(
    [...coverage]
        .sort()
        .map(([what, times]) => `${what} ${times}`)
        .join(', '),
)
for (const failure of failures.slice(0, 3)) {
    console.error(failure)
}
const seconds = ((Date.now() - started) / 1000).toFixed(1)
console.log(
    `${args.combats} combats, ${totalMoves} moves compared in ${seconds}s (seed ${args.seed}), ${failures.length} differences`,
)
process.exit(failures.length > 0 ? 1 : 0)
