import { Vampire } from '@/shared/model/Card.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { createCombatState, createHandStrike } from '@/shared/state/combatState.ts'
import { DisciplineUse, MinionActionType, CombatStep } from '@/shared/types/state.ts'
import { TurnSequence, TurnPhase, DisciplineLevel, Discipline } from '@/shared/const/model.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { getHost, isAttached } from '@/shared/state/attachments.ts'
import { BLOOD_DOLL_ID } from '@/shared/cardImpl/cardIds.ts'
import { getCombatCardOptions } from '@/shared/bot/cardOptions.ts'
import {
    matchesMinionFilter,
    getAttachCandidates,
    getMinionStrength,
} from '@/shared/cardImpl/catalog/attached.ts'
import { actionImplementation } from '@/shared/cardImpl/catalog/interpreter.ts'
import {
    aVampire,
    aMinion,
    defineCard,
    attachToMinion,
    strength as strengthEffect,
} from '@/shared/cardImpl/catalog/builders.ts'
import { MinionFilter } from '@/shared/cardImpl/catalog/types.ts'
import { canDeclare } from '@/shared/state/minionActions.ts'
import { createActionCardAction } from '@/shared/state/minionActionFactories.ts'
import { GovernAgent } from '@/shared/bot/agents/governAgent.ts'
import {
    createHeadlessGame,
    registerQueuedMutationTrigger,
    registerSyncMutationTrigger,
} from '../harness.ts'
import { AttachDeck } from '../attachDeck.ts'
import { BrujahDeck } from '@/shared/bot/decks.ts'
import { applyOption, getDecisionPoint } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { optionsOfType, DecisionKind } from '@/shared/bot/types.ts'
import {
    Scenario,
    ScenarioFailure,
    attachInPlay,
    createFight,
    createdGames,
    damageResolution,
    expectEqual,
    expectRegion,
    findCard,
    getCombat,
    giveCard,
    must,
    mustRefuse,
    passUntil,
    readyVampire,
} from './helpers.ts'
import { emptyHand, sealLibrary } from './bounce.ts'
import { getMasterDecision } from './master.ts'
import { createEquipTurn, equipOptions, levelOf } from './attachment.ts'
import { resolveAction } from './torpor.ts'
import { TORN_SIGNPOST_ID } from './brujah.ts'
import { getCombatDecision } from './combatCards.ts'

/**
 * Cards put on a minion that are neither equipment nor retainers: a master card that goes on one of
 * the player's vampires ( Blood Doll ), an action card that goes on the acting vampire
 * ( Preternatural Strength ).
 */

export const PRETERNATURAL_ID = '101483'

const VESSEL_ID = '102113'

// The master phase of a player holding a Blood Doll as their only card, with ready vampires of the
// given blood and one vampire in torpor
export function createDollTurn(bloods: number[], cardId = BLOOD_DOLL_ID) {
    const { gameState } = createHeadlessGame([AttachDeck, AttachDeck])
    createdGames.push(gameState)
    const player = gameState.activePlayer
    if (!player) {
        throw new ScenarioFailure('No active player')
    }
    emptyHand(gameState, player)
    const doll = giveCard(gameState, player, cardId)
    const vampires = bloods.map(blood => readyVampire(gameState, player, blood))
    const torpid = player.vampiresInUncontrolled[0]
    gameState.moveCardToRegion(torpid, player.torpor)
    torpid.blood = 1
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Master)
    gameState.turnResources.unlocked = true
    return { gameState, player, library: doll, doll, vampires, torpid }
}

// Plays the doll on the vampire through the master phase decision
export function playDoll(turn: ReturnType<typeof createDollTurn>, target: Vampire): void {
    const decision = getMasterDecision(turn)
    const play = optionsOfType(decision.options, 'playMaster').find(
        option => option.card == turn.doll && option.target == target,
    )
    if (!play) {
        throw new ScenarioFailure(`The doll cannot be put on ${target.name}`)
    }
    applyOption(decision, play)
}

const moveBloodOptions = (turn: ReturnType<typeof createDollTurn>) =>
    optionsOfType(getMasterDecision(turn).options, 'moveBlood')

// Moves blood to the pool or to the vampire with the first doll that can
function applyMoveBlood(turn: ReturnType<typeof createDollTurn>, toPool: boolean): void {
    const decision = getMasterDecision(turn)
    const move = optionsOfType(decision.options, 'moveBlood').find(
        option => option.toPool == toPool,
    )
    if (!move) {
        throw new ScenarioFailure(`No move ${toPool ? 'to the pool' : 'to the vampire'}`)
    }
    applyOption(decision, move)
}

function setPotence(vampire: Vampire, level: DisciplineLevel | null): void {
    vampire.minionAttrs.disciplines = Object.fromEntries(
        Object.entries(vampire.minionAttrs.disciplines).filter(
            ([name]) => name != Discipline.Potence,
        ),
    ) as Disciplines
    if (level) {
        vampire.minionAttrs.disciplines[Discipline.Potence] = level
    }
}

const createStrengthTurn = (level: DisciplineLevel | null) => {
    const turn = createEquipTurn(PRETERNATURAL_ID)
    setPotence(turn.ready, level)
    return turn
}

const POTENCE_SUPERIOR: DisciplineUse[] = [
    { discipline: Discipline.Potence, level: DisciplineLevel.SUPERIOR },
]

const POTENCE_INFERIOR: DisciplineUse[] = [
    { discipline: Discipline.Potence, level: DisciplineLevel.INFERIOR },
]

const HEROIC_MIGHT_ID = '100913'

export const PUT_ON_SCENARIOS: Scenario[] = [
    {
        name: 'Blood Doll can be put on each vampire of the player, ready or in torpor, and on no other',
        run() {
            const turn = createDollTurn([2, 3])
            const targets = optionsOfType(getMasterDecision(turn).options, 'playMaster').map(
                option => option.target,
            )
            expectEqual(targets.length, 3, 'options')
            expectEqual(
                [...turn.vampires, turn.torpid].every(vampire => targets.includes(vampire)),
                true,
                'targets',
            )
        },
    },
    {
        name: 'Blood Doll is put under its vampire for the master phase action ( it costs nothing ), and stays in play',
        run() {
            const turn = createDollTurn([2, 3])
            const { gameState, player, doll } = turn
            const pool = player.pool
            const mpa = gameState.turnResources.mpa
            playDoll(turn, turn.vampires[0])

            expectEqual(getHost(doll), turn.vampires[0], 'host')
            expectEqual(doll.region, player.ready, 'region')
            expectEqual(doll.position < turn.vampires[0].position, true, 'drawn under the vampire')
            expectEqual(player.pool, pool, 'pool')
            expectEqual(gameState.turnResources.mpa, mpa - 1, 'master phase action')
            expectEqual(
                getDecisionPoint(gameState, player)?.kind == DecisionKind.Cleanup,
                false,
                'cleanup',
            )
        },
    },
    {
        name: 'Blood Doll on a vampire in torpor follows it there, and still works',
        run() {
            const turn = createDollTurn([2])
            playDoll(turn, turn.torpid)
            expectEqual(turn.doll.isIn.torpor, true, 'in torpor with the vampire')
            expectEqual(getHost(turn.doll), turn.torpid, 'host')
            expectEqual(
                moveBloodOptions(turn).every(option => option.vampire == turn.torpid),
                true,
                'the options are for the vampire in torpor',
            )
            expectEqual(moveBloodOptions(turn).length > 0, true, 'usable in torpor')
        },
    },
    {
        name: 'Blood Doll moves 1 blood to the pool or to the vampire, once per turn, and again the next turn',
        run() {
            const turn = createDollTurn([2])
            const [vampire] = turn.vampires
            const { gameState, player } = turn
            playDoll(turn, vampire)
            const pool = player.pool

            expectEqual(moveBloodOptions(turn).length, 2, 'both directions')
            applyMoveBlood(turn, true)
            expectEqual(vampire.blood, 1, 'blood of the vampire')
            expectEqual(player.pool, pool + 1, 'pool')
            expectEqual(moveBloodOptions(turn).length, 0, 'used this turn')

            gameState.setNewTurnResources()
            gameState.turnResources.unlocked = true
            applyMoveBlood(turn, false)
            expectEqual(vampire.blood, 2, 'blood of the vampire')
            expectEqual(player.pool, pool, 'pool')
        },
    },
    {
        name: 'Vessel costs 1 pool, is put on a vampire, and moves 1 blood once per turn in the unlock phase only',
        run() {
            const turn = createDollTurn([2], VESSEL_ID)
            const [vampire] = turn.vampires
            const { gameState, player, doll } = turn
            const pool = player.pool
            playDoll(turn, vampire)
            expectEqual(player.pool, pool - 1, 'pool')
            expectEqual(getHost(doll), vampire, 'host')
            expectEqual(moveBloodOptions(turn).length, 0, 'not in the master phase')

            gameState.setNewTurnResources()
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            expectEqual(moveBloodOptions(turn).length, 0, 'not before the unlock')
            gameState.turnResources.unlocked = true
            expectEqual(moveBloodOptions(turn).length, 2, 'both directions')

            applyMoveBlood(turn, true)
            expectEqual(vampire.blood, 1, 'blood of the vampire')
            expectEqual(player.pool, pool, 'pool')
            expectEqual(moveBloodOptions(turn).length, 0, 'once per turn')

            gameState.setNewTurnResources()
            gameState.turnResources.unlocked = true
            applyMoveBlood(turn, false)
            expectEqual(vampire.blood, 2, 'blood of the vampire')
            expectEqual(player.pool, pool - 1, 'pool')
        },
    },
    {
        name: 'Vessel works on a vampire in torpor, a Blood Doll does not move blood in the unlock phase',
        run() {
            const turn = createDollTurn([2], VESSEL_ID)
            const { gameState, player, doll } = turn
            attachInPlay(doll, turn.torpid)
            const bloodDoll = findCard(player, BLOOD_DOLL_ID)
            attachInPlay(bloodDoll, turn.vampires[0])
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            gameState.turnResources.unlocked = true
            const options = moveBloodOptions(turn)
            expectEqual(options.length > 0, true, 'usable in torpor')
            expectEqual(
                options.every(option => option.card == doll && option.vampire == turn.torpid),
                true,
                'only the Vessel',
            )
        },
    },
    {
        name: 'Blood Doll never takes blood from an empty vampire, overfills one, nor takes the last pool',
        run() {
            const turn = createDollTurn([0, 4])
            const [empty, full] = turn.vampires
            full.minionAttrs.capacity = 4
            for (const vampire of turn.vampires) {
                attachInPlay(findCard(turn.player, BLOOD_DOLL_ID), vampire)
            }
            const options = moveBloodOptions(turn)
            const of = (vampire: Vampire) => options.filter(option => option.vampire == vampire)
            expectEqual(
                of(empty)
                    .map(option => option.toPool)
                    .join(),
                'false',
                'empty vampire',
            )
            expectEqual(
                of(full)
                    .map(option => option.toPool)
                    .join(),
                'true',
                'full vampire',
            )

            turn.player.pool = 1
            expectEqual(
                moveBloodOptions(turn).filter(option => !option.toPool).length,
                0,
                'the last pool is kept',
            )
        },
    },
    {
        name: 'Blood Doll is used without a master phase action, which only playing it needs',
        run() {
            const turn = createDollTurn([2])
            turn.gameState.turnResources.mpa = 0
            expectEqual(
                optionsOfType(getMasterDecision(turn).options, 'playMaster').length,
                0,
                'cannot be played',
            )
            attachInPlay(turn.doll, turn.vampires[0])
            expectEqual(moveBloodOptions(turn).length, 2, 'can be used')
        },
    },
    {
        name: 'Blood Doll burns with its vampire',
        run() {
            const turn = createDollTurn([2])
            playDoll(turn, turn.vampires[0])
            turn.gameState.moveCardToRegion(turn.vampires[0], turn.player.ashHeap)
            expectEqual(turn.doll.isIn.ashHeap, true, 'burned')
            expectEqual(isAttached(turn.doll), false, 'attached')
        },
    },
    {
        name: 'with queued mutations ( the browser ) Blood Doll is still put on its vampire, and moves blood',
        run() {
            const turn = createDollTurn([2])
            const [vampire] = turn.vampires
            const pool = turn.player.pool
            const queue = registerQueuedMutationTrigger()
            const flush = () => {
                while (queue.queued() > 0) {
                    queue.flush()
                }
            }
            try {
                playDoll(turn, vampire)
                flush()
                expectEqual(getHost(turn.doll), vampire, 'host')
                expectEqual(turn.doll.region, turn.player.ready, 'region')

                applyMoveBlood(turn, true)
                flush()
                expectEqual(vampire.blood, 1, 'blood of the vampire')
                expectEqual(turn.player.pool, pool + 1, 'pool')
            } finally {
                registerSyncMutationTrigger()
            }
        },
    },
    {
        name: 'the Govern agent puts a Blood Doll on its biggest vampire, then banks the blood past half its capacity',
        run() {
            const turn = createDollTurn([2, 6])
            const [small, big] = turn.vampires
            small.minionAttrs.capacity = 6
            big.minionAttrs.capacity = 9
            turn.torpid.minionAttrs.capacity = 3
            const agent = new GovernAgent()

            const first = stepBot(turn.player, agent)
            expectEqual(first?.option.type, 'playMaster', 'first option')
            expectEqual(getHost(turn.doll), big, 'the doll goes on the biggest vampire')

            const second = stepBot(turn.player, agent)
            expectEqual(second?.option.type, 'moveBlood', 'second option')
            expectEqual(big.blood, 5, 'blood moved to the pool')

            expectEqual(stepBot(turn.player, agent)?.option.type, 'endPhase', 'then nothing to do')
        },
    },
    {
        name: 'a card is put on the minions that fit its filter: vampire or minion, clan, sect, capacity, not in torpor',
        run() {
            const turn = createDollTurn([2, 3])
            const [ventrue, toreador] = turn.vampires
            ventrue.vampireAttrs.clan = 'Ventrue'
            ventrue.vampireAttrs.sect = 'Camarilla'
            ventrue.minionAttrs.capacity = 8
            toreador.vampireAttrs.clan = 'Toreador'
            toreador.vampireAttrs.sect = 'Anarch'
            toreador.minionAttrs.capacity = 5

            const matches = (vampire: Vampire, filter: MinionFilter) =>
                matchesMinionFilter(vampire, filter)
            expectEqual(matches(ventrue, aVampire({ clan: 'Ventrue', minCapacity: 8 })), true, 'a')
            expectEqual(matches(ventrue, aVampire({ clan: 'ventrue' })), true, 'case')
            expectEqual(matches(ventrue, aVampire({ clan: 'Ventrue', minCapacity: 9 })), false, 'b')
            expectEqual(matches(toreador, aVampire({ clan: 'Ventrue' })), false, 'clan')
            expectEqual(matches(toreador, aMinion({ maxCapacity: 5 })), true, 'max capacity')
            expectEqual(matches(toreador, aMinion({ maxCapacity: 4 })), false, 'too big')
            expectEqual(matches(toreador, aVampire({ sect: 'Anarch' })), true, 'sect')
            expectEqual(matches(ventrue, aVampire({ sect: 'Anarch' })), false, 'other sect')

            const fitting = (filter: MinionFilter) => getAttachCandidates(turn.player, filter)
            expectEqual(fitting(aVampire()).length, 3, 'any vampire, torpor included')
            expectEqual(fitting(aVampire({ ready: true })).includes(turn.torpid), false, 'ready')
            expectEqual(
                fitting(aVampire({ clan: 'Ventrue', minCapacity: 8 }))
                    .map(minion => minion.name)
                    .join(),
                ventrue.name,
                'clan and capacity',
            )
        },
    },
    {
        name: 'an action card put on a chosen minion has the minions that fit as targets, and goes on its target',
        run() {
            const turn = createDollTurn([3, 3])
            const [ventrue, toreador] = turn.vampires
            ventrue.vampireAttrs.clan = 'Ventrue'
            toreador.vampireAttrs.clan = 'Toreador'
            const def = defineCard('999999', 'Test card', [
                attachToMinion([strengthEffect(1)], undefined, {
                    to: aVampire({ clan: 'Ventrue' }),
                    onePerMinion: true,
                }),
            ])
            const Implementation = actionImplementation(def)

            const targets = new Implementation(toreador, {}).getTargets()
            expectEqual(targets.length == 1 && targets[0] == ventrue, true, 'targets')
            const onVentrue = new Implementation(toreador, { target: ventrue })
            must(onVentrue.canDeclare(), 'on the Ventrue')
            expectEqual(onVentrue.attachHost, ventrue, 'the card goes on its target')
            mustRefuse(new Implementation(toreador, { target: toreador }).canDeclare(), 'clan')
            mustRefuse(new Implementation(toreador, {}).canDeclare(), 'no target')
        },
    },
    {
        name: 'Preternatural Strength is offered to a vampire with Potence, at each level it has',
        run() {
            expectEqual(equipOptions(createStrengthTurn(null)).mine.length, 0, 'no Potence')
            expectEqual(
                equipOptions(createStrengthTurn(DisciplineLevel.INFERIOR)).mine.length,
                1,
                'inferior',
            )
            expectEqual(
                equipOptions(createStrengthTurn(DisciplineLevel.SUPERIOR)).mine.length,
                2,
                'superior',
            )
        },
    },
    {
        name: 'Preternatural Strength at superior: +2 stealth, costs 1 blood, and puts +2 strength on the acting vampire',
        run() {
            const turn = createStrengthTurn(DisciplineLevel.SUPERIOR)
            const { decision, mine } = equipOptions(turn)
            const superior = mine.find(option => levelOf(option) == DisciplineLevel.SUPERIOR)
            if (!superior) {
                throw new ScenarioFailure('No superior option')
            }
            const strengthBefore = getMinionStrength(turn.ready)
            applyOption(decision, superior)
            expectEqual(turn.gameState.action?.stealth, 2, 'stealth of the action')
            resolveAction(turn)

            expectEqual(getHost(turn.card), turn.ready, 'host')
            expectEqual(turn.ready.blood, 4, 'blood after the 1 blood cost')
            expectEqual(
                getDecisionPoint(turn.gameState, turn.player)?.kind == DecisionKind.Cleanup,
                false,
                'the card is kept, nothing to clean up',
            )
            expectEqual(getMinionStrength(turn.ready), strengthBefore + 2, 'strength')
            const combat = createCombatState(turn.ready, turn.torpid)
            expectEqual(combat.acting.strength, strengthBefore + 2, 'strength in combat')
            expectEqual(
                createHandStrike(combat.acting).damage,
                strengthBefore + 2,
                'damage of the hand strike',
            )
            expectEqual(turn.ready.minionAttrs.strength, strengthBefore, 'the printed strength')
        },
    },
    {
        name: 'Preternatural Strength at inferior gives +1 strength, and none once it is gone',
        run() {
            const turn = createStrengthTurn(DisciplineLevel.INFERIOR)
            const strengthBefore = getMinionStrength(turn.ready)
            const { decision, mine } = equipOptions(turn)
            applyOption(decision, mine[0])
            resolveAction(turn)
            expectEqual(getMinionStrength(turn.ready), strengthBefore + 1, 'strength')

            turn.gameState.moveCardToRegion(turn.card, turn.player.ashHeap)
            expectEqual(getMinionStrength(turn.ready), strengthBefore, 'once gone')
        },
    },
    {
        name: 'Preternatural Strength is discarded when its action fails, and nothing is put on the vampire',
        run() {
            const turn = createStrengthTurn(DisciplineLevel.INFERIOR)
            const strengthBefore = getMinionStrength(turn.ready)
            const { decision, mine } = equipOptions(turn)
            applyOption(decision, mine[0])
            must(gameMutations.ACTION_endAction.act(turn.player, {}), 'end the action')

            const cleanup = getDecisionPoint(turn.gameState, turn.player)
            if (cleanup?.kind != DecisionKind.Cleanup) {
                throw new ScenarioFailure(`Expected a cleanup, got ${cleanup?.kind}`)
            }
            applyOption(cleanup, cleanup.options[0])
            expectEqual(turn.card.isIn.ashHeap, true, 'the card is discarded')
            expectEqual(getMinionStrength(turn.ready), strengthBefore, 'strength')
        },
    },
    {
        name: 'a vampire can have only one Preternatural Strength, another vampire can have its own',
        run() {
            const turn = createStrengthTurn(DisciplineLevel.INFERIOR)
            const { gameState, player, ready } = turn
            const other = readyVampire(gameState, player, 5)
            setPotence(other, DisciplineLevel.INFERIOR)
            attachInPlay(turn.card, ready, {
                disciplines: [{ discipline: Discipline.Potence, level: DisciplineLevel.INFERIOR }],
            })

            const second = giveCard(gameState, player, PRETERNATURAL_ID)
            const decision = getDecisionPoint(gameState, player)
            const actors = optionsOfType(decision?.options ?? [], 'declareAction').flatMap(
                option =>
                    (
                        option.action.type == MinionActionType.ActionCardFromHand &&
                        option.action.card == second
                    ) ?
                        [option.action.actingMinion]
                    :   [],
            )
            expectEqual(actors.includes(ready), false, 'the vampire that has one')
            expectEqual(actors.includes(other), true, 'the other vampire')
            mustRefuse(
                canDeclare(
                    createActionCardAction(ready, second, {
                        disciplines: [
                            { discipline: Discipline.Potence, level: DisciplineLevel.INFERIOR },
                        ],
                    }),
                ),
                'a second copy',
            )
        },
    },
    {
        name: 'a vampire with Preternatural Strength cannot play Torn Signpost',
        run() {
            const deck = { ...BrujahDeck, [PRETERNATURAL_ID]: 2 }
            const fight = createFight(3, 3, deck)
            const { gameState, acting, actingPlayer } = fight
            acting.minionAttrs.strength = 1
            getCombat(fight).acting.strength = 1
            acting.minionAttrs.disciplines = {} as Disciplines
            acting.minionAttrs.disciplines[Discipline.Potence] = DisciplineLevel.SUPERIOR
            emptyHand(gameState, actingPlayer)
            const signpost = giveCard(gameState, actingPlayer, TORN_SIGNPOST_ID)
            sealLibrary(gameState, fight.defendingPlayer)
            const strengthOptions = () =>
                getCombatCardOptions(acting).filter(
                    option => option.type == 'combatStrength' && option.card == signpost,
                )
            expectEqual(strengthOptions().length, 2, 'before')

            const preternatural = findCard(actingPlayer, PRETERNATURAL_ID)
            attachInPlay(preternatural, acting, { disciplines: POTENCE_SUPERIOR })
            expectEqual(strengthOptions().length, 0, 'with Preternatural Strength')

            gameState.moveCardToRegion(preternatural, actingPlayer.ashHeap)
            expectEqual(strengthOptions().length, 2, 'once it is gone')
        },
    },
    {
        name: 'Heroic Might is offered to a vampire with Potence, at each level it has',
        run() {
            const options = (level: DisciplineLevel | null) => {
                const turn = createEquipTurn(HEROIC_MIGHT_ID)
                setPotence(turn.ready, level)
                return equipOptions(turn).mine
            }
            expectEqual(options(null).length, 0, 'no Potence')
            expectEqual(options(DisciplineLevel.INFERIOR).length, 1, 'inferior')
            expectEqual(options(DisciplineLevel.SUPERIOR).length, 2, 'superior')
        },
    },
    {
        name: 'Heroic Might: +3 stealth, costs 3 blood, +1 strength at inferior and +2 at superior',
        run() {
            const cases = [
                { level: DisciplineLevel.INFERIOR, strength: 1 },
                { level: DisciplineLevel.SUPERIOR, strength: 2 },
            ]
            for (const { level, strength } of cases) {
                const turn = createEquipTurn(HEROIC_MIGHT_ID)
                setPotence(turn.ready, level)
                const strengthBefore = getMinionStrength(turn.ready)
                const { decision, mine } = equipOptions(turn)
                const option = mine.find(candidate => levelOf(candidate) == level)
                if (!option) {
                    throw new ScenarioFailure(`No option at ${level}`)
                }
                applyOption(decision, option)
                expectEqual(turn.gameState.action?.stealth, 3, `stealth at ${level}`)
                resolveAction(turn)

                expectEqual(getHost(turn.card), turn.ready, `host at ${level}`)
                expectEqual(turn.ready.blood, 2, `blood after the 3 blood cost at ${level}`)
                expectEqual(
                    getMinionStrength(turn.ready),
                    strengthBefore + strength,
                    `strength at ${level}`,
                )
            }
        },
    },
    {
        name: 'Heroic Might: only a superior one gives a 2R strike, and a vampire has only one',
        run() {
            const strikeOf = (use: DisciplineUse[]) => {
                const fight = createFight(3, 3, AttachDeck)
                const might = findCard(fight.actingPlayer, HEROIC_MIGHT_ID)
                attachInPlay(might, fight.acting, { disciplines: use })
                passUntil(fight, CombatStep.Strike)
                const strikes = optionsOfType(
                    getCombatDecision(fight, fight.actingPlayer).options,
                    'combatStrike',
                )
                return strikes.filter(option => option.strike.source == might)
            }
            expectEqual(strikeOf(POTENCE_INFERIOR).length, 0, 'inferior')
            const superior = strikeOf(POTENCE_SUPERIOR)
            expectEqual(superior.length, 1, 'superior')
            expectEqual(superior[0].strike.damage, 2, 'damage')
            expectEqual(superior[0].strike.ranged, true, 'ranged')

            const turn = createEquipTurn(HEROIC_MIGHT_ID)
            setPotence(turn.ready, DisciplineLevel.INFERIOR)
            attachInPlay(turn.card, turn.ready, { disciplines: POTENCE_INFERIOR })
            const second = giveCard(turn.gameState, turn.player, HEROIC_MIGHT_ID)
            mustRefuse(
                canDeclare(
                    createActionCardAction(turn.ready, second, { disciplines: POTENCE_INFERIOR }),
                ),
                'a second copy',
            )
        },
    },
    {
        name: 'Heroic Might is burned when its vampire goes to torpor',
        run() {
            const fight = createFight(3, 1, AttachDeck)
            const might = findCard(fight.defendingPlayer, HEROIC_MIGHT_ID)
            attachInPlay(might, fight.defending, { disciplines: POTENCE_SUPERIOR })
            damageResolution(fight, fight.defending, 5, 0)
            passUntil(fight, CombatStep.EndOfRound)
            expectRegion(fight.defending, 'torpor')
            expectEqual(might.isIn.ashHeap, true, 'burned')
        },
    },
]
