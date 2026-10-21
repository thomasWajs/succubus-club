import { Card, LibraryCard, Vampire } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { TurnPhase, TurnSequence } from '@/shared/const/model.ts'
import { CombatStep, MinionActionType } from '@/shared/types/state.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { getHost } from '@/shared/state/attachments.ts'
import {
    createLeaveTorporAction,
    createRescueFromTorporAction,
} from '@/shared/state/minionActionFactories.ts'
import { canDeclare, getDefaultStealth, resolve } from '@/shared/state/minionActions.ts'
import { countHostages, getEnterCombatTargets, isHostage } from '@/shared/state/standingCards.ts'
import { chooseThroughView } from '@/shared/bot/playerView.ts'
import { applyOption } from '@/shared/bot/referee.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'
import { summarizeCardId } from '@/shared/bot/utility/summaries.ts'
import { AttachDeck } from '../attachDeck.ts'
import { findAnyCard } from './attachment.ts'
import { MASTER_DECK, MasterTurn, decisionOf, masterTurn } from './masterPhase.ts'
import {
    Scenario,
    ScenarioFailure,
    attachInPlay,
    createFight,
    damageResolution,
    expectEqual,
    expectRegion,
    must,
    passUntil,
} from './helpers.ts'
import { CARVERS_ID, FRONTAL_ASSAULT_ID, HAVEN_UNCOVERED_ID, THEO_BELL_ID } from '../cardIds.ts'

/**
 * Haven Uncovered, Frontal Assault and Carver's Meat Packing and Storage.
 */

const toPhase = (turn: MasterTurn, phase: TurnPhase) => {
    turn.ring.gameState.turnPhaseIndex = TurnSequence.indexOf(phase)
}

// A card of the deck of the player, put in play in their ready region
function putInPlay(player: Player, krcgId: string): LibraryCard {
    const card = findAnyCard(player, krcgId)
    player.gameState.moveCardToRegion(card, player.ready)
    return card
}

// A master turn where none of my vampires can enter combat on its own ( the crypt is drawn at random )
function plainTurn(setup: Parameters<typeof masterTurn>[0]): MasterTurn {
    for (let attempt = 0; attempt < 50; attempt++) {
        const turn = masterTurn(setup)
        if (turn.vampires.every(vampire => vampire.krcgId != THEO_BELL_ID)) {
            return turn
        }
    }
    throw new ScenarioFailure('No crypt without Theo Bell')
}

const enterCombatOf = (decision: DecisionPoint) =>
    optionsOfType(decision.options, 'declareAction').filter(
        option => option.action.type == MinionActionType.EnterCombat,
    )

const enterCombatOptions = (turn: MasterTurn) => enterCombatOf(decisionOf(turn))

const burnOptions = (turn: MasterTurn, card: LibraryCard) =>
    optionsOfType(decisionOf(turn).options, 'declareAction').filter(
        option => option.action.type == MinionActionType.ActionInPlay && option.action.card == card,
    )

// A vampire of the player in torpor with a hostage counter put by the card
function takeHostage(player: Player, card: LibraryCard, vampire: Vampire, blood = 3): void {
    player.gameState.moveCardToRegion(vampire, player.torpor)
    vampire.blood = blood
    must(botMutations.setHostage.act(player, { vampire, card }), 'hostage')
}

// A fight where the defending vampire is sent to torpor ( or burned ) in the damage resolution, with the card of the
// acting player in play
function createFightWith(
    krcgId: string,
    copies = 1,
    { defendingBlood = 1, regular = 5, aggravated = 0, capacity = 8 } = {},
) {
    const fight = createFight(3, defendingBlood, { ...AttachDeck, [krcgId]: 4 })
    fight.defending.minionAttrs.capacity = capacity
    const cards: LibraryCard[] = []
    for (let copy = 0; copy < copies; copy++) {
        const card = findAnyCard(fight.actingPlayer, krcgId)
        fight.gameState.moveCardToRegion(card, fight.actingPlayer.ready)
        cards.push(card)
    }
    damageResolution(fight, fight.defending, regular, aggravated)
    return { ...fight, cards }
}

export const HAVEN_CARVERS_ASSAULT_SCENARIOS: Scenario[] = [
    {
        name: 'Haven Uncovered: put on a ready vampire of another Methuselah only',
        run() {
            const turn = masterTurn({
                hand: [HAVEN_UNCOVERED_ID],
                ready: [{ blood: 3 }],
                prey: [{ blood: 2 }],
                predator: [{ blood: 5 }],
            })
            const targets = optionsOfType(decisionOf(turn).options, 'playMaster')
                .filter(option => option.card.krcgId == HAVEN_UNCOVERED_ID)
                .map(option => option.target)
            expectEqual(targets.length, 2, 'targets')
            expectEqual(
                targets.some(target => target?.controller == turn.me),
                false,
                'not one of mine',
            )
        },
    },
    {
        name: 'Haven Uncovered: the minions of the others can enter combat with the host as an action at +1 stealth, with it only',
        run() {
            const turn = plainTurn({
                ready: [{ blood: 3 }],
                prey: [{ blood: 2 }, { blood: 4 }],
                predator: [{ blood: 5 }],
            })
            toPhase(turn, TurnPhase.Minion)
            expectEqual(enterCombatOptions(turn).length, 0, 'no Haven')

            const prey = turn.ring.players[1]
            const [host, other] = prey.vampiresReady
            const haven = findAnyCard(turn.me, HAVEN_UNCOVERED_ID)
            attachInPlay(haven, host)
            const decision = decisionOf(turn)
            const options = enterCombatOf(decision)
            expectEqual(options.length, 1, 'only the host')
            expectEqual(options[0].action.target, host, 'target')
            expectEqual(getDefaultStealth(options[0].action), 1, 'stealth')
            expectEqual(getEnterCombatTargets(other).includes(host), false, 'its own side')

            applyOption(decision, options[0])
            expectEqual(turn.ring.gameState.action?.minionAction.target, host, 'declared')

            turn.ring.gameState.moveCardToRegion(host, prey.torpor)
            expectEqual(getEnterCombatTargets(turn.vampires[0]).includes(host), false, 'in torpor')
        },
    },
    {
        name: 'Haven Uncovered: the host burns it as an action directed at the Methuselah who played it, at +1 stealth, other vampires cannot',
        run() {
            const turn = masterTurn({
                ready: [{ blood: 3 }, { blood: 3 }],
                prey: [{ blood: 2 }],
            })
            toPhase(turn, TurnPhase.Minion)
            const prey = turn.ring.players[1]
            const haven = findAnyCard(prey, HAVEN_UNCOVERED_ID)
            attachInPlay(haven, turn.vampires[0])
            const options = burnOptions(turn, haven)
            expectEqual(options.length, 1, 'only the host')
            const { action } = options[0]
            expectEqual(action.actingMinion, turn.vampires[0], 'the host')
            expectEqual(action.target, haven, 'aimed at the card')
            expectEqual(getDefaultStealth(action), 1, 'stealth')

            prey.isOusted = true
            expectEqual(burnOptions(turn, haven).length, 0, 'the player of the card is ousted')
            prey.isOusted = false

            resolve(action)
            expectEqual(haven.isIn.ashHeap, true, 'burned')
            expectEqual(getHost(haven), undefined, 'detached')
        },
    },
    {
        name: 'Frontal Assault: each ready minion enters combat with a minion of the prey as an action, not with the others',
        run() {
            const turn = plainTurn({
                ready: [{ blood: 3 }, { blood: 3 }],
                prey: [{ blood: 2 }, { blood: 4 }],
                predator: [{ blood: 5 }],
            })
            toPhase(turn, TurnPhase.Minion)
            expectEqual(enterCombatOptions(turn).length, 0, 'no card')

            putInPlay(turn.me, FRONTAL_ASSAULT_ID)
            const options = enterCombatOptions(turn)
            expectEqual(options.length, 4, 'two minions, two targets')
            expectEqual(
                options.every(
                    option =>
                        option.action.target instanceof Card &&
                        option.action.target.controller == turn.me.prey,
                ),
                true,
                'the prey only',
            )
            expectEqual(getDefaultStealth(options[0].action), 0, 'no stealth')
        },
    },
    {
        name: 'Frontal Assault: 1 pool after a ready minion of the prey goes to torpor or is burned, for each card',
        run() {
            const torpor = createFightWith(FRONTAL_ASSAULT_ID, 2)
            const pool = torpor.actingPlayer.pool
            passUntil(torpor, CombatStep.EndOfRound)
            expectRegion(torpor.defending, 'torpor')
            expectEqual(torpor.actingPlayer.pool, pool + 2, 'two cards in play')

            const burned = createFightWith(FRONTAL_ASSAULT_ID, 1, {
                defendingBlood: 0,
                regular: 0,
                aggravated: 2,
            })
            const burnedPool = burned.actingPlayer.pool
            passUntil(burned, CombatStep.EndOfRound)
            expectEqual(burned.defending.isIn.ashHeap, true, 'burned')
            expectEqual(burned.actingPlayer.pool, burnedPool + 1, 'pool')
        },
    },
    {
        name: 'Frontal Assault: in the influence phase of its controller it is burned, with 1 pool for each ready minion of the prey',
        run() {
            const turn = masterTurn({
                ready: [{ blood: 3 }],
                prey: [{ blood: 2 }, { blood: 2 }, { blood: 2 }],
                pool: 10,
            })
            const assault = putInPlay(turn.me, FRONTAL_ASSAULT_ID)
            toPhase(turn, TurnPhase.Minion)
            const decision = decisionOf(turn)
            applyOption(
                decision,
                decision.options.find(option => option.type == 'endPhase') ?? decision.options[0],
            )
            expectEqual(
                turn.ring.gameState.turnPhaseIndex,
                TurnSequence.indexOf(TurnPhase.Influence),
                'phase',
            )
            expectEqual(turn.me.pool, 7, 'pool')
            expectEqual(assault.isIn.ashHeap, true, 'burned')
        },
    },
    {
        name: "Carver's Meat Packing and Storage: a vampire with a capacity of 3 or less that goes to torpor gets a hostage counter, a bigger one does not",
        run() {
            const small = createFightWith(CARVERS_ID, 1, { capacity: 3 })
            passUntil(small, CombatStep.EndOfRound)
            expectRegion(small.defending, 'torpor')
            expectEqual(isHostage(small.defending), true, 'capacity 3')

            const big = createFightWith(CARVERS_ID, 1, { capacity: 4 })
            passUntil(big, CombatStep.EndOfRound)
            expectRegion(big.defending, 'torpor')
            expectEqual(isHostage(big.defending), false, 'capacity 4')
        },
    },
    {
        name: "Carver's Meat Packing and Storage: a hostage cannot leave torpor, be rescued nor be diablerized, until the card leaves play",
        run() {
            const turn = masterTurn({
                ready: [{ blood: 5 }],
                prey: [{ blood: 3 }],
                inPlay: [CARVERS_ID],
            })
            toPhase(turn, TurnPhase.Minion)
            const carvers = carversOf(turn)
            const hostage = turn.me.vampiresInUncontrolled[0]
            takeHostage(turn.me, carvers, hostage, 5)
            const rescuer = turn.vampires[0]
            const diablerist = turn.ring.players[1].vampiresReady[0]
            const attempts = () => ({
                leave: canDeclare(createLeaveTorporAction(hostage)).isValid,
                rescue: canDeclare(createRescueFromTorporAction(rescuer, hostage, 1, 1)).isValid,
                diablerie: canDeclare({
                    type: MinionActionType.Diablerize,
                    actingMinion: diablerist,
                    target: hostage,
                }).isValid,
            })
            expectEqual(
                JSON.stringify(attempts()),
                JSON.stringify({ leave: false, rescue: false, diablerie: false }),
                'hostage',
            )

            turn.ring.gameState.moveCardToRegion(carvers, turn.me.ashHeap)
            expectEqual(isHostage(hostage), false, 'the card is gone')
            expectEqual(
                JSON.stringify(attempts()),
                JSON.stringify({ leave: true, rescue: true, diablerie: true }),
                'free',
            )
        },
    },
    {
        name: "Carver's Meat Packing and Storage: locked in the master phase it adds as much blood as there are hostages to a ready vampire, within its capacity, once",
        run() {
            const turn = masterTurn({
                ready: [{ blood: 1 }, { blood: 7 }],
                prey: [{ blood: 5 }, { blood: 5 }],
                inPlay: [CARVERS_ID],
            })
            const carvers = carversOf(turn)
            const lockUses = () => optionsOfType(decisionOf(turn).options, 'lockUse')
            expectEqual(lockUses().length, 0, 'no hostage')

            const prey = turn.ring.players[1]
            takeHostage(prey, carvers, prey.vampiresReady[0])
            takeHostage(prey, carvers, prey.vampiresReady[0])
            expectEqual(countHostages(turn.ring.gameState), 2, 'hostages')
            const [poor, rich] = turn.vampires
            expectEqual(lockUses().length, 2, 'two vampires to aim at')

            const decision = decisionOf(turn)
            const uses = optionsOfType(decision.options, 'lockUse')
            const first = uses.find(use => use.target == poor)
            if (!first || !uses.some(use => use.target == rich)) {
                throw new ScenarioFailure('The uses are not offered')
            }
            applyOption(decision, first)
            expectEqual(poor.blood, 3, 'two blood')
            expectEqual(carvers.isLocked, true, 'locked')
            expectEqual(lockUses().length, 0, 'once')
        },
    },
    {
        name: "Carver's Meat Packing and Storage: in the unlock phase a hostage of the player is freed for 2 blood of a ready vampire, once, never one of another Methuselah",
        run() {
            const turn = masterTurn({
                phase: 'unlock',
                ready: [{ blood: 1 }, { blood: 4 }],
                prey: [{ blood: 5 }],
                inPlay: [CARVERS_ID],
            })
            const carvers = carversOf(turn)
            const frees = () =>
                optionsOfType(decisionOf(turn).options, 'unlockEffect').filter(
                    option => option.card == carvers,
                )
            expectEqual(frees().length, 0, 'no hostage')

            const mine = turn.me.vampiresInUncontrolled[0]
            takeHostage(turn.me, carvers, mine)
            takeHostage(turn.me, carvers, turn.me.vampiresInUncontrolled[0])
            const prey = turn.ring.players[1]
            takeHostage(prey, carvers, prey.vampiresReady[0])
            const decision = decisionOf(turn)
            const options = optionsOfType(decision.options, 'unlockEffect').filter(
                option => option.card == carvers,
            )
            expectEqual(options.length, 2, 'mine only')
            const free = options.find(option => option.vampire == mine)
            if (!free) {
                throw new ScenarioFailure('The hostage is not offered')
            }
            applyOption(decision, free)
            expectEqual(isHostage(mine), false, 'freed')
            expectEqual(turn.vampires[1].blood, 2, 'paid by the vampire that holds the most blood')
            expectEqual(isHostage(prey.vampiresInTorpor[0]), true, 'the other one stays')
            expectEqual(frees().length, 0, 'once a turn')
        },
    },
    {
        name: "Carver's Meat Packing and Storage: no vampire holds 2 blood, no hostage is freed",
        run() {
            const turn = masterTurn({
                phase: 'unlock',
                ready: [{ blood: 1 }, { blood: 1 }],
                inPlay: [CARVERS_ID],
            })
            const carvers = carversOf(turn)
            takeHostage(turn.me, carvers, turn.me.vampiresInUncontrolled[0])
            expectEqual(
                optionsOfType(decisionOf(turn).options, 'unlockEffect').length,
                0,
                'no blood to pay',
            )
        },
    },
    {
        name: "Carver's Meat Packing and Storage: the utility bot locks it for the blood in the master phase and frees its own hostage in the unlock phase",
        run() {
            const agent = new UtilityAgent(MASTER_DECK)
            const master = masterTurn({
                ready: [{ blood: 1 }],
                prey: [{ blood: 5 }, { blood: 5 }],
                inPlay: [CARVERS_ID],
            })
            const prey = master.ring.players[1]
            const carvers = carversOf(master)
            takeHostage(prey, carvers, prey.vampiresReady[0])
            takeHostage(prey, carvers, prey.vampiresReady[0])
            expectEqual(
                chooseThroughView(decisionOf(master), agent).type,
                'lockUse',
                'master phase',
            )

            const unlock = masterTurn({
                phase: 'unlock',
                ready: [{ blood: 5 }],
                inPlay: [CARVERS_ID],
            })
            takeHostage(unlock.me, carversOf(unlock), unlock.me.vampiresInUncontrolled[0], 4)
            expectEqual(
                chooseThroughView(decisionOf(unlock), agent).type,
                'unlockEffect',
                'unlock phase',
            )
        },
    },
    {
        name: 'Haven Uncovered, Frontal Assault and Carver have roles',
        run() {
            expectEqual(
                summarizeCardId(HAVEN_UNCOVERED_ID)?.roles.join(),
                'combatStarter,attachment,master',
                'Haven',
            )
            expectEqual(
                summarizeCardId(FRONTAL_ASSAULT_ID)?.roles.join(),
                'combatStarter,poolGain,master',
                'Frontal Assault',
            )
            expectEqual(summarizeCardId(CARVERS_ID)?.roles.join(), 'sustain,master', "Carver's")
        },
    },
]

// The Carver's of the turn, in play
function carversOf(turn: MasterTurn): LibraryCard {
    const card = turn.me.controlledReadyCards.find(candidate => candidate.krcgId == CARVERS_ID)
    if (!(card instanceof LibraryCard)) {
        throw new ScenarioFailure("Carver's is not in play")
    }
    return card
}
