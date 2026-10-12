// Differential check of the combat model ( src/shared/bot/utility/combatModel.ts ) against the engine.
//   npx tsx script/botCombat.ts [--combats N] [--seed N] [--trace]
// Each combat is built at random in the engine ( vampires with disciplines and blood, attached weapons and
// retainers, a hand of combat cards, a pool ), and described to the model from the same minions and cards.
// Then, at every decision of the combat: the model offers the same moves as the referee, a random one is
// played in both, and the two states are equal ( step, range, impulse, blood, pending damage, strikes, state
// of the minions, life of the retainers, pool, cards played ). The first difference stops the run and prints
// the moves of the combat. Every random pick is seeded ( combat k is drawn from the seed N + k ).
import { readFileSync } from 'node:fs'
import { Card, LibraryCard, Minion, Vampire } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { deleteGameState, registerLogger, setGameResources } from '@/shared/registries.ts'
import { initWasmHasher } from '@/shared/hashing.ts'
import { createCombatState } from '@/shared/state/combatState.ts'
import { getAttachedCards } from '@/shared/state/attachments.ts'
import { getAttachedEffects, isRetainer } from '@/shared/cardImpl/catalog/attached.ts'
import { BrujahDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { CombatStrike, DisciplineUse } from '@/shared/types/state.ts'
import { Discipline } from '@/shared/const/model.ts'
import { applyOption, getDecidingPlayer, getDecisionPoint } from '@/shared/bot/referee.ts'
import { BotOption, DecisionKind } from '@/shared/bot/types.ts'
import { profileMinion } from '@/shared/bot/utility/minionProfile.ts'
import {
    applyMove,
    CombatSim,
    legalMoves,
    Move,
    Side,
    SimCombatant,
} from '@/shared/bot/utility/combatModel.ts'
import { CardFacts, combatOf } from '@/shared/bot/utility/combatSetup.ts'
import { BEHIND_YOU_ID } from '@/shared/cardImpl/cardIds.ts'
import { createHeadlessGame, registerSyncMutationTrigger } from './harness.ts'

const COMBAT_CARDS = [
    '100301', // Carrion Crows
    '100597', // Dust Up
    '100959', // Immortal Grapple
    '101523', // Pursuit
    '101532', // Quickness
    '101798', // Slam
    '101945', // Taste of Vitae
    '101993', // Torn Signpost
    '102215', // Roundhouse
]

const MAGNUM = '100001'
const RAVEN_SPY = '101550'
const MURDER_OF_CROWS = '101254'
const GUARDIAN_ANGEL = '100866'
const HEROIC_MIGHT = '100913'

const CombatDeck = <DeckList>{
    ...BrujahDeck,
    [BEHIND_YOU_ID]: 4,
    [MAGNUM]: 4,
    [RAVEN_SPY]: 4,
    [MURDER_OF_CROWS]: 4,
    [GUARDIAN_ANGEL]: 4,
    [HEROIC_MIGHT]: 4,
    '100301': 4,
}

class Difference extends Error {}

// What the combats went through, to see that the rules were exercised
const coverage = new Map<string, number>()
const count = (what: string) => coverage.set(what, (coverage.get(what) ?? 0) + 1)

// mulberry32: a small seeded generator, replaces Math.random so a failing combat can be replayed
function seededRandom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)]
const between = (low: number, high: number) => low + Math.floor(Math.random() * (high - low + 1))

/**
 * Building a combat
 */

type Fighter = {
    side: Side
    player: Player
    minion: Vampire
    // The attached cards at the start, in the order the model knows them
    attached: Card[]
    handAtStart: number
}

function takeCard(player: Player, krcgId: string): LibraryCard {
    const card = [...player.library.cards, ...player.hand.cards].find(
        candidate => candidate.krcgId == krcgId,
    )
    if (!(card instanceof LibraryCard)) {
        throw new Difference(`The card ${krcgId} is not in the deck`)
    }
    return card
}

function randomDisciplines(): Disciplines {
    const disciplines = {} as Disciplines
    for (const discipline of [
        Discipline.Potence,
        Discipline.Celerity,
        Discipline.Animalism,
        Discipline.Obfuscate,
    ]) {
        const level = between(0, 2)
        if (level > 0) {
            disciplines[discipline] = level
        }
    }
    return disciplines
}

function attach(card: LibraryCard, minion: Minion, disciplines?: DisciplineUse[]): void {
    const player = minion.controller
    player.gameState.moveCardToRegion(card, player.ready)
    const validity = botMutations.attachCard.act(player, { card, minion, disciplines })
    if (!validity.isValid) {
        throw new Difference(`Cannot attach ${card.name}: ${validity.reason}`)
    }
    // The life counters come with the action that attaches the card
    card.blood = getAttachedEffects(card).reduce(
        (total, effect) => total + (effect.type == 'life' ? effect.amount : 0),
        0,
    )
}

function equip(minion: Vampire): void {
    const player = minion.controller
    const level = (discipline: Discipline) => minion.minionAttrs.disciplines[discipline] ?? 0
    if (Math.random() < 0.4) {
        attach(takeCard(player, MAGNUM), minion)
    }
    if (Math.random() < 0.3) {
        attach(takeCard(player, GUARDIAN_ANGEL), minion)
    }
    for (const id of [RAVEN_SPY, MURDER_OF_CROWS]) {
        const animalism = level(Discipline.Animalism)
        if (animalism > 0 && Math.random() < 0.4) {
            const card = takeCard(player, id)
            attach(card, minion, [{ discipline: Discipline.Animalism, level: animalism }])
        }
    }
    const potence = level(Discipline.Potence)
    if (potence > 0 && Math.random() < 0.3) {
        attach(takeCard(player, HEROIC_MIGHT), minion, [
            { discipline: Discipline.Potence, level: potence },
        ])
    }
}

function emptyHand(gameState: GameState, player: Player): void {
    for (const card of [...player.hand.cards]) {
        gameState.moveCardToRegion(card, player.library)
    }
}

// The library is out of reach: a bot draws back up to its hand size after each card it plays
function sealLibrary(gameState: GameState, player: Player): void {
    for (const card of [...player.library.cards]) {
        gameState.moveCardToRegion(card, player.removed)
    }
}

function setUpFighter(gameState: GameState, player: Player, side: Side): Fighter {
    const minion = player.vampiresInUncontrolled[0]
    gameState.moveCardToRegion(minion, player.ready)
    minion.blood = between(1, 8)
    minion.minionAttrs.capacity = 10
    minion.minionAttrs.strength = between(1, 2)
    minion.minionAttrs.disciplines = randomDisciplines()
    equip(minion)
    emptyHand(gameState, player)
    for (let i = between(1, 6); i > 0; i--) {
        const id = Math.random() < 0.2 ? BEHIND_YOU_ID : pick(COMBAT_CARDS)
        const card = [...player.library.cards].find(candidate => candidate.krcgId == id)
        if (card) {
            gameState.moveCardToRegion(card, player.hand)
        }
    }
    sealLibrary(gameState, player)
    player.pool = between(2, 12)
    return {
        side,
        player,
        minion,
        attached: getAttachedCards(minion),
        handAtStart: player.hand.length,
    }
}

function factsOf(card: LibraryCard): CardFacts {
    return {
        krcgId: card.krcgId,
        name: card.name,
        type: card.type,
        clan: card.clan,
        requirement: card.requirement,
        bloodCost: card.bloodCost,
        poolCost: card.poolCost,
    }
}

type Combat = { gameState: GameState; fighters: Record<Side, Fighter>; sim: CombatSim }

function createCombat(): Combat {
    const { gameState, players } = createHeadlessGame([CombatDeck, CombatDeck])
    const acting = setUpFighter(gameState, players[0], 'acting')
    const defending = setUpFighter(gameState, players[1], 'defending')
    gameState.combat = createCombatState(acting.minion, defending.minion)
    const strengthBonus = between(0, 2)
    const freeManeuvers = between(0, 1)
    gameState.combat.acting.strengthBonus = strengthBonus
    gameState.combat.defending.freeManeuvers = freeManeuvers
    const setupOf = (fighter: Fighter, extra: object) => ({
        profile: profileMinion(fighter.minion),
        pool: fighter.player.pool,
        hand: fighter.player.hand.cards.flatMap(card =>
            card instanceof LibraryCard ? [factsOf(card)] : [],
        ),
        ...extra,
    })
    const sim = combatOf(setupOf(acting, { strengthBonus }), setupOf(defending, { freeManeuvers }))
    return { gameState, fighters: { acting, defending }, sim }
}

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
        // Mostly something else than a pass, or the combats would stay at their first round
        const active = options.filter(({ key }) => key != 'pass')
        const chosen = pick(active.length > 0 && Math.random() < 0.8 ? active : options)
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

registerLogger({
    captureException: error => console.error(error),
    captureMessage: message => console.warn(message),
})
await initWasmHasher()
setGameResources('cardbase', JSON.parse(readFileSync('public/assets/cardbase.json', 'utf-8')))
registerSyncMutationTrigger()

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
