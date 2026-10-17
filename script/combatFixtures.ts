// The combats that the checks of the combat model and the arena are played on: random minions in the engine
// ( vampires with disciplines and blood, attached weapons and retainers, a hand of combat cards, a pool ), and the
// model combat described from the same minions and cards.
import { readFileSync } from 'node:fs'
import { Card, LibraryCard, Minion, Vampire } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { registerLogger, setGameResources } from '@/shared/registries.ts'
import { initWasmHasher } from '@/shared/hashing.ts'
import { createCombatState } from '@/shared/state/combatState.ts'
import { getAttachedCards } from '@/shared/state/attachments.ts'
import { getAttachedEffects } from '@/shared/cardImpl/catalog/attached.ts'
import { BrujahDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { DisciplineUse } from '@/shared/types/state.ts'
import { Discipline } from '@/shared/const/model.ts'
import { profileMinion } from '@/shared/bot/utility/minionProfile.ts'
import { CombatSim, Side } from '@/shared/bot/utility/combatModel.ts'
import { cardFactsOf, combatOf } from '@/shared/bot/utility/combatSetup.ts'
import { createHeadlessGame, registerSyncMutationTrigger } from './harness.ts'
import {
    BEHIND_YOU_ID,
    GUARDIAN_ANGEL_ID,
    HEROIC_MIGHT_ID,
    MAGNUM_ID,
    MURDER_OF_CROWS_ID,
    RAVEN_SPY_ID,
} from './cardIds.ts'

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

const CombatDeck = <DeckList>{
    ...BrujahDeck,
    [BEHIND_YOU_ID]: 4,
    [MAGNUM_ID]: 4,
    [RAVEN_SPY_ID]: 4,
    [MURDER_OF_CROWS_ID]: 4,
    [GUARDIAN_ANGEL_ID]: 4,
    [HEROIC_MIGHT_ID]: 4,
    '100301': 4,
}

export class Difference extends Error {}

// mulberry32: a small seeded generator, replaces Math.random so a failing combat can be replayed
export function seededRandom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)]
export const between = (low: number, high: number) =>
    low + Math.floor(Math.random() * (high - low + 1))

/**
 * Building a combat
 */

export type Fighter = {
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
        attach(takeCard(player, MAGNUM_ID), minion)
    }
    if (Math.random() < 0.3) {
        attach(takeCard(player, GUARDIAN_ANGEL_ID), minion)
    }
    for (const id of [RAVEN_SPY_ID, MURDER_OF_CROWS_ID]) {
        const animalism = level(Discipline.Animalism)
        if (animalism > 0 && Math.random() < 0.4) {
            const card = takeCard(player, id)
            attach(card, minion, [{ discipline: Discipline.Animalism, level: animalism }])
        }
    }
    const potence = level(Discipline.Potence)
    if (potence > 0 && Math.random() < 0.3) {
        attach(takeCard(player, HEROIC_MIGHT_ID), minion, [
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

export type Combat = { gameState: GameState; fighters: Record<Side, Fighter>; sim: CombatSim }

export function createCombat(): Combat {
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
            card instanceof LibraryCard ? [cardFactsOf(card)] : [],
        ),
        ...extra,
    })
    const sim = combatOf(setupOf(acting, { strengthBonus }), setupOf(defending, { freeManeuvers }))
    return { gameState, fighters: { acting, defending }, sim }
}

// The logger, the card base and the mutation trigger a combat in the engine needs
export async function initCombatFixtures(): Promise<void> {
    registerLogger({
        captureException: error => console.error(error),
        captureMessage: message => console.warn(message),
    })
    await initWasmHasher()
    setGameResources('cardbase', JSON.parse(readFileSync('public/assets/cardbase.json', 'utf-8')))
    registerSyncMutationTrigger()
}
