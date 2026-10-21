import { Player } from '@/shared/model/Player.ts'
import { Vampire } from '@/shared/model/Card.ts'
import { TurnPhase, TurnSequence } from '@/shared/const/model.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { chooseThroughView } from '@/shared/bot/playerView.ts'
import { applyOption, getDecisionPoint } from '@/shared/bot/referee.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { BotOption, DecisionKind, DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'
import { BotProfile, DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { standingOf } from '@/shared/bot/utility/cycle.ts'
import { HandEvaluator } from '@/shared/bot/utility/hand.ts'
import { judgeMaster } from '@/shared/bot/utility/masterPhase.ts'
import {
    Ring,
    MinionSetup,
    addMinions,
    assessAs,
    createRing,
    expectClose,
    holdOnly,
} from './assessment.ts'
import { sealLibrary } from './bounce.ts'
import { NOSFERATU_DECK } from './nosferatu.ts'
import {
    Scenario,
    ScenarioFailure,
    attachInPlay,
    expectEqual,
    findCard,
    readySpecific,
} from './helpers.ts'
import {
    ALINE_ID,
    ASYLUM_HUNTING_GROUND_ID,
    BARRENS_ID,
    BLOOD_DOLL_ID,
    CARVERS_ID,
    DREAMS_OF_THE_SPHINX_ID,
    ELDER_LIBRARY_ID,
    FAME_ID,
    FRONTAL_ASSAULT_ID,
    GUARDIAN_ANGEL_ID,
    HAVEN_UNCOVERED_ID,
    KRCG_ID,
    LABYRINTH_ID,
    LENNY_ID,
    LIFE_IN_THE_CITY_ID,
    MINION_TAP_ID,
    THEO_BELL_ID,
    VESSEL_ID,
    VILLEIN_ID,
    WARZONE_ID,
    WIDER_VIEW_ID,
} from '../cardIds.ts'

/**
 * The master phase and the unlock phase of the utility agent: which master card is played and on which vampire,
 * which blood is moved to the pool, which vampire a hunting ground feeds. Four Methuselahs with no minion for
 * the others, so the numbers can be read.
 */

export const MASTER_DECK = <DeckList>{
    ...NOSFERATU_DECK,
    [DREAMS_OF_THE_SPHINX_ID]: 1,
    [FAME_ID]: 1,
    [HAVEN_UNCOVERED_ID]: 1,
    [CARVERS_ID]: 1,
    [FRONTAL_ASSAULT_ID]: 1,
    [LIFE_IN_THE_CITY_ID]: 2,
    [VILLEIN_ID]: 2,
    [MINION_TAP_ID]: 2,
    [ELDER_LIBRARY_ID]: 1,
    [ASYLUM_HUNTING_GROUND_ID]: 1,
    [BARRENS_ID]: 1,
    [WIDER_VIEW_ID]: 1,
    [LABYRINTH_ID]: 1,
    [KRCG_ID]: 1,
    [GUARDIAN_ANGEL_ID]: 1,
    [VESSEL_ID]: 1,
}

type Ready = {
    blood: number
    capacity?: number
    // A vampire of the crypt, by id ( for a clan )
    id?: string
}

type MasterSetup = {
    phase?: 'master' | 'unlock'
    hand?: string[]
    ready: Ready[]
    // Cards in play, not on a vampire
    inPlay?: string[]
    // Cards put on the vampire of this index ( in the order of `ready` )
    attached?: [number, string][]
    pool?: number
    prey?: MinionSetup[]
    predator?: MinionSetup[]
    // The capacity of every vampire of the uncontrolled region
    uncontrolled?: number
}

export type MasterTurn = { ring: Ring; me: Player; vampires: Vampire[] }

export function masterTurn(setup: MasterSetup): MasterTurn {
    const players = 4
    const ring = createRing(Array.from({ length: players }, () => MASTER_DECK))
    const { gameState } = ring
    const me = ring.players[0]
    const vampires = setup.ready.map(ready =>
        ready.id ?
            readySpecific(gameState, me, ready.id, ready.blood)
        :   addMinions(ring, me, [{ blood: ready.blood }])[0],
    )
    for (const [index, ready] of setup.ready.entries()) {
        vampires[index].minionAttrs.capacity = ready.capacity ?? 8
    }
    for (const vampire of me.vampiresInUncontrolled) {
        vampire.minionAttrs.capacity = setup.uncontrolled ?? vampire.minionAttrs.capacity
    }
    addMinions(ring, ring.players[1], setup.prey ?? [])
    addMinions(ring, ring.players[players - 1], setup.predator ?? [])
    for (const player of ring.players) {
        holdOnly(ring, player, player == me ? (setup.hand ?? []) : [])
    }
    for (const id of setup.inPlay ?? []) {
        gameState.moveCardToRegion(findCard(me, id), me.ready)
    }
    for (const [index, id] of setup.attached ?? []) {
        attachInPlay(findCard(me, id), vampires[index])
    }
    for (const player of ring.players) {
        sealLibrary(gameState, player)
    }
    me.pool = setup.pool ?? 30
    gameState.turnNumber = 5
    gameState.turnPhaseIndex = TurnSequence.indexOf(
        setup.phase == 'unlock' ? TurnPhase.Unlock : TurnPhase.Master,
    )
    gameState.turnResources.unlocked = true
    gameState.turnResources.mpa = 1
    gameState.activePlayerIndex = gameState.competingPlayers.indexOf(me)
    return { ring, me, vampires }
}

export function decisionOf(turn: MasterTurn): DecisionPoint {
    const decision = getDecisionPoint(turn.ring.gameState, turn.me)
    if (!decision) {
        throw new ScenarioFailure('No decision point')
    }
    return decision
}

// Plays the phase with the utility agent until it ends it: what it did
export function playPhase(
    turn: MasterTurn,
    kind: DecisionKind = DecisionKind.Master,
    profile: BotProfile = DEFAULT_PROFILE,
): BotOption[] {
    const agent = new UtilityAgent(MASTER_DECK, profile)
    const done: BotOption[] = []
    for (let step = 0; step < 12; step++) {
        const decision = decisionOf(turn)
        // A card played is put away before the phase goes on
        if (decision.kind == DecisionKind.Cleanup) {
            applyOption(decision, decision.options[0])
            continue
        }
        if (decision.kind != kind) {
            throw new ScenarioFailure(`Expected ${kind}, got ${decision.kind}`)
        }
        const option = chooseThroughView(decision, agent)
        if (option.type == 'endPhase') {
            return done
        }
        done.push(option)
        applyOption(decision, option)
    }
    throw new ScenarioFailure('The phase does not end')
}

// The top candidate of the master phase, through the view of the agent, and its terms
function best(turn: MasterTurn, profile: BotProfile = DEFAULT_PROFILE) {
    return judged(turn, profile).candidates[0]?.parts ?? {}
}

function judged(turn: MasterTurn, profile: BotProfile = DEFAULT_PROFILE) {
    const decision = decisionOf(turn)
    const assessment = assessAs(turn.ring, turn.me, profile)
    return judgeMaster(decision, assessment, standingOf(decision, assessment, MASTER_DECK))
}

function played(done: BotOption[]): string {
    return done
        .map(option =>
            option.type == 'playMaster' ? option.card.name
            : option.type == 'moveBlood' ? 'move'
            : option.type,
        )
        .join()
}

function expectPlay(done: BotOption[], card: string, vampire?: Vampire, amount?: number): void {
    const option = done[0]
    if (option?.type != 'playMaster' || option.card.name != card) {
        throw new ScenarioFailure(`Expected ${card} first, got ${played(done)}`)
    }
    if (vampire) {
        expectEqual(option.target?.oid, vampire.oid, `the vampire of ${card}`)
    }
    if (amount !== undefined) {
        expectEqual(option.amount, amount, `the blood of ${card}`)
    }
}

export const MASTER_PHASE_SCENARIOS: Scenario[] = [
    {
        name: 'Master: a Life in the City goes on the vampire with no blood, which is spared a hunt',
        run() {
            const turn = masterTurn({
                hand: [LIFE_IN_THE_CITY_ID],
                ready: [{ blood: 0 }, { blood: 3 }],
            })
            expectClose(
                best(turn).blood,
                0.5 + DEFAULT_PROFILE.plan.cardAction,
                'the blood and the hunt spared',
            )
            const done = playPhase(turn)
            expectEqual(done.length, 1, 'plays')
            expectPlay(done, 'Life in the City', turn.vampires[0])
            expectEqual(turn.vampires[0].blood, 1, 'its blood')
        },
    },
    {
        name: 'Master: a Life in the City for a vampire that holds blood is kept for the one that does not',
        run() {
            const turn = masterTurn({
                hand: [LIFE_IN_THE_CITY_ID],
                ready: [{ blood: 3 }, { blood: 4 }],
            })
            expectEqual(played(playPhase(turn)), '', 'a blood is worth less than the card')
        },
    },
    {
        name: 'Master: a Villein takes the most blood a vampire can give, from the richest one, and the blood it keeps stays',
        run() {
            const turn = masterTurn({ hand: [VILLEIN_ID], ready: [{ blood: 8 }, { blood: 4 }] })
            const { plan } = DEFAULT_PROFILE
            expectClose(best(turn).pool, 5 * (plan.poolValue - plan.bloodValue), 'the pool gained')
            const pool = turn.me.pool
            const done = playPhase(turn)
            expectEqual(done.length, 1, 'plays')
            expectPlay(done, 'Villein', turn.vampires[0], 5)
            expectEqual(turn.me.pool, pool + 5, 'pool')
            expectEqual(turn.vampires[0].blood, 3, 'blood kept')
        },
    },
    {
        name: 'Master: a vampire keeps the blood it needs: no Villein on a vampire that would drop under it',
        run() {
            const turn = masterTurn({ hand: [VILLEIN_ID], ready: [{ blood: 3 }] })
            expectEqual(played(playPhase(turn)), '', 'plays')
        },
    },
    {
        name: 'Master: a second Villein on the same vampire costs a pool more, which comes off its worth',
        run() {
            const turn = masterTurn({
                hand: [VILLEIN_ID],
                ready: [{ blood: 8 }],
                attached: [[0, VILLEIN_ID]],
            })
            const { plan } = DEFAULT_PROFILE
            expectClose(
                best(turn).cost,
                -(plan.spentCard + plan.caution),
                'the card and the pool of the second one',
            )
        },
    },
    {
        name: 'Master: a Minion Tap takes any amount down to the blood kept',
        run() {
            const turn = masterTurn({ hand: [MINION_TAP_ID], ready: [{ blood: 6 }] })
            expectPlay(playPhase(turn), 'Minion Tap', turn.vampires[0], 4)
        },
    },
    {
        name: 'Master: a Blood Doll goes on the vampire that holds the most above the blood kept',
        run() {
            const turn = masterTurn({ hand: [BLOOD_DOLL_ID], ready: [{ blood: 0 }, { blood: 7 }] })
            const { plan, cards, master } = DEFAULT_PROFILE
            expectClose(
                best(turn).carry,
                cards.stay * (plan.poolValue - plan.bloodValue),
                'a blood a turn over the turns it serves',
            )
            expectPlay(playPhase(turn), 'Blood Doll', turn.vampires[1])
            const poor = masterTurn({ hand: [BLOOD_DOLL_ID], ready: [{ blood: 0 }] })
            expectClose(
                best(poor).carry,
                (master.regain * cards.stay - DEFAULT_PROFILE.bloat.keep) *
                    (plan.poolValue - plan.bloodValue),
                'a vampire with none counts the blood it will hunt, above what it keeps',
            )
        },
    },
    {
        name: 'Master: a Blood Doll stays on its vampire for the game, so the blood it will carry is worth a play even from an empty vampire',
        run() {
            const alone = masterTurn({ hand: [BLOOD_DOLL_ID], ready: [{ blood: 0 }] })
            expectPlay(playPhase(alone), 'Blood Doll', alone.vampires[0])
            const company = masterTurn({
                hand: [BLOOD_DOLL_ID, WIDER_VIEW_ID],
                ready: [{ blood: 0 }],
                uncontrolled: 4,
            })
            expectEqual(
                played(playPhase(company)).startsWith('Blood Doll'),
                true,
                'with another card',
            )
        },
    },
    {
        name: 'Master: the blood the Dolls already move is spoken for, a second Doll on the same blood is not worth it',
        run() {
            const alone = masterTurn({ hand: [BLOOD_DOLL_ID], ready: [{ blood: 4 }] })
            expectPlay(playPhase(alone), 'Blood Doll', alone.vampires[0])
            const second = masterTurn({
                hand: [BLOOD_DOLL_ID, WIDER_VIEW_ID],
                ready: [{ blood: 3 }],
                attached: [[0, BLOOD_DOLL_ID]],
                uncontrolled: 4,
            })
            expectEqual(played(playPhase(second)), 'move', 'no second Doll, the one in play moves')
        },
    },
    {
        name: 'Master: the Doll moves a blood to the pool, down to the blood kept and never back',
        run() {
            const turn = masterTurn({ ready: [{ blood: 5 }], attached: [[0, BLOOD_DOLL_ID]] })
            const pool = turn.me.pool
            expectEqual(played(playPhase(turn)), 'move', 'moves')
            expectEqual(turn.me.pool, pool + 1, 'pool')
            expectEqual(turn.vampires[0].blood, 4, 'blood')
            const kept = masterTurn({ ready: [{ blood: 2 }], attached: [[0, BLOOD_DOLL_ID]] })
            expectEqual(played(playPhase(kept)), '', 'the blood kept stays')
        },
    },
    {
        name: 'Master: the Doll puts a pool back on a vampire with no blood, which is spared a hunt, and on no other',
        run() {
            const { plan } = DEFAULT_PROFILE
            const empty = masterTurn({ ready: [{ blood: 0 }], attached: [[0, BLOOD_DOLL_ID]] })
            const pool = empty.me.pool
            const parts = best(empty)
            expectClose(parts.pool, -plan.caution, 'the pool it costs')
            expectEqual(parts.blood > plan.cardAction, true, 'the hunt it spares and the blood')
            expectEqual(played(playPhase(empty)), 'move', 'moves')
            expectEqual(empty.me.pool, pool - 1, 'pool')
            expectEqual(empty.vampires[0].blood, 1, 'blood')
            const fed = masterTurn({ ready: [{ blood: 1 }], attached: [[0, BLOOD_DOLL_ID]] })
            expectEqual(played(playPhase(fed)), '', 'a vampire with blood keeps its hunt')
        },
    },
    {
        name: 'Master: no pool goes back to a vampire when the pool left lets my predator oust me',
        run() {
            const setup = (predator: MinionSetup[]) =>
                masterTurn({
                    ready: [{ blood: 0 }],
                    attached: [[0, BLOOD_DOLL_ID]],
                    pool: 3,
                    predator,
                })
            expectEqual(played(playPhase(setup([]))), 'move', 'a calm table')
            const threat = setup([{ bleed: 2 }])
            for (const vampire of threat.vampires) {
                vampire.isLocked = true
            }
            expectEqual(played(playPhase(threat)), '', 'under the threat')
        },
    },
    {
        name: 'Master: a vampire keeps more blood against a neighbour that fights hard, a Villein and a Doll leave it on it',
        run() {
            const fighter = (strength: number): MinionSetup[] => [
                { strength, bleed: 1, disciplines: { Potence: 1 } as never },
            ]
            const villein = (predator: MinionSetup[], prey: MinionSetup[] = []) =>
                masterTurn({ hand: [VILLEIN_ID], ready: [{ blood: 6 }], predator, prey })
            expectPlay(playPhase(villein([])), 'Villein', undefined, 4)
            expectPlay(playPhase(villein(fighter(1))), 'Villein', undefined, 3)
            expectPlay(playPhase(villein(fighter(4))), 'Villein', undefined, 2)
            expectPlay(playPhase(villein([], fighter(4))), 'Villein', undefined, 2)
            for (const both of [
                [...fighter(1), ...fighter(4)],
                [...fighter(4), ...fighter(1)],
            ]) {
                expectPlay(playPhase(villein(both)), 'Villein', undefined, 2)
            }
            const dolls = (predator: MinionSetup[]) =>
                masterTurn({ hand: [BLOOD_DOLL_ID], ready: [{ blood: 4 }], predator })
            expectPlay(playPhase(dolls([])), 'Blood Doll')
            expectPlay(playPhase(dolls(fighter(4))), 'Blood Doll')
            const doll = (predator: MinionSetup[]) =>
                masterTurn({ ready: [{ blood: 3 }], attached: [[0, BLOOD_DOLL_ID]], predator })
            expectEqual(played(playPhase(doll([]))), 'move', 'a calm table')
            expectEqual(played(playPhase(doll(fighter(4)))), '', 'a fighter next door')
        },
    },
    {
        name: 'Master: a trifle goes first, it gives back the master phase action for the other card',
        run() {
            const turn = masterTurn({ hand: [ELDER_LIBRARY_ID, VILLEIN_ID], ready: [{ blood: 4 }] })
            expectEqual(played(playPhase(turn)), 'Villein,Elder Library', 'order')
        },
    },
    {
        name: 'Master: an Elder Library is worth the hand it adds over the turns, less the card and its pool',
        run() {
            const turn = masterTurn({ hand: [ELDER_LIBRARY_ID], ready: [{ blood: 8 }] })
            const { master, plan } = DEFAULT_PROFILE
            const parts = best(turn)
            expectClose(parts.hand, master.handSize * master.stay, 'the hand size')
            expectClose(parts.cost, -(plan.spentCard + plan.caution), 'the card and the pool')
            expectPlay(playPhase(turn), 'Elder Library')
        },
    },
    {
        name: 'Master: a Wider View is played when the vampires of the uncontrolled region are too big to come, and not when a draw adds nothing',
        run() {
            const big = masterTurn({
                hand: [WIDER_VIEW_ID],
                ready: [{ blood: 8 }],
                uncontrolled: 11,
            })
            expectPlay(playPhase(big), 'Wider View')
            const small = masterTurn({
                hand: [WIDER_VIEW_ID],
                ready: [{ blood: 8 }],
                uncontrolled: 4,
            })
            expectEqual(played(playPhase(small)), '', 'the region is as good as a draw')
        },
    },
    {
        name: 'Master: the Barrens is played to cycle a Wider View that a draw would not make worth playing',
        run() {
            const both = masterTurn({
                hand: [BARRENS_ID, WIDER_VIEW_ID],
                ready: [{ blood: 8 }],
                uncontrolled: 4,
            })
            expectEqual(played(playPhase(both)), 'Barrens, The', 'the Barrens')
        },
    },
    {
        name: 'Master: a hunting ground is played for a vampire that has room, not when all are full',
        run() {
            const room = masterTurn({ hand: [WARZONE_ID], ready: [{ id: THEO_BELL_ID, blood: 5 }] })
            expectPlay(playPhase(room), 'Warzone Hunting Ground')
            const full = masterTurn({ hand: [WARZONE_ID], ready: [{ id: THEO_BELL_ID, blood: 8 }] })
            expectEqual(played(playPhase(full)), '', 'no room')
        },
    },
    {
        name: 'Master: a second hunting ground serves another vampire, a vampire gains from one a turn',
        run() {
            const one = masterTurn({
                hand: [WARZONE_ID],
                inPlay: [ASYLUM_HUNTING_GROUND_ID],
                ready: [
                    { id: THEO_BELL_ID, blood: 5 },
                    { id: ALINE_ID, blood: 8 },
                ],
            })
            expectEqual(played(playPhase(one)), '', 'only one vampire has room')
            const two = masterTurn({
                hand: [WARZONE_ID],
                inPlay: [ASYLUM_HUNTING_GROUND_ID],
                ready: [
                    { id: THEO_BELL_ID, blood: 5 },
                    { id: ALINE_ID, blood: 5 },
                ],
            })
            expectPlay(playPhase(two), 'Warzone Hunting Ground')
        },
    },
    {
        name: 'Master: The Labyrinth is played for the stealth it gives a Nosferatu over the turns',
        run() {
            const { master, plan } = DEFAULT_PROFILE
            const turn = masterTurn({ hand: [LABYRINTH_ID], ready: [{ id: LENNY_ID, blood: 5 }] })
            const parts = best(turn)
            expectClose(parts.standing, master.charge * master.stay, 'the stealth over the turns')
            expectClose(parts.cost, -(plan.spentCard + plan.caution), 'the card and the pool')
            expectPlay(playPhase(turn), 'Labyrinth, The')
        },
    },
    {
        name: 'Master: KRCG News Radio is worth what an intercept card of the hand is worth, on each turn it stays',
        run() {
            const { master } = DEFAULT_PROFILE
            const turn = masterTurn({
                hand: [KRCG_ID],
                ready: [{ blood: 5 }, { blood: 5 }],
                predator: [{ bleed: 3 }, { bleed: 3 }, { bleed: 3 }],
            })
            const assessment = assessAs(turn.ring, turn.me)
            const standing = standingOf(decisionOf(turn), assessment, MASTER_DECK)
            const card = new HandEvaluator(assessment, MASTER_DECK, turn.me).needs.defence.worth
            expectEqual(standing.defence > 0, true, 'an intercept is worth something')
            expectClose(standing.defence, card, 'the worth of a card held')
            expectClose(
                best(turn).standing,
                Math.min(1, standing.bleeds) * standing.defence * master.stay,
                'one use a turn, over the turns it stays',
            )
            expectPlay(playPhase(turn), 'KRCG News Radio')
        },
    },
    {
        name: 'Master: KRCG News Radio is worth nothing when no minion of mine could use it',
        run() {
            const turn = masterTurn({
                hand: [KRCG_ID],
                ready: [],
                predator: [{ bleed: 3 }, { bleed: 3 }, { bleed: 3 }],
            })
            expectEqual(best(turn).standing ?? 0, 0, 'its charge')
            expectEqual(played(playPhase(turn)), '', 'plays')
        },
    },
    {
        name: 'Master: a Guardian Angel is worth an intercept per bleed against me, shared by the vampires that can block',
        run() {
            const { cards } = DEFAULT_PROFILE
            const setup = (ready: Ready[]) =>
                masterTurn({
                    hand: [GUARDIAN_ANGEL_ID],
                    ready,
                    predator: [{ bleed: 3 }, { bleed: 3 }, { bleed: 3 }],
                })
            const shieldOf = (turn: MasterTurn) => {
                const { defence, bleeds } = standingOf(
                    decisionOf(turn),
                    assessAs(turn.ring, turn.me),
                    MASTER_DECK,
                )
                return (defence * bleeds) / turn.vampires.length
            }
            const prevention = cards.perPrevention
            const alone = setup([{ blood: 8 }])
            expectClose(
                best(alone).attached,
                cards.stay * (shieldOf(alone) + prevention),
                'a lone vampire',
            )
            expectPlay(playPhase(alone), 'Guardian Angel')
            const pair = setup([{ blood: 8 }, { blood: 8 }])
            expectClose(
                best(pair).attached,
                cards.stay * (shieldOf(pair) + prevention),
                'one of two vampires',
            )
        },
    },
    {
        name: 'Master: a card that costs pool is held back when the pool left lets my predator oust me',
        run() {
            const threat = masterTurn({
                hand: [ELDER_LIBRARY_ID],
                ready: [{ blood: 8 }],
                pool: 3,
                predator: [{ bleed: 2 }],
            })
            for (const vampire of threat.vampires) {
                vampire.isLocked = true
            }
            expectEqual(played(playPhase(threat)), '', 'plays under the threat')
            const calm = masterTurn({ hand: [ELDER_LIBRARY_ID], ready: [{ blood: 8 }], pool: 3 })
            expectPlay(playPhase(calm), 'Elder Library')
        },
    },
    {
        name: 'Unlock: a hunting ground feeds the vampire with no blood, the one it spares a hunt',
        run() {
            const turn = masterTurn({
                phase: 'unlock',
                inPlay: [ASYLUM_HUNTING_GROUND_ID],
                ready: [{ blood: 4 }, { blood: 0 }],
            })
            const done = playPhase(turn, DecisionKind.Unlock)
            expectEqual(done.length, 1, 'effects')
            const [effect] = optionsOfType(done, 'unlockEffect')
            expectEqual(effect?.vampire.oid, turn.vampires[1].oid, 'the vampire fed')
            expectEqual(turn.vampires[1].blood, 1, 'its blood')
        },
    },
    {
        name: 'Unlock: of two vampires that gain the same, the emptier one is fed',
        run() {
            for (const bloods of [
                [5, 3],
                [3, 5],
            ]) {
                const turn = masterTurn({
                    phase: 'unlock',
                    inPlay: [ASYLUM_HUNTING_GROUND_ID],
                    ready: bloods.map(blood => ({ blood })),
                })
                const [effect] = optionsOfType(playPhase(turn, DecisionKind.Unlock), 'unlockEffect')
                expectEqual(
                    effect?.vampire.blood,
                    4,
                    `the emptier of ${bloods.join(' and ')} is fed`,
                )
            }
        },
    },
    {
        name: 'Unlock: a Vessel moves a blood to the pool in the unlock phase, not in the master phase',
        run() {
            const turn = masterTurn({
                phase: 'unlock',
                ready: [{ blood: 5 }],
                attached: [[0, VESSEL_ID]],
            })
            const pool = turn.me.pool
            expectEqual(played(playPhase(turn, DecisionKind.Unlock)), 'move', 'moves')
            expectEqual(turn.me.pool, pool + 1, 'pool')
            const master = masterTurn({ ready: [{ blood: 5 }], attached: [[0, VESSEL_ID]] })
            expectEqual(played(playPhase(master)), '', 'the master phase leaves it')
        },
    },
    {
        name: 'Master: the hostages of a Carver are worth the way back from torpor of the small vampires that may go there',
        run() {
            const { master, plan } = DEFAULT_PROFILE
            const turn = masterTurn({
                hand: [CARVERS_ID],
                ready: [{ blood: 4 }],
                prey: [{ blood: 3 }, { blood: 3 }],
            })
            const [small, large] = turn.ring.players[1].vampiresReady
            small.minionAttrs.capacity = 3
            large.minionAttrs.capacity = 7
            expectClose(best(turn).hostage, master.torpor * plan.torporReturn, 'the small vampire')
            small.blood = 0
            expectClose(
                best(turn).hostage,
                master.torpor * 3 * plan.torporReturn,
                'an empty one is likelier to go',
            )
        },
    },
    {
        name: 'Master: a Carver takes my small vampires hostage too, which comes off its worth',
        run() {
            const turn = masterTurn({
                hand: [CARVERS_ID],
                ready: [{ blood: 3, capacity: 3 }],
                prey: [{ blood: 3 }],
            })
            turn.ring.players[1].vampiresReady[0].minionAttrs.capacity = 3
            expectClose(best(turn).hostage ?? 0, 0, 'as many of mine as of theirs')
        },
    },
    {
        name: 'Master: a Frontal Assault is worth the pool its Methuselah gains when the prey loses a minion, as likely as it goes to torpor',
        run() {
            const { master, plan } = DEFAULT_PROFILE
            const turn = masterTurn({
                hand: [FRONTAL_ASSAULT_ID],
                ready: [{ blood: 4 }],
                prey: [{ blood: 8 }, { blood: 0 }],
            })
            for (const vampire of turn.ring.players[1].vampiresReady) {
                vampire.minionAttrs.capacity = 8
            }
            expectClose(
                best(turn).preyLoss,
                master.torpor * (1 + 3) * plan.poolValue,
                'the full one and the empty one',
            )
            const alone = masterTurn({ hand: [FRONTAL_ASSAULT_ID], ready: [{ blood: 4 }] })
            expectEqual(best(alone).preyLoss ?? 0, 0, 'no prey minion')
        },
    },
    {
        name: 'Master: the permission to fight is worth the loss of the minion fought, for the fights my minions start and win',
        run() {
            const { master, combat } = DEFAULT_PROFILE
            const turn = masterTurn({
                hand: [HAVEN_UNCOVERED_ID],
                ready: [{ blood: 4 }],
                prey: [{ blood: 3 }],
            })
            const [host] = turn.ring.players[1].vampiresReady
            host.minionAttrs.capacity = 6
            expectClose(
                best(turn).fight,
                master.fight * 2 * 6 * combat.torporShare,
                'one minion, +1 stealth',
            )
            const alone = masterTurn({ hand: [FRONTAL_ASSAULT_ID], ready: [{ blood: 4 }] })
            expectEqual(best(alone).fight ?? 0, 0, 'no prey minion to fight')
        },
    },
    {
        name: 'Unlock: unlocking as normal comes first',
        run() {
            const turn = masterTurn({ phase: 'unlock', ready: [{ blood: 5 }] })
            turn.ring.gameState.turnResources.unlocked = false
            const agent = new UtilityAgent(MASTER_DECK)
            expectEqual(
                chooseThroughView(decisionOf(turn), agent).type,
                'unlockAll',
                'first option',
            )
        },
    },
]
