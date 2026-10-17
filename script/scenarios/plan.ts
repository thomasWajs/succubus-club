import { Player } from '@/shared/model/Player.ts'
import { MinionActionType } from '@/shared/types/state.ts'
import { TurnSequence, TurnPhase, Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { createPlayerView, chooseThroughView } from '@/shared/bot/playerView.ts'
import { GovernDeck, MalkavDeck } from '@/shared/bot/decks.ts'
import { getDecisionPoint, getDecidingPlayer, applyOption } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { BotProfile, DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { assess } from '@/shared/bot/utility/assessment.ts'
import { describeTurnPlan } from '@/shared/bot/utility/describeAssessment.ts'
import { returnWorth } from '@/shared/bot/utility/rescue.ts'
import { TurnPlan, planTurn, candidateOf } from '@/shared/bot/utility/turnPlan.ts'
import { DecisionPoint, DecisionKind, optionsOfType, BotOption } from '@/shared/bot/types.ts'
import { Ring, addMinions, assessAs, createRing, expectClose, holdOnly } from './assessment.ts'
import { Scenario, ScenarioFailure, expectEqual } from './helpers.ts'
import { PassiveAgent } from './torpor.ts'
import { CLOAK_ID, LOST_IN_CROWDS_ID, QUI_VIVE_ID } from '../cardIds.ts'

/**
 * Turn plan: who stays unlocked to defend, who acts and with what. The
 * boards are small and the hands controlled, so the choice reads off the numbers of the plan.
 */

// The minion phase decision of `me`, as the referee offers it
export function minionDecisionOf(ring: Ring, me: Player): DecisionPoint {
    const { gameState } = ring
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
    gameState.turnResources.unlocked = true
    gameState.activePlayerIndex = gameState.competingPlayers.indexOf(me)
    const decision = getDecisionPoint(gameState, me)
    if (decision?.kind != DecisionKind.Minion) {
        throw new ScenarioFailure('No minion phase decision')
    }
    return decision
}

// The plan the utility bot makes for `me`, through its view, with the cards it cannot value left out
export function planAs(
    ring: Ring,
    me: Player,
    options: { profile?: BotProfile; unlockCards?: number; cards?: boolean } = {},
): TurnPlan {
    const decision = minionDecisionOf(ring, me)
    const view = createPlayerView(ring.gameState, me)
    try {
        const viewDecision = getDecisionPoint(view.gameState, view.player)
        if (!viewDecision) {
            throw new ScenarioFailure('No decision in the view')
        }
        return planTurn({
            assessment: assess(view.gameState, view.player, options.profile ?? DEFAULT_PROFILE),
            candidates: optionsOfType(viewDecision.options, 'declareAction')
                .map(candidateOf)
                .filter(candidate => options.cards || !candidate.card),
            mandatory: !decision.options.some(option => option.type == 'endPhase'),
            unlockCards: options.unlockCards ?? 0,
        })
    } finally {
        view.dispose()
    }
}

// The option the utility agent chooses at the minion phase of `me`
function chooseAs(ring: Ring, me: Player, profile: BotProfile = DEFAULT_PROFILE): BotOption {
    return chooseThroughView(minionDecisionOf(ring, me), new UtilityAgent(GovernDeck, profile))
}

// Plays the minion phase of `me` with the utility agent until it ends it ( nobody blocks or reacts )
function playMinionPhase(ring: Ring, me: Player): BotOption[] {
    const agent = new UtilityAgent(GovernDeck)
    const passive = new PassiveAgent()
    const chosen: BotOption[] = []
    for (let step = 0; step < 60; step++) {
        const deciding = getDecidingPlayer(ring.gameState)
        if (!deciding) {
            throw new ScenarioFailure('Nobody decides')
        }
        if (deciding != me) {
            stepBot(deciding, passive)
            continue
        }
        const decision = getDecisionPoint(ring.gameState, me)
        if (!decision) {
            throw new ScenarioFailure('No decision')
        }
        if (decision.kind != DecisionKind.Minion) {
            stepBot(me, passive)
            continue
        }
        const option = chooseThroughView(decision, agent)
        chosen.push(option)
        if (option.type == 'endPhase') {
            return chosen
        }
        applyOption(decision, option)
    }
    throw new ScenarioFailure('The minion phase does not end')
}

const unlockedOf = (me: Player) => me.minionsReadyUnlocked.map(minion => minion.oid).toSorted()

const isAction = (option: BotOption, type: MinionActionType) =>
    option.type == 'declareAction' && option.action.type == type

type HelperSetup = {
    mineBleed?: number
    torpidBlood?: number
    torpidBleed?: number
    // Ready vampires of the owner, all with a bleed of 4
    ready?: number
    ownerPool?: number
    // Vampires of the predator of the owner ( my prey ) that bleed the owner
    bleeders?: number
    // Vampires of my predator, which bleed me
    menace?: number
}

// Four Methuselahs: I have one minion, `other` has a torpid vampire and bleeds my predator, which is
// the Methuselah that bleeds me
function helperBoard(setup: HelperSetup = {}) {
    const ring = createRing([GovernDeck, GovernDeck, GovernDeck, GovernDeck])
    const [me, prey, other, predator] = ring.players
    addMinions(ring, me, [{ bleed: setup.mineBleed ?? 1, blood: 5 }])
    const [torpid] = addMinions(ring, other, [
        { bleed: setup.torpidBleed ?? 4, blood: setup.torpidBlood ?? 5 },
    ])
    ring.gameState.moveCardToRegion(torpid, other.torpor)
    addMinions(
        ring,
        other,
        Array.from({ length: setup.ready ?? 1 }, () => ({ bleed: 4, blood: 5 })),
    )
    addMinions(
        ring,
        predator,
        Array.from({ length: setup.menace ?? 1 }, () => ({ bleed: 2 })),
    )
    addMinions(
        ring,
        prey,
        Array.from({ length: setup.bleeders ?? 0 }, () => ({ bleed: 2 })),
    )
    other.pool = setup.ownerPool ?? other.pool
    holdOnly(ring, me, [])
    const opening = assessAs(ring, me).rescues.find(rescue => rescue.vampire.oid == torpid.oid)
    if (!opening) {
        throw new ScenarioFailure('No rescue opening')
    }
    return { ring, me, torpid, opening, plan: () => planAs(ring, me) }
}

export const PLAN_SCENARIOS: Scenario[] = [
    {
        name: 'Turn plan: the last unlocked minion stays home against a predator with a big bleed, and bleeds when nothing is to fear',
        run() {
            const board = (predatorBleeds: number[]) => {
                const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
                const [me, , predator] = ring.players
                addMinions(ring, me, [{ bleed: 2 }])
                addMinions(
                    ring,
                    predator,
                    predatorBleeds.map(bleed => ({ bleed })),
                )
                holdOnly(ring, me, [])
                me.pool = 8
                return { ring, me }
            }
            const afraid = board([4, 4])
            const home = planAs(afraid.ring, afraid.me)
            expectEqual(home.actions.length, 0, 'it does nothing')
            expectEqual(home.reserved.length, 1, 'the minion stays unlocked')
            expectEqual(
                chooseAs(afraid.ring, afraid.me).type,
                'endPhase',
                'the agent ends the phase',
            )
            const kept = home.cases[home.chosen]
            const sent = home.cases[1 - home.chosen]
            expectEqual(
                kept.chanceOfBeingOusted < sent.chanceOfBeingOusted,
                true,
                'the other way I am more exposed',
            )

            const calm = board([])
            const out = planAs(calm.ring, calm.me)
            expectEqual(out.actions[0]?.kind, 'bleed', 'it bleeds')
            expectEqual(out.reserved.length, 0, 'nobody is kept')
            expectEqual(
                isAction(chooseAs(calm.ring, calm.me), MinionActionType.Bleed),
                true,
                'the agent declares the bleed',
            )
        },
    },
    {
        name: 'Turn plan: a minion at home guards only against the actions its intercept reaches',
        run() {
            const guardOfKept = (intercept: number) => {
                const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
                const [me, prey, predator] = ring.players
                addMinions(ring, me, [{ intercept }])
                addMinions(ring, prey, [{ bleed: 0 }])
                addMinions(ring, predator, [{ bleed: 0 }])
                holdOnly(ring, me, [])
                const plan = planAs(ring, me)
                return plan.cases[0].guard
            }
            expectEqual(guardOfKept(0), 0, 'a hunt has stealth 1: no intercept, no guard')
            const reached = guardOfKept(1)
            expectEqual(reached > 0, true, 'an intercept of 1 reaches them')
            expectEqual(
                reached < DEFAULT_PROFILE.plan.guard,
                true,
                'the stealth cards they may hold flip some',
            )
        },
    },
    {
        name: 'Turn plan: a vampire without blood must hunt, whatever the table',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, , predator] = ring.players
            addMinions(ring, me, [{ blood: 0 }])
            addMinions(ring, predator, [{ bleed: 4 }, { bleed: 4 }])
            me.pool = 3
            const plan = planAs(ring, me)
            expectEqual(plan.posture, 'forced', 'forced')
            expectEqual(plan.actions[0]?.kind, 'hunt', 'a hunt')
            expectEqual(
                isAction(chooseAs(ring, me), MinionActionType.Hunt),
                true,
                'the agent hunts',
            )
        },
    },
    {
        name: 'Turn plan: a wake card lets a locked minion defend, so the unlocked one can act',
        run() {
            const board = (hand: string[]) => {
                const ring = createRing([MalkavDeck, MalkavDeck, MalkavDeck])
                const [me, , predator] = ring.players
                addMinions(ring, me, [{ locked: true }, { bleed: 2 }])
                addMinions(ring, predator, [{ bleed: 4 }])
                holdOnly(ring, me, hand)
                me.pool = 8
                return { ring, me }
            }
            // How much better it is to keep the unlocked minion home than to send it
            const margin = (plan: TurnPlan) => plan.cases[0].equity - plan.cases[1].equity
            const without = board([])
            const withCard = board([QUI_VIVE_ID])
            const bare = planAs(without.ring, without.me)
            const woken = planAs(withCard.ring, withCard.me)
            expectEqual(bare.cases.length, 2, 'keep it, or send it')
            expectEqual(
                margin(woken) < margin(bare),
                true,
                `the card takes the place of the minion at home ( ${margin(woken)} against ${margin(bare)} )`,
            )
            expectEqual(bare.reserved.length, 1, 'without the card it stays')
            expectEqual(woken.reserved.length, 0, 'with the card it acts')
            expectEqual(woken.actions[0]?.kind, 'bleed', 'it bleeds')
        },
    },
    {
        name: 'Turn plan: when my prey can be finished every minion is sent, the pool it gives swallows the lunge',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, prey, predator] = ring.players
            addMinions(ring, me, [{ bleed: 2 }, { bleed: 2 }, { bleed: 2 }])
            addMinions(ring, predator, [{ bleed: 2 }, { bleed: 2 }, { bleed: 2 }])
            holdOnly(ring, me, [])
            me.pool = 5
            prey.pool = 6
            const plan = planAs(ring, me)
            expectEqual(plan.posture, 'lunge', 'a lunge')
            expectEqual(plan.reserved.length, 0, 'nobody is kept')
            expectEqual(
                plan.actions.filter(action => action.kind == 'bleed').length,
                3,
                'three bleeds',
            )
            expectEqual(plan.cases[plan.chosen].chanceToOust, 1, 'the prey is finished')
            expectEqual(
                plan.cases[plan.chosen].chanceOfBeingOusted,
                0,
                'and the lunge does not reach',
            )
        },
    },
    {
        name: 'Turn plan: an unlock card lets the last minion bleed and still defend',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, , predator] = ring.players
            addMinions(ring, me, [{ bleed: 2 }])
            addMinions(ring, predator, [{ bleed: 4 }, { bleed: 4 }])
            holdOnly(ring, me, [])
            me.pool = 8
            const without = planAs(ring, me)
            expectEqual(without.actions.length, 0, 'without the card it stays home')
            const withCard = planAs(ring, me, { unlockCards: 1 })
            expectEqual(withCard.actions[0]?.kind, 'bleed', 'with it, it bleeds')
            expectEqual(withCard.cases[withCard.chosen].unlocked.length, 1, 'and stays a blocker')
            expectEqual(withCard.reserved.length, 0, 'nobody is kept back')
            expectClose(
                withCard.cases[withCard.chosen].chanceOfBeingOusted,
                without.cases[without.chosen].chanceOfBeingOusted,
                'the defence is the same as at home',
                1e-9,
            )
        },
    },
    {
        name: 'Turn plan: the small bleeds go first when the prey may bounce, the big one first otherwise',
        run() {
            const obfuscate = { [Discipline.Obfuscate]: DisciplineLevel.INFERIOR }
            const ring = createRing([MalkavDeck, MalkavDeck, MalkavDeck])
            const [me, prey] = ring.players
            addMinions(ring, me, [
                { bleed: 3, disciplines: obfuscate },
                { bleed: 1, disciplines: obfuscate },
            ])
            const dominate = { disciplines: { [Discipline.Dominate]: DisciplineLevel.INFERIOR } }
            addMinions(ring, prey, [dominate, dominate, dominate])
            holdOnly(ring, me, [LOST_IN_CROWDS_ID, CLOAK_ID])
            const order = (profile: BotProfile) =>
                planAs(ring, me, { profile })
                    .actions.filter(action => action.kind == 'bleed')
                    .map(action => action.actor.bleed)
                    .join()
            const risk = planAs(ring, me).bounceRisk
            expectEqual(risk > 0, true, 'the prey may bounce')
            const bait = (above: number): BotProfile => ({
                ...DEFAULT_PROFILE,
                plan: { ...DEFAULT_PROFILE.plan, baitAbove: above },
            })
            expectEqual(order(bait(risk / 2)), '1,3', 'bait: the small one first')
            expectEqual(order(bait(risk * 2)), '3,1', 'no bait: the big one first')
        },
    },
    {
        name: 'Turn plan: a minion keeps clear of a prey whose blocker would win the fight, and bleeds when it cannot block',
        run() {
            const board = (blockerLocked: boolean) => {
                const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
                const [me, prey] = ring.players
                addMinions(ring, me, [{ bleed: 2, strength: 1, blood: 2 }])
                addMinions(ring, prey, [
                    { strength: 5, blood: 8, intercept: 1, locked: blockerLocked },
                ])
                holdOnly(ring, me, [])
                return { ring, me }
            }
            const blocked = board(false)
            expectEqual(
                planAs(blocked.ring, blocked.me).actions.filter(action => action.kind == 'bleed')
                    .length,
                0,
                'it waits',
            )
            const open = board(true)
            expectEqual(planAs(open.ring, open.me).actions[0]?.kind, 'bleed', 'it bleeds')
        },
    },
    {
        name: 'Turn plan: a torpid vampire of mine leaves torpor, a rescue is made only for a vampire that is worth it',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck, GovernDeck])
            const [me, , other, predator] = ring.players
            const [mine] = addMinions(ring, me, [
                { bleed: 0, blood: 5 },
                { bleed: 0, blood: 5 },
            ])
            const [theirs] = addMinions(ring, other, [{ bleed: 2, blood: 3 }])
            const [menace] = addMinions(ring, predator, [{ bleed: 2, blood: 3 }])
            ring.gameState.moveCardToRegion(theirs, other.torpor)
            ring.gameState.moveCardToRegion(menace, predator.torpor)
            holdOnly(ring, me, [])
            const plan = planAs(ring, me)
            const targets = plan.actions.flatMap(action =>
                action.option.action.type == MinionActionType.RescueFromTorpor ?
                    [action.option.action.target.oid]
                :   [],
            )
            expectEqual(
                targets.includes(theirs.oid),
                true,
                'the vampire of the one that bleeds my predator',
            )
            expectEqual(targets.includes(menace.oid), false, 'never the vampire of my predator')

            // Mine, in torpor with the blood to leave it
            ring.gameState.moveCardToRegion(mine, me.torpor)
            mine.blood = 4
            expectEqual(planAs(ring, me).actions[0]?.kind, 'leaveTorpor', 'it leaves torpor first')
        },
    },
    {
        name: 'Turn plan: a rescue of the vampire of the one that bleeds my predator is made when it beats the minion bleeding, and is worth more the harder that vampire bleeds',
        run() {
            // One ring, only the bleeds change: the worth of a rescue also depends on the capacity of the
            // vampire, which is a random crypt card
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck, GovernDeck])
            const [me, , other, predator] = ring.players
            const [mine] = addMinions(ring, me, [{ blood: 5 }])
            const [theirs, sibling] = addMinions(ring, other, [{ blood: 5 }, { blood: 5 }])
            ring.gameState.moveCardToRegion(theirs, other.torpor)
            addMinions(ring, predator, [{ bleed: 1 }])
            holdOnly(ring, me, [])
            const board = (mineBleed: number, theirBleed: number) => {
                mine.minionAttrs.bleed = mineBleed
                theirs.minionAttrs.bleed = theirBleed
                sibling.minionAttrs.bleed = theirBleed
                const plan = planAs(ring, me)
                const opening = assessAs(ring, me).rescues.find(
                    rescue => rescue.vampire.oid == theirs.oid,
                )
                if (!opening) {
                    throw new ScenarioFailure('No rescue opening')
                }
                const rescues = plan.actions.filter(action => action.kind == 'rescue')
                return { plan, value: opening.value, rescues, theirs }
            }
            const weak = board(1, 2)
            const middle = board(1, 4)
            const strong = board(1, 6)
            expectEqual(
                weak.value < middle.value && middle.value < strong.value,
                true,
                `the harder it bleeds the more it is worth ( ${weak.value}, ${middle.value}, ${strong.value} )`,
            )
            expectEqual(
                strong.plan.actions[0]?.kind,
                'rescue',
                'a weak bleed gives way to a rescue',
            )
            const target =
                strong.rescues[0]?.option.action.type == MinionActionType.RescueFromTorpor ?
                    strong.rescues[0].option.action.target.oid
                :   null
            expectEqual(target, strong.theirs.oid, 'the torpid vampire is the one rescued')

            // A bleed of 3 on my prey is worth more than that rescue
            const bleeding = board(3, 6)
            expectEqual(bleeding.plan.actions[0]?.kind, 'bleed', 'a good bleed is kept')
            expectEqual(bleeding.rescues.length, 0, 'no rescue then')
        },
    },
    {
        name: 'Rescue worth: a vampire with blood and equipment is worth more, one that comes back with no blood is worth less',
        run() {
            const poor = helperBoard({ torpidBlood: 2 }).opening
            const rich = helperBoard({ torpidBlood: 8 }).opening
            expectEqual(
                rich.value > poor.value,
                true,
                `blood ( ${poor.value} for 2, ${rich.value} for 8 )`,
            )

            // Flat equipment: each attached card adds, up to the maximum of the profile
            const equip = (cards: number) =>
                returnWorth(
                    {
                        ...rich,
                        vampire: {
                            ...rich.vampire,
                            attached: Array.from({ length: cards }, () => 'card'),
                        },
                    },
                    rich.vampire.blood,
                    DEFAULT_PROFILE,
                )
            expectEqual(equip(1) > equip(0) && equip(2) > equip(1), true, 'equipment')
            expectEqual(
                equip(9),
                equip(DEFAULT_PROFILE.helpers.equipmentMax),
                'the flat value stops',
            )

            // Back with no blood: it must hunt first, and keeps a share of its worth
            const hungry = returnWorth(rich, 0, DEFAULT_PROFILE)
            const fed = returnWorth(rich, 1, DEFAULT_PROFILE)
            expectEqual(hungry < fed, true, 'it hunts first')
            expectEqual(hungry > 0, true, 'but it is back')
            expectEqual(
                helperBoard({ torpidBlood: 0 }).opening.value <
                    helperBoard({ torpidBlood: 1 }).opening.value,
                true,
                'an empty vampire in the table',
            )
        },
    },
    {
        name: 'Rescue worth: a Methuselah that is about to be ousted, or that has many other minions, is worth helping less',
        run() {
            const base = helperBoard({ bleeders: 2 }).opening
            expectClose(base.survival, 1, 'the pool of the owner is not at stake', 1e-9)

            const doomed = helperBoard({ bleeders: 2, ownerPool: 1 }).opening
            expectEqual(doomed.survival < 0.2, true, `the owner is finished ( ${doomed.survival} )`)
            expectEqual(
                Math.abs(doomed.value) < base.value / 3,
                true,
                `so is its vampire ( ${doomed.value} against ${base.value} )`,
            )

            const alone = helperBoard({ ready: 0 }).opening
            const crowded = helperBoard({ ready: 3 }).opening
            expectEqual(
                crowded.value < alone.value / 2,
                true,
                `many minions already ( ${crowded.value} against ${alone.value} )`,
            )
        },
    },
    {
        name: 'Rescue worth: the rescuer pays the cost when the vampire has little blood, so it comes back able to bleed',
        run() {
            const full = helperBoard({
                mineBleed: 0,
                ready: 0,
                menace: 0,
                torpidBleed: 6,
                torpidBlood: 8,
            })
            const paidBy = (board: ReturnType<typeof helperBoard>) => {
                const rescue = board.plan().actions.find(action => action.kind == 'rescue')
                return rescue?.option.action.type == MinionActionType.RescueFromTorpor ?
                        (rescue.option.action.bloodPaidByActingMinion ?? 0)
                    :   null
            }
            expectEqual(paidBy(full), 0, 'a vampire with blood pays all of it')

            const low = helperBoard({
                mineBleed: 0,
                ready: 0,
                menace: 0,
                torpidBleed: 6,
                torpidBlood: 1,
            })
            expectEqual(paidBy(low), 2, 'with 1 blood left it would have to hunt: the rescuer pays')
        },
    },
    {
        name: 'Turn plan: the minion phase played by the agent ends with the minions the plan keeps unlocked',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, , predator] = ring.players
            addMinions(ring, me, [{ bleed: 3 }, { bleed: 3 }, { bleed: 3 }])
            addMinions(ring, predator, [{ bleed: 3 }, { bleed: 3 }])
            holdOnly(ring, me, [])
            me.pool = 7
            const first = planAs(ring, me)
            const kept = first.reserved.map(minion => minion.oid).toSorted()
            expectEqual(kept.length > 0 && kept.length < 3, true, 'a part of them is kept')
            const options = playMinionPhase(ring, me)
            expectEqual(options.at(-1)?.type, 'endPhase', 'the phase ends')
            expectEqual(unlockedOf(me).join(), kept.join(), 'the ones the plan kept are unlocked')
            expectEqual(
                options.filter(option => option.type == 'declareAction').length,
                3 - kept.length,
                'the others acted',
            )
        },
    },
    {
        name: 'Turn plan: it prints, and a plan is a function of the view',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, , predator] = ring.players
            addMinions(ring, me, [{ bleed: 2 }, { bleed: 1 }])
            addMinions(ring, predator, [{ bleed: 2 }])
            const lines = describeTurnPlan(planAs(ring, me)).join('\n')
            expectEqual(lines.includes('equity'), true, 'the reserves are described')
            expectEqual(
                describeTurnPlan(planAs(ring, me)).join('\n'),
                lines,
                'the same view makes the same plan',
            )
        },
    },
]
