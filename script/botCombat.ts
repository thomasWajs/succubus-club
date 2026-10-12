// Differential check of the combat model ( src/shared/bot/utility/combatModel.ts ) against the engine.
//   npx tsx script/botCombat.ts [--combats N] [--seed N] [--trace]
// Each combat is built at random in the engine ( vampires with disciplines and blood, attached weapons and
// retainers, a hand of combat cards, a pool ), and described to the model from the same minions and cards.
// Then, at every decision of the combat: the model offers the same moves as the referee, a random one is
// played in both, and the two states are equal ( step, range, impulse, blood, pending damage, strikes, state
// of the minions, life of the retainers, pool, cards played ). The first difference stops the run and prints
// the moves of the combat. Every random pick is seeded ( combat k is drawn from the seed N + k ).
import { Card, Minion } from '@/shared/model/Card.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { deleteGameState } from '@/shared/registries.ts'
import { isRetainer } from '@/shared/cardImpl/catalog/attached.ts'
import { CombatStrike } from '@/shared/types/state.ts'
import { applyOption, getDecidingPlayer, getDecisionPoint } from '@/shared/bot/referee.ts'
import { BotOption, DecisionKind } from '@/shared/bot/types.ts'
import {
    applyMove,
    CombatSim,
    legalMoves,
    Move,
    Side,
    SimCombatant,
} from '@/shared/bot/utility/combatModel.ts'
import { chooseMove } from '@/shared/bot/utility/combatPolicy.ts'
import { planCombat } from '@/shared/bot/utility/combatPlan.ts'
import { profileMinion } from '@/shared/bot/utility/minionProfile.ts'
import { policyWeightsOf } from '@/shared/bot/utility/combatPosition.ts'
import { DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import {
    Combat,
    createCombat,
    Difference,
    Fighter,
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
 * Keys of the moves, to tell whether the two offer the same
 */

function strikeKey(strike: CombatStrike, opposing: Fighter): string {
    const retainer = strike.retainer ? opposing.attached.indexOf(strike.retainer) : -1
    return [
        strike.name,
        strike.damage,
        +strike.aggravated,
        +strike.ranged,
        +strike.dodge,
        +strike.isHand,
        +strike.undodgeable,
        +strike.combatEnds,
        +strike.firstStrike,
        strike.stealBlood,
        retainer,
    ].join(',')
}

function optionKey(option: BotOption, mine: Fighter, opposing: Fighter): string {
    const card = 'card' in option && option.card ? option.card.krcgId : ''
    const index = (attached?: Card) => (attached ? mine.attached.indexOf(attached) : -1)
    switch (option.type) {
        case 'combatPass':
            return 'pass'
        case 'combatStrike':
            return `strike|${strikeKey(option.strike, opposing)}|${option.additional?.limited ?? '-'}|${card}`
        case 'combatManeuver':
            return `maneuver|${option.strike ? strikeKey(option.strike, opposing) : '-'}|${index(option.weapon)}|${!!option.free}|${card}`
        case 'combatPress':
            return `press|${!!option.granted}|${card}`
        case 'combatAdditionalStrike':
            return `additionalStrike|${option.limited}|${card}`
        case 'combatGrapple':
            return `grapple|${option.press}|${option.closeNextRound}|${card}`
        case 'combatGainBlood':
            return `gainBlood|${option.amount}|${card}`
        case 'combatStrengthBonus':
            return 'strengthBonus'
        case 'combatStrength':
            return `strength|${option.amount}|${card}`
        case 'combatEnvironmentalDamage':
            return `environmentalDamage|${option.amount}|${card}`
        case 'combatPrevent':
            return `prevent|${option.amount}|${option.aggravated}|${index(option.source)}|${card}`
        default:
            throw new Difference(`The referee offers ${option.type} in a combat`)
    }
}

function simStrikeKey(strike: NonNullable<Extract<Move, { type: 'strike' }>['strike']>): string {
    return [
        strike.name,
        strike.damage,
        +strike.aggravated,
        +strike.ranged,
        +strike.dodge,
        +strike.isHand,
        +strike.undodgeable,
        +strike.combatEnds,
        +strike.firstStrike,
        strike.stealBlood,
        strike.retainer ?? -1,
    ].join(',')
}

function moveKey(move: Move, me: SimCombatant): string {
    const card = move.card === undefined ? '' : me.cards[move.card].cardId
    const index = (key?: string) => (key === undefined ? -1 : Number(key.split(':')[1]))
    switch (move.type) {
        case 'pass':
            return 'pass'
        case 'strike':
            return `strike|${simStrikeKey(move.strike)}|${move.additional?.limited ?? '-'}|${card}`
        case 'maneuver':
            return `maneuver|${move.strike ? simStrikeKey(move.strike) : '-'}|${index(move.weaponKey)}|${!!move.free}|${card}`
        case 'press':
            return `press|${!!move.granted}|${card}`
        case 'additionalStrike':
            return `additionalStrike|${move.limited}|${card}`
        case 'grapple':
            return `grapple|${move.press}|${move.closeNextRound}|${card}`
        case 'gainBlood':
            return `gainBlood|${move.amount}|${card}`
        case 'strengthBonus':
            return 'strengthBonus'
        case 'strength':
            return `strength|${move.amount}|${card}`
        case 'environmentalDamage':
            return `environmentalDamage|${move.amount}|${card}`
        case 'prevent':
            return `prevent|${move.amount}|${move.aggravated}|${index(move.sourceKey)}|${card}`
    }
}

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
                    strike: strike ? strikeKey(strike, opposing) : null,
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
            key: optionKey(option, mine, opposing),
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
        // And a fifth of the time the plan of 3.4c, against a believed hand: also a move of the referee
        if (Math.random() < 0.2) {
            const other = combat.sim[combat.sim.impulsePlayer == 'acting' ? 'defending' : 'acting']
            const plan = planCombat(DEFAULT_PROFILE, combat.sim, {
                minion: profileMinion(opposing.minion),
                hand: { size: other.cards.length, densities: BELIEVED_DENSITIES },
            })
            const planKey = moveKey(plan.move, me)
            const planned = options.find(({ key }) => key == planKey)
            if (!planned) {
                throw new Difference(`The plan chose ${planKey}, which the referee does not offer`)
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
