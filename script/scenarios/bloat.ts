import { Vampire } from '@/shared/model/Card.ts'
import { OUST_POOL_GAIN } from '@/shared/const/model.ts'
import {
    BLOOD_DOLL_ID,
    ASYLUM_HUNTING_GROUND_ID,
    MINION_TAP_ID,
    VILLEIN_ID,
} from '@/shared/cardImpl/cardIds.ts'
import { AttachDeck } from '../attachDeck.ts'
import { MalkavDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { BotProfile, DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { Assessment, bleedOnPrey, outcomeOfTurn } from '@/shared/bot/utility/assessment.ts'
import { bloodChange } from '@/shared/bot/utility/bloat.ts'
import { gainOfBleeds, setupChance } from '@/shared/bot/utility/equity.ts'
import { describeAssessment } from '@/shared/bot/utility/describeAssessment.ts'
import { Scenario, ScenarioFailure, attachInPlay, expectEqual } from './helpers.ts'
import { findAnyCard } from './attachment.ts'
import {
    addMinions,
    assessAs,
    createRing,
    expectClose,
    holdOnly,
    snapshotAs,
} from './assessment.ts'
import { emptyHand } from './bounce.ts'
import { LIFE_IN_THE_CITY_ID, MINION_TAP_DECK, VILLEIN_DECK } from './catalog.ts'
import { planAs } from './plan.ts'

/**
 * Bloat: what each Methuselah takes back from the blood bank, and what it
 * changes in the plan. The prey and the others hold no card in hand, so the believed income is 0 and the
 * numbers can be worked out by hand.
 */

const dollOn = (vampire: Vampire) =>
    attachInPlay(findAnyCard(vampire.controller, BLOOD_DOLL_ID), vampire)

// Every Methuselah is worth its place in the ring: the stake of the prey is 1
const FLAT_STAKES: BotProfile = {
    ...DEFAULT_PROFILE,
    stakes: { ...DEFAULT_PROFILE.stakes, dangerGain: 0, leaderGain: 0, usefulGain: 0 },
}

const minionOf = (assessment: Assessment, vampire: Vampire) => {
    const found = assessment.table.me.minions.find(minion => minion.oid == vampire.oid)
    if (!found) {
        throw new ScenarioFailure(`No profile for ${vampire.name}`)
    }
    return found
}

export const BLOAT_SCENARIOS: Scenario[] = [
    {
        name: 'Bloat: what is in play is public, a Blood Doll carries the blood of its vampire to the pool and a hunting ground puts blood back',
        run() {
            const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
            const [me, prey] = ring.players
            holdOnly(ring, me, [])
            emptyHand(ring.gameState, prey)
            const [theirs] = addMinions(ring, prey, [{ blood: 1, locked: true }])
            theirs.minionAttrs.capacity = 6
            const bloat = () => assessAs(ring, me).bloat[prey.oid]
            expectEqual(bloat().pool + bloat().blood, 0, 'nothing in play, nothing regained')

            dollOn(theirs)
            expectEqual(bloat().pool, 0, 'a vampire does not give the blood it keeps')
            theirs.blood = 3
            expectClose(
                bloat().pool,
                1 / 3,
                'one blood above it, spread over the turns looked ahead',
            )
            theirs.blood = 5
            expectClose(bloat().pool, 1, 'a Doll moves one blood a turn')
            expectEqual(bloat().blood, 0, 'and puts none back')

            theirs.blood = 1
            ring.gameState.moveCardToRegion(findAnyCard(prey, ASYLUM_HUNTING_GROUND_ID), prey.ready)
            expectClose(bloat().blood, 1, 'the ground puts a blood on the vampire')
            expectClose(bloat().pool, 1, 'which the Doll carries over: 1/3 and the 1 put back')
        },
    },
    {
        name: 'Bloat: my hand is read exactly, the hand of another is believed from the cards it showed',
        run() {
            const ring = createRing([MalkavDeck, MalkavDeck, MalkavDeck])
            const [me, prey] = ring.players
            const [mine] = addMinions(ring, me, [{ blood: 1 }])
            mine.minionAttrs.capacity = 5
            holdOnly(ring, me, [LIFE_IN_THE_CITY_ID])
            const next = () => assessAs(ring, me).bloat[me.oid].turns[0]
            expectClose(next().blood, 1, 'Life in the City puts a blood back')
            mine.blood = 5
            expectEqual(next().blood, 0, 'with no room for it, nothing')
            mine.blood = 1
            holdOnly(ring, me, [])
            expectEqual(next().blood, 0, 'with no card, nothing')

            const held = prey.hand.cards.length
            const believed = assessAs(ring, me).bloat[prey.oid]
            const { opponentPrior, bloat } = DEFAULT_PROFILE
            expectClose(
                believed.pool,
                Math.min(1, (opponentPrior.density.poolGain ?? 0) * held) * bloat.poolPerCard,
                'the pool of the cards it may hold, one is played per turn',
            )
            expectEqual(believed.pool > 0, true, 'a hand of the others is worth something')
        },
    },
    {
        name: 'Bloat: a bleed on a Methuselah that takes pool back only counts above what it takes back, an oust is not eaten',
        run() {
            const board = (doll: boolean, pool: number) => {
                const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
                const [me, prey] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 3 }])
                const [theirs] = addMinions(ring, prey, [{ blood: 4, locked: true }])
                holdOnly(ring, me, [])
                emptyHand(ring.gameState, prey)
                prey.pool = pool
                if (doll) {
                    dollOn(theirs)
                }
                const assessment = assessAs(ring, me)
                const gain = gainOfBleeds(
                    assessment,
                    bleedOnPrey(assessment, [minionOf(assessment, mine)]),
                )
                return { gain, taken: gain.drain / assessment.stakes[prey.oid].weight }
            }
            expectClose(board(false, 10).taken, 3, 'a bleed of 3 takes 3')
            expectClose(
                board(true, 10).taken,
                2.5,
                'the pool it takes back eats half of the first point',
            )
            const lethal = board(true, 3)
            expectClose(lethal.taken, 3, 'the pool a Methuselah is ousted with does not come back')
            expectEqual(lethal.gain.oust > 0, true, 'and it is an oust')
        },
    },
    {
        name: 'Bloat: what I take back each turn softens the pool I lose to the lunge of my predator, not the chance of being ousted',
        run() {
            const board = (doll: boolean) => {
                const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
                const [me, , predator] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 1, blood: 4 }])
                addMinions(ring, predator, [{ bleed: 4 }, { bleed: 4 }])
                holdOnly(ring, me, [])
                me.pool = 12
                if (doll) {
                    dollOn(mine)
                }
                const assessment = assessAs(ring, me)
                return outcomeOfTurn(assessment, {
                    actors: [],
                    reserved: [minionOf(assessment, mine)],
                })
            }
            const bare = board(false)
            const dolled = board(true)
            expectClose(
                dolled.chanceOfBeingOusted,
                bare.chanceOfBeingOusted,
                'the master phase is after the lunge: the ouster is the same',
                1e-9,
            )
            expectClose(dolled.expectedLoss, bare.expectedLoss, 'so is the pool taken', 1e-9)
            expectClose(bare.lastingLoss, bare.expectedLoss, 'with nothing to take back, all lasts')
            expectEqual(
                dolled.lastingLoss < dolled.expectedLoss - 0.3,
                true,
                `part of it is made good ( ${dolled.lastingLoss} of ${dolled.expectedLoss} )`,
            )
        },
    },
    {
        name: 'Bloat: the blood a Blood Doll carries to the pool within the horizon is worth a point of pool, the rest the price of blood',
        run() {
            const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
            const [me] = ring.players
            const [plain, carrier] = addMinions(ring, me, [{ blood: 2 }, { blood: 2 }])
            dollOn(carrier)
            const worth = (vampire: Vampire, delta: number) => {
                const table = snapshotAs(ring, me)
                const minion = table.me.minions.find(candidate => candidate.oid == vampire.oid)
                if (!minion) {
                    throw new ScenarioFailure(`No profile for ${vampire.name}`)
                }
                return bloodChange(DEFAULT_PROFILE, minion, delta)
            }
            expectClose(worth(plain, 1), 0.5, 'a blood is worth half a point of pool')
            expectClose(worth(carrier, 1), 1, 'one a Doll carries over is a point of pool')
            expectClose(worth(carrier, -1), -0.5, 'but the blood it keeps is only blood')
            carrier.blood = 3
            expectClose(worth(carrier, -1), -1, 'losing one it would carry costs as much')
            carrier.blood = 6
            expectClose(worth(carrier, 1), 0.5, 'past what a Doll carries in 3 turns it is blood')
        },
    },
    {
        name: 'Turn plan: a vampire that carries a Blood Doll hunts for more, the blood is pool a turn later',
        run() {
            const board = (doll: boolean) => {
                const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
                const [me] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 0, blood: 2 }])
                mine.minionAttrs.capacity = 6
                mine.vampireAttrs.hunt = 1
                if (doll) {
                    dollOn(mine)
                }
                holdOnly(ring, me, [])
                return planAs(ring, me).actions[0]
            }
            const bare = board(false)
            const dolled = board(true)
            expectEqual(bare?.kind, 'hunt', 'it hunts')
            expectClose(bare?.value ?? 0, 0.5, 'a blood')
            expectEqual(dolled?.kind, 'hunt', 'and with a Doll')
            expectClose(dolled?.value ?? 0, 1, 'a point of pool, a turn later')
        },
    },
    {
        name: 'Turn plan: a small bleed on a Methuselah that takes pool back is not worth the minion, which hunts instead',
        run() {
            const board = (dolls: number) => {
                const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
                const [me, prey] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 2, blood: 3 }])
                mine.minionAttrs.capacity = 8
                mine.vampireAttrs.hunt = 3
                const theirs = addMinions(ring, prey, [
                    { blood: 4, locked: true },
                    { blood: 4, locked: true },
                ])
                theirs.slice(0, dolls).forEach(dollOn)
                holdOnly(ring, me, [])
                emptyHand(ring.gameState, prey)
                prey.pool = 10
                return planAs(ring, me, { profile: FLAT_STAKES }).actions[0]?.kind
            }
            expectEqual(board(0), 'bleed', 'against a prey that takes nothing back, it bleeds')
            expectEqual(board(2), 'hunt', 'against one that takes 2 back, the bleed is half eaten')
        },
    },
    {
        name: 'Bloat: a Minion Tap in my hand counts the blood of my richest vampire at what it is worth less than pool',
        run() {
            const ring = createRing([MINION_TAP_DECK, MINION_TAP_DECK, MINION_TAP_DECK])
            const [me] = ring.players
            addMinions(ring, me, [{ blood: 4 }, { blood: 2 }])
            holdOnly(ring, me, [])
            expectEqual(assessAs(ring, me).bloat[me.oid].pool, 0, 'no card, nothing')
            holdOnly(ring, me, [MINION_TAP_ID])
            const { poolValue, bloodValue } = DEFAULT_PROFILE.plan
            const { turns } = assessAs(ring, me).bloat[me.oid]
            expectClose(
                turns[0].pool,
                (4 - DEFAULT_PROFILE.bloat.keep) * (poolValue - bloodValue),
                'the blood of the richest, above what it keeps, less what the blood is worth',
            )
            expectEqual(turns[1].pool, 0, 'a card is played once')
        },
    },
    {
        name: 'Bloat: a Villein in my hand counts at most 5 blood of my richest vampire',
        run() {
            const ring = createRing([VILLEIN_DECK, VILLEIN_DECK, VILLEIN_DECK])
            const [me] = ring.players
            const [mine] = addMinions(ring, me, [{ blood: 8 }, { blood: 2 }])
            holdOnly(ring, me, [VILLEIN_ID])
            const { poolValue, bloodValue } = DEFAULT_PROFILE.plan
            const { keep } = DEFAULT_PROFILE.bloat
            const pool = () => assessAs(ring, me).bloat[me.oid].turns[0].pool
            expectClose(pool(), 5 * (poolValue - bloodValue), 'five of the eight')
            mine.blood = 4
            expectClose(
                pool(),
                (4 - keep) * (poolValue - bloodValue),
                'a vampire of 4 is not drained to 0: it keeps some',
            )
            mine.blood = keep
            expectEqual(pool(), 0, 'and one at what it keeps is not drained at all')
        },
    },
    {
        name: 'Bloat: it is a schedule, a Doll moves what its vampire holds and then stops',
        run() {
            const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
            const [me, prey] = ring.players
            holdOnly(ring, me, [])
            emptyHand(ring.gameState, prey)
            const [theirs] = addMinions(ring, prey, [{ blood: 1, locked: true }])
            theirs.minionAttrs.capacity = 6
            dollOn(theirs)
            const pools = () => assessAs(ring, me).bloat[prey.oid].turns.map(income => income.pool)
            expectEqual(pools().join(), '0,0,0', 'a vampire does not give the blood it keeps')
            theirs.blood = 3
            expectEqual(
                pools().join(),
                '1,0,0',
                'one blood above it is moved on the first turn, then nothing',
            )
            theirs.blood = 4
            expectEqual(pools().join(), '1,1,0', 'two blood last two turns')
            theirs.blood = 7
            expectEqual(pools().join(), '1,1,1', 'with more it moves one a turn')
            ring.gameState.moveCardToRegion(findAnyCard(prey, ASYLUM_HUNTING_GROUND_ID), prey.ready)
            theirs.blood = 1
            expectEqual(pools().join(), '1,1,1', 'a ground puts a blood back every turn')
        },
    },
    {
        name: 'Bloat: a card of my hand is played once, two in a turn when one of them is a trifle',
        run() {
            const deck = <DeckList>{ ...VILLEIN_DECK, [LIFE_IN_THE_CITY_ID]: 4 }
            const ring = createRing([deck, deck, deck])
            const [me] = ring.players
            const [mine] = addMinions(ring, me, [{ blood: 8 }])
            mine.minionAttrs.capacity = 10
            const turns = () => assessAs(ring, me).bloat[me.oid].turns
            const { poolValue, bloodValue } = DEFAULT_PROFILE.plan
            holdOnly(ring, me, [VILLEIN_ID, VILLEIN_ID])
            expectClose(
                turns()[0].pool,
                6 * (poolValue - bloodValue),
                'two Villeins are trifles: both in one turn, 5 and then what is left of the 3 above the 2 it keeps',
            )
            expectEqual(turns()[1].pool, 0, 'and nothing is left for the next one')
            mine.blood = 1
            holdOnly(ring, me, [LIFE_IN_THE_CITY_ID, LIFE_IN_THE_CITY_ID, LIFE_IN_THE_CITY_ID])
            expectEqual(
                turns()
                    .map(income => income.blood)
                    .join(),
                '2,1,0',
                'Life in the City is a trifle: two the first turn, the third the next',
            )
            mine.blood = 3
            holdOnly(ring, me, [VILLEIN_ID, LIFE_IN_THE_CITY_ID])
            expectEqual(
                turns()[0].blood,
                1,
                'a Villein and a Life in the City: both on the first turn',
            )
            expectClose(
                turns()[0].pool,
                1 * (poolValue - bloodValue),
                'the Villein takes the blood left',
            )
        },
    },
    {
        name: 'Bloat: what a bleed meets is what the prey takes back before my next turn, not an average over the horizon',
        run() {
            const taken = (blood: number) => {
                const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
                const [me, prey] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 3 }])
                const [theirs] = addMinions(ring, prey, [{ blood, locked: true }])
                holdOnly(ring, me, [])
                emptyHand(ring.gameState, prey)
                prey.pool = 10
                dollOn(theirs)
                const assessment = assessAs(ring, me)
                const gain = gainOfBleeds(
                    assessment,
                    bleedOnPrey(assessment, [minionOf(assessment, mine)]),
                )
                return gain.drain / assessment.stakes[prey.oid].weight
            }
            expectClose(
                taken(5),
                2.5,
                'a Doll with blood for every turn moves one before my next turn',
            )
            expectClose(
                taken(3),
                2.5,
                'with one blood above what it keeps it is the same: moved at once, then nothing',
            )
            expectClose(taken(2), 3, 'a vampire at what it keeps gives nothing')
        },
    },
    {
        name: 'Bloat: a bleed that leaves its prey within reach of the same bleeds next turn sets up an oust, unless the income lifts the pool out of reach',
        run() {
            const board = (pool: number, dolls: number) => {
                const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
                const [me, prey] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 3 }])
                const theirs = addMinions(ring, prey, [
                    { blood: 4, locked: true },
                    { blood: 4, locked: true },
                ])
                theirs.slice(0, dolls).forEach(dollOn)
                holdOnly(ring, me, [])
                emptyHand(ring.gameState, prey)
                prey.pool = pool
                const assessment = assessAs(ring, me)
                return gainOfBleeds(
                    assessment,
                    bleedOnPrey(assessment, [minionOf(assessment, mine)]),
                )
            }
            const oust = DEFAULT_PROFILE.vpValue + OUST_POOL_GAIN
            const { setup } = DEFAULT_PROFILE.bloat
            expectClose(
                board(5, 0).setup,
                oust * setup,
                '5 pool, a bleed of 3: 2 left, in reach of the same',
            )
            expectEqual(board(5, 0).oust, 0, 'it is not an oust now')
            expectClose(board(7, 0).setup, 0, '7 pool: 4 left, out of reach')
            expectClose(board(5, 1).setup, oust * setup, 'with 1 back: 3 left, still in reach')
            expectClose(board(5, 2).setup, 0, 'with 2 back: 4 left, out of reach')
            expectClose(board(3, 0).setup, 0, 'a bleed that ousts sets up nothing, it is the oust')
            expectEqual(board(3, 0).oust > 0, true, 'which is counted as one')
        },
    },
    {
        name: 'Bloat: what a bleed sets up is what it adds to the chance of the oust next turn, the chance that was there without it is not its doing',
        run() {
            const outcome = (p: number, loss: number) => ({
                p,
                loss,
                blocked: 0,
                bounced: 0,
                bouncedLoss: 0,
                landed: 1,
            })
            const result = (outcomes: ReturnType<typeof outcome>[]) => ({
                attackers: 1,
                outcomes,
                expectedLoss: 0,
                expectedBounced: 0,
                chanceOfBounce: 0,
                blockedShare: 0,
            })
            const sure = result([outcome(1, 3)])
            expectClose(setupChance(sure, 5, 0), 1, 'a sure bleed of 3 on 5: in reach next turn')
            expectClose(setupChance(sure, 5, 2), 0, 'the pool it takes back lifts it out of reach')
            expectClose(setupChance(sure, 3, 0), 0, 'a bleed that ousts is not a setup')
            const wide = result([outcome(0.5, 1), outcome(0.5, 6)])
            expectClose(
                setupChance(wide, 5, 0),
                0,
                'a bleed of 1 changes nothing: the 6 oust either way',
            )
            const mixed = result([outcome(0.5, 3), outcome(0.5, 1)])
            expectClose(
                setupChance(mixed, 5, 0),
                0.25,
                'only the 3 leaves it within reach of a 3, half of the time',
            )
        },
    },
    {
        name: 'Turn plan: a drain that sets up an oust for the next turn is made, one that the income would erase is not',
        run() {
            const board = (pool: number, dolls: number) => {
                const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
                const [me, prey] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 2, blood: 1 }])
                mine.minionAttrs.capacity = 8
                mine.vampireAttrs.hunt = 6
                const theirs = addMinions(ring, prey, [
                    { blood: 4, locked: true },
                    { blood: 4, locked: true },
                ])
                theirs.slice(0, dolls).forEach(dollOn)
                holdOnly(ring, me, [])
                emptyHand(ring.gameState, prey)
                prey.pool = pool
                return planAs(ring, me, { profile: FLAT_STAKES }).actions[0]?.kind
            }
            expectEqual(
                board(10, 0),
                'hunt',
                'far from an ouster the bleed is worth less than the hunt',
            )
            expectEqual(board(3, 0), 'bleed', 'a prey of 3 left with 1 is in reach: it bleeds')
            expectEqual(board(3, 2), 'hunt', 'with 2 back it is out of reach again, and half eaten')
        },
    },
    {
        name: 'Bloat: blood that a card of my hand taps is pool soon, up to what the card takes',
        run() {
            const ring = createRing([VILLEIN_DECK, VILLEIN_DECK, VILLEIN_DECK])
            const [me] = ring.players
            const [mine] = addMinions(ring, me, [{ blood: 2 }])
            mine.minionAttrs.capacity = 12
            const worth = (delta: number) => {
                const table = snapshotAs(ring, me)
                const minion = table.me.minions.find(candidate => candidate.oid == mine.oid)
                if (!minion) {
                    throw new ScenarioFailure('No profile for the vampire')
                }
                return bloodChange(DEFAULT_PROFILE, minion, delta, assessAs(ring, me).bloat[me.oid])
            }
            holdOnly(ring, me, [])
            expectClose(worth(1), 0.5, 'with nothing in hand a blood is worth half a point of pool')
            holdOnly(ring, me, [VILLEIN_ID])
            expectClose(worth(1), 1, 'a Villein will turn it into pool')
            mine.blood = 7
            expectClose(worth(1), 0.5, 'past the 5 that a Villein takes it is blood again')
            holdOnly(ring, me, [MINION_TAP_ID])
            expectClose(worth(1), 1, 'a Minion Tap takes any amount')
            mine.blood = 1
            expectClose(worth(1), 0.5, 'but not what the vampire keeps for itself')
            mine.blood = 2
            expectClose(worth(1), 1, 'only what is above it')
        },
    },
    {
        name: 'Turn plan: with a Villein in hand a hunt is worth a point of pool for each blood, which is pool soon',
        run() {
            const board = (hand: string[]) => {
                const ring = createRing([VILLEIN_DECK, VILLEIN_DECK, VILLEIN_DECK])
                const [me] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 0, blood: 2 }])
                mine.minionAttrs.capacity = 8
                mine.vampireAttrs.hunt = 1
                holdOnly(ring, me, hand)
                return planAs(ring, me).actions[0]
            }
            expectClose(board([])?.value ?? 0, 0.5, 'a blood')
            expectClose(board([VILLEIN_ID])?.value ?? 0, 1, 'a point of pool, soon')
        },
    },
    {
        name: 'Bloat: it prints',
        run() {
            const ring = createRing([VILLEIN_DECK, VILLEIN_DECK, VILLEIN_DECK])
            const [me, prey] = ring.players
            addMinions(ring, me, [{ blood: 3 }])
            const [theirs] = addMinions(ring, prey, [{ blood: 4, locked: true }])
            dollOn(theirs)
            holdOnly(ring, me, [VILLEIN_ID])
            const lines = describeAssessment(assessAs(ring, me)).join('\n')
            expectEqual(
                lines.includes('from the blood bank, turn by turn: '),
                true,
                'the schedule is described',
            )
            expectEqual(
                lines.includes('its hand turns 5.00 blood of a vampire'),
                true,
                'so is the hand',
            )
        },
    },
]
