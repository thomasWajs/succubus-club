import { Vampire, LibraryCard, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { Discipline, DisciplineLevel, OUST_POOL_GAIN } from '@/shared/const/model.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { getMinionStrength, getMinionIntercept } from '@/shared/cardImpl/catalog/attached.ts'
import { createPlayerView } from '@/shared/bot/playerView.ts'
import { createHeadlessGame } from '../harness.ts'
import { AttachDeck } from '../attachDeck.ts'
import { GovernDeck, MalkavDeck, BrujahDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { BotProfile, DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { profileMinion } from '@/shared/bot/utility/minionProfile.ts'
import { Fighter, forecastFight } from '@/shared/bot/utility/combatPosition.ts'
import {
    attackKitOf,
    densitiesOf,
    idleActorsOf,
    interceptShare,
} from '@/shared/bot/utility/defence.ts'
import {
    takeSnapshot,
    canBounce,
    isRoleLive,
    bounceTargetOf,
} from '@/shared/bot/utility/snapshot.ts'
import { roleDensities } from '@/shared/bot/utility/capabilities.ts'
import { opponentModelOf } from '@/shared/bot/utility/opponentModel.ts'
import { createLedger, getPlayerLedger, PlayerLedger } from '@/shared/bot/utility/ledger.ts'
import { binomial, exact } from '@/shared/bot/utility/attack.ts'
import {
    Assessment,
    assess,
    chanceOfOust,
    survivalCurve,
    outcomeOfTurn,
} from '@/shared/bot/utility/assessment.ts'
import { describeAssessment } from '@/shared/bot/utility/describeAssessment.ts'
import {
    Scenario,
    ScenarioFailure,
    attachInPlay,
    createdGames,
    expectEqual,
    giveCard,
    readySpecific,
    readyVampire,
} from './helpers.ts'
import { emptyHand } from './bounce.ts'
import { SPY_INFERIOR, findAnyCard } from './attachment.ts'
import { LABYRINTH_DECK } from './labyrinth.ts'
import { KRCG_DECK } from './krcg.ts'
import {
    DEFLECTION_ID,
    GUARDIAN_ANGEL_ID,
    KRCG_ID,
    LABYRINTH_ID,
    LENNY_ID,
    LOST_IN_CROWDS_ID,
    MAGNUM_ID,
    ORGANIZED_RESISTANCE_ID,
    PRETERNATURAL_ID,
    QUI_VIVE_ID,
    RAVEN_SPY_ID,
} from '../cardIds.ts'

/**
 * Table assessment: the effective minion, the snapshot of the table as a
 * player sees it, the lunge of the predator on a pool, the opportunity on the prey, the stakes of each
 * Methuselah. The vampires of these scenarios have no discipline, so the table shows no evidence and
 * what the others hold is the neutral prior: the numbers can be worked out by hand.
 */

export type Ring = { gameState: GameState; players: Player[] }

// The players sit in a ring in the order of the list: the prey of each one is the next one
export function createRing(decks: DeckList[]): Ring {
    const { gameState, players } = createHeadlessGame(decks)
    createdGames.push(gameState)
    gameState.turnOrder = players.map(player => player.oid)
    return { gameState, players }
}

export type MinionSetup = {
    blood?: number
    bleed?: number
    strength?: number
    intercept?: number
    locked?: boolean
    disciplines?: Partial<Disciplines>
}

export function addMinions(ring: Ring, player: Player, setups: MinionSetup[]): Vampire[] {
    return setups.map(setup => {
        const vampire = readyVampire(ring.gameState, player, setup.blood ?? 5)
        const attrs = vampire.minionAttrs
        attrs.disciplines = (setup.disciplines ?? {}) as Disciplines
        vampire.vampireAttrs.title = ''
        attrs.bleed = setup.bleed ?? 1
        attrs.strength = setup.strength ?? 1
        attrs.intercept = setup.intercept ?? 0
        vampire.isLocked = !!setup.locked
        return vampire
    })
}

// The hand of the player is these cards and nothing else
export function holdOnly(ring: Ring, player: Player, ids: string[]): LibraryCard[] {
    emptyHand(ring.gameState, player)
    return ids.map(id => giveCard(ring.gameState, player, id))
}

// Through the view of the player, as the agent gets it: what it must not see is not there
export function assessAs(
    ring: Ring,
    player: Player,
    profile: BotProfile = DEFAULT_PROFILE,
): Assessment {
    const view = createPlayerView(ring.gameState, player)
    try {
        return assess(view.gameState, view.player, profile)
    } finally {
        view.dispose()
    }
}

export function snapshotAs(ring: Ring, player: Player) {
    const view = createPlayerView(ring.gameState, player)
    try {
        return takeSnapshot(view.gameState, view.player)
    } finally {
        view.dispose()
    }
}

export function expectClose(
    actual: number,
    expected: number,
    what: string,
    tolerance = 0.005,
): void {
    if (Math.abs(actual - expected) > tolerance) {
        throw new ScenarioFailure(`${what}: expected about ${expected}, got ${actual}`)
    }
}

// The chance that a hand of `cards` cards has none of the cards that a share `share` of the deck holds
const withNone = (share: number, cards: number) => (1 - share) ** cards

export const ASSESSMENT_SCENARIOS: Scenario[] = [
    {
        name: 'Minion profile: a vampire is its crypt card, with its state',
        run() {
            const ring = createRing([GovernDeck, GovernDeck])
            const [me] = ring.players
            const [unlocked, locked] = addMinions(ring, me, [
                { blood: 4 },
                { blood: 6, bleed: 2, locked: true },
            ])
            const first = profileMinion(unlocked)
            expectEqual(first.state, 'unlocked', 'state')
            expectEqual(first.blood, 4, 'blood')
            expectEqual(first.capacity, unlocked.minionAttrs.capacity, 'capacity')
            expectEqual(first.strength, 1, 'strength')
            expectEqual(
                JSON.stringify(first.intercept),
                JSON.stringify({ general: 0, directed: 0, againstBleeds: 0 }),
                'intercept',
            )
            const second = profileMinion(locked)
            expectEqual(second.state, 'locked', 'locked')
            expectEqual(second.bleed, 2, 'bleed')
            ring.gameState.moveCardToRegion(unlocked, me.torpor)
            expectEqual(profileMinion(unlocked).state, 'torpor', 'torpor')
        },
    },
    {
        name: 'Minion profile: a weapon gives a strike with its range and a free maneuver, the strength is the one of the engine',
        run() {
            const ring = createRing([AttachDeck, AttachDeck])
            const [me] = ring.players
            const [vampire] = addMinions(ring, me, [{}])
            const magnum = findAnyCard(me, MAGNUM_ID)
            attachInPlay(magnum, vampire)
            const profile = profileMinion(vampire)
            expectEqual(profile.weaponStrikes.length, 1, 'one strike')
            expectEqual(profile.weaponStrikes[0].damage, 2, 'damage')
            expectEqual(profile.weaponStrikes[0].ranged, true, 'ranged')
            expectEqual(profile.weaponStrikes[0].aggravated, false, 'not aggravated')
            expectEqual(profile.freeManeuver, true, 'free maneuver')
            expectEqual(profile.attached.join(), magnum.name, 'attached')

            attachInPlay(findAnyCard(me, PRETERNATURAL_ID), vampire)
            expectEqual(profileMinion(vampire).strength, getMinionStrength(vampire), 'strength')
            expectEqual(profileMinion(vampire).strength > 1, true, 'stronger')
            expectEqual(profileMinion(vampire).forbiddenPlays.length > 0, true, 'cannot play')
        },
    },
    {
        name: 'Minion profile: a retainer gives life and the intercept the engine counts',
        run() {
            const ring = createRing([AttachDeck, AttachDeck])
            const [me] = ring.players
            const [vampire] = addMinions(ring, me, [{}])
            attachInPlay(findAnyCard(me, RAVEN_SPY_ID), vampire, {
                life: 2,
                disciplines: SPY_INFERIOR,
            })
            const profile = profileMinion(vampire)
            expectEqual(profile.life, 2, 'life')
            expectEqual(profile.intercept.general, 1, 'intercept')
            expectEqual(
                profile.intercept.general,
                getMinionIntercept(vampire),
                'same as the engine',
            )
        },
    },
    {
        name: 'Minion profile: an intercept that holds only against bleeds is not counted against other actions',
        run() {
            const ring = createRing([AttachDeck, AttachDeck])
            const [me] = ring.players
            const [vampire] = addMinions(ring, me, [{}])
            attachInPlay(findAnyCard(me, GUARDIAN_ANGEL_ID), vampire)
            const profile = profileMinion(vampire)
            expectEqual(profile.intercept.general, 0, 'against other actions')
            expectEqual(profile.intercept.againstBleeds, 1, 'against bleeds')
            expectEqual(profile.prevention.join(), '1', 'prevents 1 damage')
            expectEqual(profile.burnsInTorpor, true, 'burns in torpor')
        },
    },
    {
        name: 'Snapshot: the minions and equipment of the others are public, their hand is not',
        run() {
            const ring = createRing([AttachDeck, AttachDeck])
            const [me, other] = ring.players
            const [vampire] = addMinions(ring, other, [{ strength: 2 }])
            attachInPlay(findAnyCard(other, MAGNUM_ID), vampire)
            const hand = me.hand.cards.length

            const table = snapshotAs(ring, me)
            expectEqual(table.others.length, 1, 'one other')
            const seen = table.others[0]
            expectEqual(seen.isPrey && seen.isPredator, true, 'both with two players')
            expectEqual(seen.minions.length, 1, 'its minion')
            expectEqual(seen.minions[0].weaponStrikes.length, 1, 'its weapon')
            expectEqual(seen.minions[0].strength, 2, 'its strength')
            expectEqual(seen.hand.length, 0, 'its hand is not known')
            expectEqual(seen.handSize, other.hand.cards.length, 'its hand size is')
            expectEqual(table.me.hand.length, hand, 'mine is')
        },
    },
    {
        name: 'Snapshot: the permanents with an ability say whether a charge is left, a locked one is spent',
        run() {
            const ring = createRing([LABYRINTH_DECK, LABYRINTH_DECK])
            const [me] = ring.players
            const lenny = readySpecific(ring.gameState, me, LENNY_ID, 5)
            const labyrinth = findAnyCard(me, LABYRINTH_ID)
            ring.gameState.moveCardToRegion(labyrinth, me.ready)

            const kitOf = (clan?: string) => {
                const table = snapshotAs(ring, me)
                const minion = table.me.minions.find(candidate => candidate.oid == lenny.oid)
                if (!minion) {
                    throw new ScenarioFailure('No profile for Lenny')
                }
                const attacker = clan ? { ...minion, clan } : minion
                return {
                    table,
                    kit: attackKitOf(
                        table.me,
                        [attacker],
                        densitiesOf(table.me, DEFAULT_PROFILE),
                        DEFAULT_PROFILE,
                    ),
                }
            }
            const ready = kitOf()
            expectEqual(ready.table.me.permanents.length, 1, 'one permanent')
            expectEqual(ready.table.me.permanents[0].available, true, 'a charge is left')
            expectEqual(ready.kit.standingStealth, 1, 'a Nosferatu has +1 stealth for free')
            expectEqual(kitOf('Toreador').kit.standingStealth, 0, 'another clan has not')

            labyrinth.lock()
            const spent = kitOf()
            expectEqual(spent.table.me.permanents[0].available, false, 'spent')
            expectEqual(spent.kit.standingStealth, 0, 'no stealth')
        },
    },
    {
        name: 'Capabilities: the disciplines of the minions in play raise what its Methuselah is believed to hold, nothing shown is the prior',
        run() {
            const prior = DEFAULT_PROFILE.opponentPrior
            const obfuscate = { [Discipline.Obfuscate]: DisciplineLevel.INFERIOR }
            const stealthOf = (...minions: Partial<Disciplines>[]) =>
                roleDensities(minions, {}, prior).stealth ?? 0

            const base = prior.density.stealth ?? 0
            expectClose(stealthOf(), base, 'nothing shown')
            expectClose(
                stealthOf(obfuscate),
                1 - (1 - base) * (1 - 0.08 * 0.5),
                'one Obfuscate vampire',
            )
            expectClose(
                stealthOf(obfuscate, obfuscate),
                1 - (1 - base) * (1 - 0.08 * 0.75),
                'two are a safer bet',
            )
            expectEqual(
                stealthOf({ [Discipline.Obfuscate]: DisciplineLevel.SUPERIOR }) >
                    stealthOf(obfuscate),
                true,
                'superior says more',
            )
            expectClose(
                roleDensities([obfuscate], {}, prior).wake ?? 0,
                prior.density.wake ?? 0,
                'what the discipline does not say stays at the prior',
            )
            expectClose(
                roleDensities([], { stealth: 3 }, prior).stealth ?? 0,
                1 - (1 - base) * 0.97 ** 3,
                'a stealth card played raises it',
            )

            const everything = roleDensities(
                Object.values(Discipline).map(name => ({ [name]: DisciplineLevel.SUPERIOR })),
                { stealth: 5, bleed: 5, accelerate: 5 },
                prior,
            )
            const total = Object.values(everything).reduce((sum, share) => sum + share, 0)
            expectEqual(total <= prior.budget + 1e-9, true, 'a library holds only so much')
        },
    },
    {
        name: 'Attack: a distribution of the cards in a hand sums to one, the tail is folded into the cap',
        run() {
            const hand = binomial(7, 0.08, 3)
            expectEqual(hand.length, 4, 'outcomes')
            expectClose(
                hand.reduce((sum, outcome) => sum + outcome.p, 0),
                1,
                'sum',
                1e-9,
            )
            expectClose(hand[0].p, withNone(0.08, 7), 'no card', 1e-9)
            expectEqual(binomial(2, 0.5, 3).length, 3, 'never more than the hand')
            expectEqual(binomial(0, 0.5, 3).length, 1, 'an empty hand')
            expectClose(binomial(7, 0.06, 3, 1.5)[1].value, 1.5, 'scaled', 1e-9)
        },
    },
    {
        name: 'Lunge: a predator with three ready minions ousts a pool its bleeds reach, by the cards in its hand when they do not',
        run() {
            const ring = createRing([GovernDeck, GovernDeck])
            const [me, predator] = ring.players
            addMinions(ring, predator, [{ bleed: 2 }, { bleed: 2 }, { bleed: 2 }])
            const assessment = assessAs(ring, me)
            const hand = predator.hand.cards.length

            expectEqual(chanceOfOust(assessment, { pool: 5 }), 1, 'the bleeds alone are 6')
            expectEqual(chanceOfOust(assessment, { pool: 6 }), 1, 'exactly the pool')
            // One bleed modifier is enough to make 7. An unlock card is not: a minion bleeds once a turn
            expectClose(
                chanceOfOust(assessment, { pool: 7 }),
                1 - withNone(DEFAULT_PROFILE.opponentPrior.density.bleedBonus ?? 0, hand),
                'a modifier in a hand of the predator',
            )
            expectEqual(chanceOfOust(assessment, { pool: 12 }), 0, 'out of reach of any hand')
        },
    },
    {
        name: 'Lunge: a predator whose minions are all in torpor takes nothing, one that is only locked still does ( it unlocks first )',
        run() {
            const ring = createRing([GovernDeck, GovernDeck])
            const [me, predator] = ring.players
            const minions = addMinions(ring, predator, [
                { bleed: 3, locked: true },
                { bleed: 3, locked: true },
            ])
            const locked = assessAs(ring, me).threat[predator.oid]
            expectEqual(locked.bleed > 5, true, 'locked minions unlock at the start of its turn')

            for (const minion of minions) {
                ring.gameState.moveCardToRegion(minion, predator.torpor)
            }
            const torpid = assessAs(ring, me)
            expectEqual(torpid.threat[predator.oid].total, 0, 'no threat')
            expectEqual(chanceOfOust(torpid, { pool: 1 }), 0, 'no ouster')
        },
    },
    {
        name: 'Lunge: each blocker kept unlocked lowers the chance of being ousted, the cards of the predator keep it above zero',
        run() {
            const ring = createRing([GovernDeck, GovernDeck])
            const [me, predator] = ring.players
            addMinions(ring, me, [{}, {}, {}])
            addMinions(ring, predator, [{ bleed: 2 }, { bleed: 2 }, { bleed: 2 }])
            me.pool = 5
            const assessment = assessAs(ring, me)
            const curve = survivalCurve(assessment).map(point => point.chanceOfOust)
            expectEqual(curve.length, 4, 'from none to all three')
            expectEqual(curve[0], 1, 'nobody home: three bleeds of 2 against 5')
            // The predator sees the blockers: with two at home its own bleeds are blocked and it keeps its
            // minions home too, so the third changes nothing more
            for (let i = 1; i < curve.length; i++) {
                expectEqual(curve[i] <= curve[i - 1], true, `blocker ${i} never hurts`)
            }
            expectEqual(curve[1] < curve[0] && curve[2] < curve[1], true, 'the first two help')
            expectEqual(curve[3] > 0, true, 'stealth cards beat blockers')
            expectEqual(curve[3] < 0.35, true, 'but three blockers are a wall')
            expectEqual(
                chanceOfOust(assessment),
                curve[3],
                'by default the minions that are unlocked now',
            )
        },
    },
    {
        name: 'Lunge: a predator keeps minions unlocked against its own predator, and sends them all when that can oust me',
        run() {
            const setup = (
                bleedersOfPredator: number,
                pool: number,
                predatorPool = 4,
                profile: BotProfile = DEFAULT_PROFILE,
                idlers = 0,
                intercept = 1,
            ) => {
                const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
                const [me, prey, predator] = ring.players
                addMinions(ring, predator, [
                    { bleed: 2, intercept },
                    { bleed: 2, intercept },
                    { bleed: 2, intercept },
                ])
                // My prey is the predator of my predator
                addMinions(ring, prey, [
                    ...Array.from({ length: bleedersOfPredator }, () => ({ bleed: 3 })),
                    ...Array.from({ length: idlers }, () => ({ bleed: 0 })),
                ])
                predator.pool = predatorPool
                me.pool = pool
                const assessment = assessAs(ring, me, profile)
                return {
                    assessment,
                    kept: assessment.held[predator.oid].length,
                    bleed: assessment.threat[predator.oid].bleed,
                }
            }

            const quiet = setup(0, 9)
            expectEqual(quiet.kept, 0, 'nobody bleeds it: it keeps nobody back')
            expectEqual(quiet.bleed > 5, true, 'it bleeds with all three')

            const pressed = setup(3, 9)
            expectEqual(pressed.kept > 0, true, 'three bleeders: it keeps some back')
            expectEqual(pressed.bleed < quiet.bleed, true, 'what is kept back does not bleed me')
            expectEqual(
                chanceOfOust(pressed.assessment) < chanceOfOust(quiet.assessment),
                true,
                'and I am safer for it',
            )

            // Far from an ouster ( 30 pool ) it still defends: a bleed that lands weakens it for good
            const rich = setup(3, 9, 30)
            expectEqual(rich.kept > 0, true, 'a pool of 30 is not a reason to stay open')

            // With my pool at 2 sending them all ousts me for sure: it does not keep anyone back
            const lethal = setup(3, 2)
            expectEqual(lethal.kept > 0, true, 'it would keep some back')
            expectEqual(
                chanceOfOust(lethal.assessment),
                1,
                'but the oust wins the game, so it sends all',
            )

            // A blocker also stops the strong action that is not a bleed: with a high enough guard it stays
            // home even when nobody bleeds its Methuselah
            const guard = (value: number): BotProfile => ({
                ...DEFAULT_PROFILE,
                opponentPrior: {
                    ...DEFAULT_PROFILE.opponentPrior,
                    reserve: { ...DEFAULT_PROFILE.opponentPrior.reserve, guard: value },
                },
            })
            expectEqual(setup(0, 9, 4, guard(0), 1).kept, 0, 'no guard: it all goes out')
            expectEqual(setup(0, 9, 4, guard(10), 1).kept, 3, 'a guard worth more than a bleed')
            // It only guards against actions that may come at it, and that its intercept reaches: a hunt has
            // stealth 1, so a minion with no intercept stops none
            expectEqual(setup(0, 9, 4, guard(10), 0).kept, 0, 'nobody can act on it: no guard')
            expectEqual(setup(0, 9, 4, guard(10), 1, 0).kept, 0, 'no intercept, nothing stopped')
        },
    },
    {
        name: 'Guard: the share of the undirected actions that an intercept stops, from their stealth and the cards behind it',
        run() {
            const hunt = { stealth: 1, points: exact(0), worth: 1 }
            expectEqual(
                interceptShare(0, [hunt]),
                0,
                'a hunt has stealth 1: no intercept, no block',
            )
            expectEqual(interceptShare(1, [hunt]), 1, 'an intercept of 1 matches it')
            expectEqual(interceptShare(1, []), 0, 'no one to act: nothing to stop')
            // A vampire whose crypt card lowers its stealth acts at 0
            const quiet = { stealth: 0, points: exact(0), worth: 1 }
            expectClose(interceptShare(0, [hunt, quiet]), 0.5, 'half of them at intercept 0')
            expectEqual(interceptShare(1, [hunt, quiet]), 1, 'all of them at intercept 1')
            // The cards of its Methuselah may raise the stealth past the intercept
            const backed = {
                stealth: 1,
                points: [
                    { value: 0, p: 0.6 },
                    { value: 1, p: 0.4 },
                ],
                worth: 1,
            }
            expectClose(interceptShare(1, [backed]), 0.6, 'a stealth card flips the block')
            expectEqual(interceptShare(2, [backed]), 1, 'one more intercept beats it')
            // What stopping the actions of one of them is worth counts for its share
            expectClose(
                interceptShare(1, [hunt, { ...hunt, worth: 3 }]),
                2,
                'actions worth three times the guard count three times',
            )

            // The actors are read from the board: the stealth of the engine, less what the crypt card takes
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, prey] = ring.players
            addMinions(ring, prey, [{}, {}])
            const table = snapshotAs(ring, me)
            const owner = table.others[0]
            const [first, second] = owner.minions
            const shy = { ...owner, minions: [first, { ...second, undirectedStealth: -1 }] }
            const densities = densitiesOf(owner, DEFAULT_PROFILE)
            expectEqual(
                idleActorsOf(shy, densities, DEFAULT_PROFILE)
                    .map(actor => actor.stealth)
                    .join(),
                '1,0',
                'stealth 1, or 0 for the shy vampire',
            )
        },
    },
    {
        name: 'Guard: a minion with an intercept that reaches the actions at the table keeps its Methuselah home more',
        run() {
            const keptWith = (intercept: number) => {
                const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
                const [me, prey, predator] = ring.players
                addMinions(ring, predator, [{ bleed: 2, intercept }])
                addMinions(ring, prey, [{ bleed: 0 }])
                predator.pool = 4
                me.pool = 9
                const profile: BotProfile = {
                    ...DEFAULT_PROFILE,
                    opponentPrior: {
                        ...DEFAULT_PROFILE.opponentPrior,
                        reserve: { ...DEFAULT_PROFILE.opponentPrior.reserve, guard: 10 },
                    },
                }
                return assessAs(ring, me, profile).held[predator.oid].length
            }
            expectEqual(keptWith(0), 0, 'it stops no hunt: out it goes')
            expectEqual(keptWith(1), 1, 'it stops them all: it stays')
        },
    },
    {
        name: 'Lunge: an unlock card lets a minion bleed and defend, never bleed twice',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, prey, predator] = ring.players
            addMinions(ring, predator, [
                { bleed: 2, intercept: 1 },
                { bleed: 2, intercept: 1 },
                { bleed: 2, intercept: 1 },
            ])
            addMinions(ring, prey, [{ bleed: 3 }, { bleed: 3 }, { bleed: 3 }])
            me.pool = 20
            const withUnlock = (density: number): BotProfile => ({
                ...DEFAULT_PROFILE,
                opponentPrior: {
                    ...DEFAULT_PROFILE.opponentPrior,
                    density: { ...DEFAULT_PROFILE.opponentPrior.density, unlock: density },
                },
            })
            const bleedOf = (density: number) => {
                const assessment = assessAs(ring, me, withUnlock(density))
                return {
                    held: assessment.held[predator.oid].length,
                    bleed: assessment.threat[predator.oid].bleed,
                }
            }
            const none = bleedOf(0)
            const many = bleedOf(0.9)
            expectEqual(none.held > 0, true, 'it keeps some back')
            expectEqual(many.bleed > none.bleed, true, 'with unlock cards it sends more of them')
            // Two unlock cards at the most, and a bleed each: three bleeders of 2 never make more than 6
            expectEqual(many.bleed <= 6 + 1e-9, true, 'but a minion never bleeds twice')

            const prior = DEFAULT_PROFILE.opponentPrior
            const fortitude = { [Discipline.Fortitude]: DisciplineLevel.SUPERIOR }
            expectEqual(
                (roleDensities([fortitude], {}, prior).unlock ?? 0) >
                    (roleDensities([], {}, prior).unlock ?? 0),
                true,
                'a Fortitude vampire raises the belief that it holds one',
            )
        },
    },
    {
        name: 'Defence: a wake card in hand makes a locked minion a defender, and only the card in hand',
        run() {
            const ring = createRing([MalkavDeck, MalkavDeck])
            const [me, predator] = ring.players
            addMinions(ring, me, [{ locked: true }])
            addMinions(ring, predator, [{ bleed: 6 }])
            me.pool = 5
            const hand = predator.hand.cards.length

            holdOnly(ring, me, [])
            expectEqual(chanceOfOust(assessAs(ring, me)), 1, 'nobody can block the bleed of 6')

            holdOnly(ring, me, [QUI_VIVE_ID])
            expectClose(
                chanceOfOust(assessAs(ring, me)),
                1 - withNone(DEFAULT_PROFILE.opponentPrior.density.stealth ?? 0, hand),
                'the woken minion blocks unless a stealth card beats it',
            )
        },
    },
    {
        name: 'Defence: a card that wakes and gives intercept is worth as much to a minion that is already unlocked',
        run() {
            const chance = (locked: boolean, hand: string[]) => {
                const ring = createRing([BrujahDeck, BrujahDeck])
                const [me, predator] = ring.players
                addMinions(ring, me, [{ locked }])
                addMinions(ring, predator, [{ bleed: 6 }])
                me.pool = 5
                holdOnly(ring, me, hand)
                return chanceOfOust(assessAs(ring, me))
            }
            const asleep = chance(true, [ORGANIZED_RESISTANCE_ID])
            expectClose(chance(false, [ORGANIZED_RESISTANCE_ID]), asleep, 'locked or not', 1e-9)
            expectEqual(asleep < chance(false, []), true, 'the intercept needs more stealth')
        },
    },
    {
        name: 'Defence: KRCG News Radio in play, unlocked, counts as an intercept charge, locked it does not',
        run() {
            const chance = (state: 'absent' | 'ready' | 'locked') => {
                const ring = createRing([KRCG_DECK, KRCG_DECK])
                const [me, predator] = ring.players
                addMinions(ring, me, [{}])
                addMinions(ring, predator, [{ bleed: 6 }])
                me.pool = 5
                holdOnly(ring, me, [])
                if (state != 'absent') {
                    const krcg = findAnyCard(me, KRCG_ID)
                    ring.gameState.moveCardToRegion(krcg, me.ready)
                    krcg.isLocked = state == 'locked'
                }
                return chanceOfOust(assessAs(ring, me))
            }
            expectEqual(chance('ready') < chance('absent'), true, 'the charge helps')
            expectEqual(chance('locked'), chance('absent'), 'a locked card does not')
        },
    },
    {
        name: 'Defence: a bounce card with a minion that can play it takes the biggest bleed that lands elsewhere',
        run() {
            // Three Methuselahs: the bleed has somewhere to go ( my prey, which is not the attacker )
            const ring = createRing([MalkavDeck, MalkavDeck, MalkavDeck])
            const [me, , predator] = ring.players
            const dominate = { [Discipline.Dominate]: DisciplineLevel.INFERIOR }
            addMinions(ring, me, [{ disciplines: dominate }, { disciplines: dominate }])
            addMinions(ring, predator, [{ bleed: 3 }, { bleed: 3 }])
            me.pool = 5

            holdOnly(ring, me, [])
            const without = chanceOfOust(assessAs(ring, me))
            holdOnly(ring, me, [DEFLECTION_ID])
            const bounce = chanceOfOust(assessAs(ring, me))
            expectEqual(bounce < without, true, 'a Deflection in hand helps')
        },
    },
    {
        name: 'Defence: with two Methuselahs left a bounce has nowhere to send the bleed, the card is dead',
        run() {
            const lunge = (decks: DeckList[], hand: string[]) => {
                const ring = createRing(decks)
                const me = ring.players[0]
                const predator = ring.players[ring.players.length - 1]
                const dominate = { [Discipline.Dominate]: DisciplineLevel.INFERIOR }
                addMinions(ring, me, [{ disciplines: dominate }, { disciplines: dominate }])
                addMinions(ring, predator, [{ bleed: 3 }, { bleed: 3 }])
                me.pool = 5
                holdOnly(ring, me, hand)
                return { ring, me, chance: chanceOfOust(assessAs(ring, me)) }
            }
            const duel = [MalkavDeck, MalkavDeck]
            const empty = lunge(duel, [])
            const held = lunge(duel, [DEFLECTION_ID])
            expectEqual(held.chance, empty.chance, 'a Deflection changes nothing in a duel')

            const table = snapshotAs(held.ring, held.me)
            expectEqual(canBounce(table), false, 'no bounce')
            expectEqual(isRoleLive(table, 'bounce'), false, 'a dead role')
            expectEqual(isRoleLive(table, 'stealth'), true, 'the other roles live')
            expectEqual(bounceTargetOf(table, table.me), null, 'nowhere to send it')

            // With three it goes to the prey of the one that bounces, which is not the attacker
            const three = lunge([MalkavDeck, MalkavDeck, MalkavDeck], [])
            const ring3 = snapshotAs(three.ring, three.me)
            expectEqual(canBounce(ring3), true, 'a bounce is possible')
            expectEqual(isRoleLive(ring3, 'bounce'), true, 'a live role')
            const { prey, predator } = ring3
            if (!prey || !predator) {
                throw new ScenarioFailure('No prey or predator')
            }
            expectEqual(
                bounceTargetOf(ring3, prey)?.oid,
                predator.oid,
                'my prey sends it to its prey, my predator',
            )
            expectEqual(bounceTargetOf(ring3, ring3.me)?.oid, prey.oid, 'I send it to my prey')
        },
    },
    {
        name: 'Opportunity: a bleed of mine that my prey bounces lands on its own prey, with a baron or Dominate to play it, and never with two left',
        run() {
            const bounced = (decks: DeckList[], reactor: MinionSetup, title = '') => {
                const ring = createRing(decks)
                const [me, prey, other] = ring.players
                addMinions(ring, me, [
                    {
                        bleed: 2,
                        disciplines: { [Discipline.Obfuscate]: DisciplineLevel.INFERIOR },
                    },
                ])
                const [vampire] = addMinions(ring, prey, [reactor])
                vampire.vampireAttrs.title = title
                // My stealth card lands the bleed past the reactor, which stays unlocked: it may bounce
                holdOnly(ring, me, [LOST_IN_CROWDS_ID])
                return { opportunity: assessAs(ring, me).opportunity[prey.oid], other }
            }
            const trio = [MalkavDeck, MalkavDeck, MalkavDeck]
            const dominate = { disciplines: { [Discipline.Dominate]: DisciplineLevel.INFERIOR } }

            const plain = bounced(trio, {})
            expectEqual(plain.opportunity.chanceOfBounce, 0, 'nobody can play a bounce')
            expectClose(plain.opportunity.drain, 2, 'the bleed lands', 1e-9)

            const dom = bounced(trio, dominate)
            expectEqual(dom.opportunity.chanceOfBounce > 0, true, 'Dominate may bounce')
            expectEqual(dom.opportunity.bounceTarget, dom.other.oid, 'onto the prey of my prey')
            expectClose(
                dom.opportunity.drain + dom.opportunity.bounced,
                2,
                'what does not hit my prey is bounced',
                1e-9,
            )

            const baron = bounced(trio, {}, 'baron')
            expectEqual(baron.opportunity.chanceOfBounce > 0, true, 'a baron may bounce')

            const duel = bounced([MalkavDeck, MalkavDeck], dominate)
            expectEqual(duel.opportunity.chanceOfBounce, 0, 'no bounce in a duel')
            expectEqual(duel.opportunity.bounceTarget, null, 'no target')
            expectClose(duel.opportunity.drain, 2, 'the bleed lands', 1e-9)
        },
    },
    {
        name: 'Capabilities: a baron and a superior Auspex raise the bounce a Methuselah is believed to hold',
        run() {
            const prior = DEFAULT_PROFILE.opponentPrior
            const bounceOf = (minions: Partial<Disciplines>[], titles: string[] = []) =>
                roleDensities(minions, {}, prior, titles).bounce ?? 0
            const base = bounceOf([])
            expectClose(base, prior.density.bounce ?? 0, 'nothing shown')
            expectClose(bounceOf([{}], ['baron']), 1 - (1 - base) * (1 - 0.04 * 0.5), 'a baron')
            expectClose(bounceOf([{}], ['']), base, 'no title', 1e-9)
            expectClose(
                bounceOf([{ [Discipline.Auspex]: DisciplineLevel.INFERIOR }]),
                base,
                'inferior Auspex has none',
                1e-9,
            )
            expectEqual(
                bounceOf([{ [Discipline.Auspex]: DisciplineLevel.SUPERIOR }]) > base,
                true,
                'superior Auspex has some',
            )
        },
    },
    {
        name: 'Opponent model: nothing shown is the prior with no confidence, each vampire and each card seen adds to it',
        run() {
            const ring = createRing([GovernDeck, GovernDeck])
            const [me, other] = ring.players
            const modelAs = () => opponentModelOf(snapshotAs(ring, me).others[0], DEFAULT_PROFILE)
            const bare = modelAs()
            expectEqual(bare.confidence, 0, 'nothing shown, no confidence')
            expectClose(
                bare.risks.stealth,
                DEFAULT_PROFILE.opponentPrior.density.stealth ?? 0,
                'the prior',
                1e-9,
            )

            addMinions(ring, other, [
                { disciplines: { [Discipline.Obfuscate]: DisciplineLevel.SUPERIOR } },
            ])
            const shown = modelAs()
            expectClose(shown.confidence, 0.5, 'one vampire halves the doubt', 1e-9)
            expectEqual(shown.risks.stealth > bare.risks.stealth, true, 'Obfuscate says stealth')
            expectEqual(shown.risks.blocking, bare.risks.blocking, 'and nothing of blocking')
        },
    },
    {
        name: 'Opponent model: what the ledger saw pulls the bleed size and the block rate from the prior, a single observation little',
        run() {
            const ring = createRing([GovernDeck, GovernDeck])
            const [me, other] = ring.players
            const { behaviour } = DEFAULT_PROFILE.opponentPrior
            const modelWith = (seen: (ledger: PlayerLedger) => void) => {
                const ledger = createLedger()
                seen(getPlayerLedger(ledger, other.oid))
                return opponentModelOf(
                    snapshotAs(ring, me).others[0],
                    DEFAULT_PROFILE,
                    getPlayerLedger(ledger, other.oid),
                )
            }
            const none = modelWith(() => {})
            expectClose(none.risks.bleedSize, behaviour.bleedSize, 'no bleed seen: the prior', 1e-9)
            expectClose(
                none.risks.blockRate,
                behaviour.blockRate,
                'no block chance: the prior',
                1e-9,
            )
            expectEqual(none.observed.bleeds, 0, 'no bleed counted')

            const one = modelWith(seen => {
                seen.bleedAmounts = [8]
            })
            expectClose(
                one.risks.bleedSize,
                (behaviour.bleedSize * behaviour.weight + 8) / (behaviour.weight + 1),
                'one bleed of 8 moves it a quarter of the way',
                1e-9,
            )
            expectEqual(one.risks.bleedSize < 4, true, 'and does not make it a big bleeder')
            const many = modelWith(seen => {
                seen.bleedAmounts = Array.from({ length: 12 }, () => 8)
            })
            expectEqual(many.risks.bleedSize > 6, true, 'twelve of them do')
            expectEqual(many.confidence > one.confidence, true, 'and make the read surer')

            const declines = modelWith(seen => {
                seen.blocksDeclined = 9
            })
            expectEqual(declines.risks.blockRate < behaviour.blockRate / 2, true, 'it never blocks')
            const blocks = modelWith(seen => {
                seen.blocksAttempted = 9
                seen.blocksDeclined = 1
            })
            expectEqual(blocks.risks.blockRate > 0.6, true, 'it blocks nearly always')
            expectEqual(blocks.observed.blockChances, 10, 'ten chances counted')
        },
    },
    {
        name: 'Opponent model: the kinds of action it takes besides bleeds set what stopping one of them is worth',
        run() {
            const ring = createRing([GovernDeck, GovernDeck])
            const [me, other] = ring.players
            const { mix } = DEFAULT_PROFILE.opponentPrior.behaviour
            const modelWith = (seen: (ledger: PlayerLedger) => void) => {
                const ledger = createLedger()
                seen(getPlayerLedger(ledger, other.oid))
                return opponentModelOf(
                    snapshotAs(ring, me).others[0],
                    DEFAULT_PROFILE,
                    getPlayerLedger(ledger, other.oid),
                )
            }
            const none = modelWith(() => {})
            expectClose(none.mix.hunt, mix.hunt, 'nothing seen: the prior mix', 1e-9)
            expectClose(none.guardFactor, 1, 'the prior mix is worth the neutral guard', 1e-9)

            const politician = modelWith(seen => {
                seen.actionsDeclared = 14
                seen.bleedsDeclared = 4
                seen.politicalDeclared = 8
                seen.huntsDeclared = 2
            })
            expectEqual(politician.observed.actions, 10, 'ten actions that are not bleeds')
            expectEqual(politician.mix.political > 0.4, true, 'it plays politics')
            expectEqual(politician.guardFactor > 1.5, true, 'stopping its actions is worth more')

            const hunter = modelWith(seen => {
                seen.actionsDeclared = 12
                seen.huntsDeclared = 12
            })
            expectEqual(hunter.mix.hunt > 0.8, true, 'it only hunts')
            expectEqual(hunter.guardFactor < 0.8, true, 'stopping its actions is worth less')
            expectClose(
                hunter.mix.hunt + hunter.mix.political + hunter.mix.other,
                1,
                'the mix is a whole',
                1e-9,
            )
        },
    },
    {
        name: 'Opportunity: a stealth card in hand flips the block of the prey, the drain is the bleed',
        run() {
            const ring = createRing([MalkavDeck, MalkavDeck])
            const [me, prey] = ring.players
            addMinions(ring, me, [
                { disciplines: { [Discipline.Obfuscate]: DisciplineLevel.INFERIOR } },
            ])
            addMinions(ring, prey, [{}])

            holdOnly(ring, me, [])
            const blocked = assessAs(ring, me).opportunity[prey.oid]
            expectEqual(blocked.drain, 0, 'the unlocked prey blocks')
            expectEqual(blocked.blockedShare, 1, 'every action')

            holdOnly(ring, me, [LOST_IN_CROWDS_ID])
            const stealthy = assessAs(ring, me).opportunity[prey.oid]
            expectEqual(stealthy.drain, 1, 'the bleed lands')
            expectEqual(stealthy.blockedShare, 0, 'nothing is blocked')
        },
    },
    {
        name: 'Threat is a matchup: the fighters of the other are a danger to minions they beat and only when my actions get blocked',
        run() {
            const fight = (mine: MinionSetup, hand: string[]) => {
                const ring = createRing([MalkavDeck, MalkavDeck])
                const [me, other] = ring.players
                addMinions(ring, me, [mine])
                addMinions(ring, other, [{ strength: 3, blood: 7 }])
                holdOnly(ring, me, hand)
                return assessAs(ring, me).threat[other.oid].combat
            }
            const weak = { blood: 3 }
            const obfuscate = { [Discipline.Obfuscate]: DisciplineLevel.INFERIOR }

            const { plan, combat } = DEFAULT_PROFILE
            expectClose(
                fight(weak, []),
                plan.bloodValue * (3 - combat.credit * 1),
                'a fight it wins: my 3 blood against the 1 I deal, my action is blocked',
                0.01,
            )
            expectEqual(
                fight({ blood: 8, strength: 8 }, []),
                0,
                'a minion that puts it in torpor is not at risk',
            )
            expectEqual(
                fight({ ...weak, disciplines: obfuscate }, [LOST_IN_CROWDS_ID]),
                0,
                'my stealth keeps me out of its fights',
            )
        },
    },
    {
        name: 'Stakes: the weight of my predator falls when the Methuselah that would replace it is the bigger danger',
        run() {
            const weightOf = (successorBleeds: number[]) => {
                const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
                const [me, successor, predator] = ring.players
                addMinions(ring, predator, [{ bleed: 1 }])
                addMinions(
                    ring,
                    successor,
                    successorBleeds.map(bleed => ({ bleed })),
                )
                me.pool = 20
                return assessAs(ring, me).stakes[predator.oid].weight
            }
            const weak = weightOf([1])
            const strong = weightOf([2, 2, 2])
            expectEqual(strong < weak, true, 'a worse predator would come after it')
            expectEqual(strong < DEFAULT_PROFILE.ringPrior.predator, true, 'below the ring prior')
            expectEqual(
                strong >= DEFAULT_PROFILE.stakes.floor * DEFAULT_PROFILE.ringPrior.predator,
                true,
                'never below the floor',
            )
        },
    },
    {
        name: 'Stakes: of two Methuselahs that are neither my prey nor my predator, the strongest of the table weighs more',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck, GovernDeck, GovernDeck])
            const [me, , big, small] = ring.players
            addMinions(ring, big, [{}, {}, {}, {}])
            addMinions(ring, small, [{}])
            const stakes = assessAs(ring, me).stakes
            expectEqual(stakes[big.oid].ring, stakes[small.oid].ring, 'same place in the ring')
            expectEqual(stakes[big.oid].leader > 0, true, 'it leads the table')
            expectEqual(stakes[big.oid].weight > stakes[small.oid].weight, true, 'it weighs more')
        },
    },
    {
        name: 'Torpor: a predator with every vampire in torpor is a menace when a helper can rescue them, and nothing when it has no helper',
        run() {
            const threatOf = (decks: DeckList[]) => {
                const ring = createRing(decks)
                const me = ring.players[0]
                const predator = ring.players[ring.players.length - 1]
                const vampires = addMinions(ring, predator, [{ bleed: 3 }, { bleed: 3 }])
                for (const vampire of vampires) {
                    ring.gameState.moveCardToRegion(vampire, predator.torpor)
                }
                // The others have minions able to pay the rescue
                for (const other of ring.players.slice(1, -1)) {
                    addMinions(ring, other, [{ blood: 5 }])
                }
                me.pool = 1
                return assessAs(ring, me)
            }
            // With three, the other one is the predator of my predator: it will not help it
            const alone = threatOf([GovernDeck, GovernDeck, GovernDeck])
            expectEqual(alone.rescues.length, 2, 'two torpid vampires')
            expectEqual(
                alone.rescues.every(opening => opening.chance == 0),
                true,
                'no helper',
            )
            expectEqual(chanceOfOust(alone), 0, 'no ouster')

            // With four, my prey is neither the prey nor the predator of my predator
            const helped = threatOf([GovernDeck, GovernDeck, GovernDeck, GovernDeck])
            const predator = helped.table.predator
            if (!predator) {
                throw new ScenarioFailure('No predator')
            }
            expectEqual(helped.threat[predator.oid].total > 0, true, 'a menace')
            const chance = DEFAULT_PROFILE.helpers.rescueChance
            expectClose(helped.rescues[0].chance, chance, 'chance of one rescue')
            // The pool is 1: any bleed that lands ousts me, one of the two vampires back is enough
            expectClose(chanceOfOust(helped), 1 - (1 - chance) ** 2, 'at least one is back')
        },
    },
    {
        name: 'Torpor: a helper that cannot pay the blood does not rescue, one that is poor lets the vampire pay the rest',
        run() {
            const rescueOf = (helperBlood: number | null, vampireBlood: number) => {
                const ring = createRing([GovernDeck, GovernDeck, GovernDeck, GovernDeck])
                const [me, helper, , predator] = ring.players
                const [vampire] = addMinions(ring, predator, [{ bleed: 3, blood: vampireBlood }])
                ring.gameState.moveCardToRegion(vampire, predator.torpor)
                if (helperBlood !== null) {
                    addMinions(ring, helper, [{ blood: helperBlood }])
                }
                return assessAs(ring, me).rescues[0]
            }
            expectEqual(rescueOf(null, 5).chance, 0, 'the helper has no minion')
            expectEqual(rescueOf(0, 1).chance, 0, 'not enough blood between the two')
            expectEqual(rescueOf(0, 5).chance > 0, true, 'the vampire pays all of it')
            expectEqual(rescueOf(1, 1).chance > 0, true, 'one blood each')
        },
    },
    {
        name: 'Torpor: rescuing the vampire of my predator is worth less than nothing, one that bleeds a Methuselah I want drained is worth something, so is one of mine',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck, GovernDeck])
            const [me, , other, predator] = ring.players
            const [mine] = addMinions(ring, me, [{ bleed: 2 }])
            const [theirs] = addMinions(ring, other, [{ bleed: 2 }])
            const [menace] = addMinions(ring, predator, [{ bleed: 2 }])
            for (const [vampire, owner] of [
                [mine, me],
                [theirs, other],
                [menace, predator],
            ] as const) {
                ring.gameState.moveCardToRegion(vampire, owner.torpor)
            }
            const openings = assessAs(ring, me).rescues
            const valueOf = (vampire: Vampire) => {
                const opening = openings.find(candidate => candidate.vampire.oid == vampire.oid)
                if (!opening) {
                    throw new ScenarioFailure(`No rescue opening for ${vampire.name}`)
                }
                return opening.value
            }
            expectEqual(valueOf(menace) < 0, true, 'it would bleed me')
            // The vampire of `other` bleeds my predator, which is the Methuselah that bleeds me
            expectEqual(valueOf(theirs) > 0, true, 'it bleeds the Methuselah that bleeds me')
            expectEqual(valueOf(mine) > 0, true, 'it would bleed my prey')
        },
    },
    {
        name: 'Turn: ousting my prey gives me the pool to swallow the lunge of my predator, so sending every minion is the safer play',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, prey, predator] = ring.players
            const mine = addMinions(ring, me, [{ bleed: 2 }, { bleed: 2 }, { bleed: 2 }])
            addMinions(ring, predator, [{ bleed: 2 }, { bleed: 2 }, { bleed: 2 }])
            holdOnly(ring, me, [])
            me.pool = 5
            prey.pool = 6
            const assessment = assessAs(ring, me)
            const minions = assessment.table.me.minions.filter(minion =>
                mine.some(vampire => vampire.oid == minion.oid),
            )
            expectEqual(minions.length, 3, 'my three minions, as the view shows them')

            // Everybody home: the lunge of 6 against 5 ousts me
            const home = outcomeOfTurn(assessment, { actors: [], reserved: minions })
            expectEqual(home.chanceToOust, 0, 'nobody sent')
            expectEqual(home.chanceOfBeingOusted < 1, true, 'my blockers hold some of it')

            // All three sent: 6 bleeds finish the prey, and the 6 pool gained out of reach of any hand
            const all = outcomeOfTurn(assessment, { actors: minions, reserved: [] })
            expectEqual(all.chanceToOust, 1, 'the prey is finished')
            expectEqual(all.chanceOfBeingOusted, 0, 'the pool gained swallows the lunge')
            expectEqual(OUST_POOL_GAIN > 0, true, 'the gain is the one of the game')

            // One short of the blow: nothing gained, and no blockers left
            const short = outcomeOfTurn(assessment, { actors: minions.slice(0, 2), reserved: [] })
            expectEqual(short.chanceToOust < 1, true, 'four bleeds do not finish it')
            expectEqual(short.chanceOfBeingOusted > 0.9, true, 'and I am exposed')
        },
    },
    {
        name: 'Assessment: through the view it is the one of the live game, and it prints',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, prey, predator] = ring.players
            addMinions(ring, me, [{}, {}])
            addMinions(ring, prey, [{}])
            addMinions(ring, predator, [{ bleed: 2 }, { bleed: 2 }])
            const parts = (assessment: Assessment) =>
                JSON.stringify([
                    assessment.densities,
                    assessment.power,
                    assessment.threat,
                    assessment.opportunity,
                    assessment.stakes,
                    assessment.rescues,
                ])
            const live = parts(assess(ring.gameState, me))
            expectEqual(parts(assessAs(ring, me)), live, 'the hands of the others were not read')

            const lines = describeAssessment(assessAs(ring, me)).join('\n')
            for (const player of ring.players) {
                expectEqual(lines.includes(player.name), true, `${player.name} is described`)
            }
        },
    },
    {
        name: 'Combat position: the stronger minion loses less, and the same fight is judged the same',
        run() {
            const ring = createRing([AttachDeck, AttachDeck])
            const [me] = ring.players
            const [strong, weak] = addMinions(ring, me, [
                { strength: 3, blood: 6 },
                { strength: 1, blood: 6 },
            ])
            const fighter = (minion: Minion): Fighter => ({
                profile: profileMinion(minion),
                pool: 5,
                hand: { cards: [] },
            })
            const before = forecastFight(fighter(strong), fighter(weak), DEFAULT_PROFILE)
            expectEqual(before.acting.loss < before.defending.loss, true, 'the stronger loses less')
            const mirrored = forecastFight(fighter(weak), fighter(strong), DEFAULT_PROFILE)
            expectEqual(
                mirrored.defending.loss,
                before.acting.loss,
                'whoever acts, the same fight costs the same',
            )
            expectEqual(
                JSON.stringify(forecastFight(fighter(strong), fighter(weak), DEFAULT_PROFILE)),
                JSON.stringify(before),
                'judged twice, judged the same',
            )
            attachInPlay(findAnyCard(me, GUARDIAN_ANGEL_ID), weak)
            expectEqual(
                forecastFight(fighter(strong), fighter(weak), DEFAULT_PROFILE).defending.loss <
                    before.defending.loss,
                true,
                'prevention takes damage off the loss',
            )
        },
    },
]
