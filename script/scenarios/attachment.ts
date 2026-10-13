import { LibraryCard } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { createStrike, createDodgeStrike, createHandStrike } from '@/shared/state/combatState.ts'
import { DisciplineUse, MinionActionType, CombatStep, CombatRange } from '@/shared/types/state.ts'
import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { TORPOR_ZONE_Y } from '@/shared/const/game.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { isAttached, getHost, getAttachedCards } from '@/shared/state/attachments.ts'
import { getAttachedCombatOptions } from '@/shared/bot/cardOptions.ts'
import { getMinionIntercept } from '@/shared/cardImpl/catalog/attached.ts'
import { hasUniqueCopyInPlay } from '@/shared/state/cardRequirements.ts'
import { createActionCardAction, createBleedAction } from '@/shared/state/minionActionFactories.ts'
import { GovernAgent } from '@/shared/bot/agents/governAgent.ts'
import { registerQueuedMutationTrigger, registerSyncMutationTrigger } from '../harness.ts'
import { AttachDeck } from '../attachDeck.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { applyOption, getDecisionPoint, getDecidingPlayer } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { BotOptionOf, DecisionPoint, optionsOfType, DecisionKind } from '@/shared/bot/types.ts'
import { PassiveAgent, createMinionPhase, getActionOptions, resolveAction } from './torpor.ts'
import { emptyHand } from './bounce.ts'
import {
    Scenario,
    ScenarioFailure,
    attachInPlay,
    createFight,
    expectEqual,
    expectRegion,
    findCard,
    getCombat,
    giveCard,
    must,
    mustRefuse,
    passUntil,
    readyVampire,
    strikeRoundToEnd,
} from './helpers.ts'
import { createHumanTable, humanDeclares } from './humanAction.ts'
import { getCombatDecision } from './combatCards.ts'

/**
 * Attachment: an equipment or a retainer a bot plays stays in play attached to the minion that
 * took the action, once the action succeeded. What it does once attached: a weapon gives its
 * bearer a strike ( .44 Magnum ), a retainer gives life counters and intercept ( Raven Spy ).
 */

export const MAGNUM_ID = '100001'

export const RAVEN_SPY_ID = '101550'

// A unique equipment, which the catalog does not describe
const IVORY_BOW_ID = '101014'

export const SPY_INFERIOR: DisciplineUse[] = [
    { discipline: Discipline.Animalism, level: DisciplineLevel.INFERIOR },
]

// The minion phase of a player holding only the card, with its ready vampire at a known place.
// The Animalism of the vampire is set when given ( null: it has none ).
export function createEquipTurn(
    cardId: string,
    deck: DeckList = AttachDeck,
    animalism?: DisciplineLevel | null,
) {
    const turn = createMinionPhase(5, 0, deck)
    const { gameState, player } = turn
    emptyHand(gameState, player)
    const card = giveCard(gameState, player, cardId)
    turn.ready.x = 100
    turn.ready.y = 100
    if (animalism) {
        turn.ready.minionAttrs.disciplines[Discipline.Animalism] = animalism
    } else if (animalism === null) {
        turn.ready.minionAttrs.disciplines = Object.fromEntries(
            Object.entries(turn.ready.minionAttrs.disciplines).filter(
                ([name]) => name != Discipline.Animalism,
            ),
        ) as Disciplines
    }
    return { ...turn, card }
}

export const equipOptions = (turn: ReturnType<typeof createEquipTurn>) => {
    const { decision, options } = getActionOptions(turn, MinionActionType.ActionCardFromHand)
    return {
        decision,
        mine: options.filter(
            option =>
                option.action.type == MinionActionType.ActionCardFromHand &&
                option.action.card == turn.card,
        ),
    }
}

export const levelOf = (option: BotOptionOf<'declareAction'>) =>
    option.action.type == MinionActionType.ActionCardFromHand ?
        option.action.usage.disciplines?.[0]?.level
    :   undefined

// The cards of the other players are sealed away in the scenarios with a human table
export function findAnyCard(player: Player, krcgId: string): LibraryCard {
    const card = [...player.library.cards, ...player.hand.cards, ...player.removed.cards].find(
        candidate => candidate.krcgId == krcgId,
    )
    if (!(card instanceof LibraryCard)) {
        throw new ScenarioFailure(`Card ${krcgId} not found`)
    }
    return card
}

const weaponManeuvers = (decision: DecisionPoint) =>
    optionsOfType(decision.options, 'combatManeuver').filter(option => option.weapon)

export const ATTACHMENT_SCENARIOS: Scenario[] = [
    {
        name: 'an equipment is offered as an undirected action of each ready minion, with no target',
        run() {
            const turn = createEquipTurn(MAGNUM_ID)
            const { mine } = equipOptions(turn)
            expectEqual(mine.length, 1, 'options')
            expectEqual(mine[0].action.actingMinion, turn.ready, 'acting minion')
            expectEqual(mine[0].action.target, undefined, 'target')
        },
    },
    {
        name: 'a resolved equip action attaches the card under its minion, shifted to the top-right, and pays the pool',
        run() {
            const turn = createEquipTurn(MAGNUM_ID)
            const { decision, mine } = equipOptions(turn)
            const pool = turn.player.pool
            applyOption(decision, mine[0])
            expectEqual(isAttached(turn.card), false, 'attached before the action succeeds')
            resolveAction(turn)

            expectEqual(getHost(turn.card), turn.ready, 'host')
            expectEqual(getAttachedCards(turn.ready).length, 1, 'attached cards')
            expectEqual(turn.card.region, turn.player.ready, 'region')
            expectEqual(turn.card.position < turn.ready.position, true, 'drawn under the minion')
            expectEqual(turn.card.x > turn.ready.x, true, 'shifted to the right')
            expectEqual(turn.card.y < turn.ready.y, true, 'shifted to the top')
            expectEqual(turn.player.pool, pool - 2, 'pool')

            // The card is kept: nothing to clean up
            const next = getDecisionPoint(turn.gameState, turn.player)
            expectEqual(next?.kind == DecisionKind.Cleanup, false, 'cleanup')
            expectEqual(turn.card.isIn.ready, true, 'still in play')
        },
    },
    {
        name: 'two cards on the same minion stick out one after the other, both under it',
        run() {
            const turn = createEquipTurn(MAGNUM_ID)
            const second = giveCard(turn.gameState, turn.player, RAVEN_SPY_ID)
            for (const card of [turn.card, second]) {
                turn.gameState.moveCardToRegion(card, turn.player.ready)
                must(
                    botMutations.attachCard.act(turn.player, { card, minion: turn.ready }),
                    'attach',
                )
            }
            expectEqual(getAttachedCards(turn.ready).length, 2, 'attached cards')
            expectEqual(second.x > turn.card.x, true, 'the second sticks out further')
            expectEqual(second.y < turn.card.y, true, 'the second is higher')
            expectEqual(
                Math.max(turn.card.position, second.position) < turn.ready.position,
                true,
                'both under the minion',
            )
        },
    },
    {
        name: 'a retainer needs the discipline: no Animalism, no Raven Spy',
        run() {
            const turn = createEquipTurn(RAVEN_SPY_ID, AttachDeck, null)
            expectEqual(equipOptions(turn).mine.length, 0, 'options')
        },
    },
    {
        name: 'an inferior Raven Spy is paid with blood and comes in play with 1 life',
        run() {
            const turn = createEquipTurn(RAVEN_SPY_ID, AttachDeck, DisciplineLevel.INFERIOR)
            const { decision, mine } = equipOptions(turn)
            expectEqual(mine.length, 1, 'options')
            expectEqual(levelOf(mine[0]), DisciplineLevel.INFERIOR, 'level')
            applyOption(decision, mine[0])
            resolveAction(turn)
            expectEqual(getHost(turn.card), turn.ready, 'host')
            expectEqual(turn.ready.blood, 4, 'blood after the 1 blood cost')
            expectEqual(turn.card.blood, 1, 'life of the retainer')
            expectEqual(
                turn.gameState.attachmentUsages[turn.card.oid]?.[0]?.level,
                DisciplineLevel.INFERIOR,
                'the version is remembered',
            )
        },
    },
    {
        name: 'a superior minion can play Raven Spy at both levels, the superior one has 2 life',
        run() {
            const turn = createEquipTurn(RAVEN_SPY_ID, AttachDeck, DisciplineLevel.SUPERIOR)
            const { decision, mine } = equipOptions(turn)
            expectEqual(mine.length, 2, 'options')
            const superior = mine.find(option => levelOf(option) == DisciplineLevel.SUPERIOR)
            if (!superior) {
                throw new ScenarioFailure('No superior option')
            }
            applyOption(decision, superior)
            resolveAction(turn)
            expectEqual(turn.card.blood, 2, 'life of the retainer')
            expectEqual(
                turn.gameState.attachmentUsages[turn.card.oid]?.[0]?.level,
                DisciplineLevel.SUPERIOR,
                'the version is remembered',
            )
        },
    },
    {
        name: 'an equip action that fails leaves nothing paid and the card goes to the ash heap',
        run() {
            const turn = createEquipTurn(MAGNUM_ID)
            const { decision, mine } = equipOptions(turn)
            const pool = turn.player.pool
            applyOption(decision, mine[0])
            must(gameMutations.ACTION_endAction.act(turn.player, {}), 'end the action')

            const cleanup = getDecisionPoint(turn.gameState, turn.player)
            if (cleanup?.kind != DecisionKind.Cleanup) {
                throw new ScenarioFailure(`Expected a cleanup, got ${cleanup?.kind}`)
            }
            applyOption(cleanup, cleanup.options[0])
            expectEqual(turn.card.isIn.ashHeap, true, 'the card is discarded')
            expectEqual(isAttached(turn.card), false, 'attached')
            expectEqual(turn.player.pool, pool, 'pool')
        },
    },
    {
        name: 'a unique equipment is seen as in play while another copy is, whoever has it',
        run() {
            const deck = { ...AttachDeck, [IVORY_BOW_ID]: 2 }
            const turn = createEquipTurn(IVORY_BOW_ID, deck)
            expectEqual(hasUniqueCopyInPlay(turn.player, turn.card), false, 'no copy in play')

            const other = turn.gameState.competingPlayers.find(player => player != turn.player)
            if (!other) {
                throw new ScenarioFailure('No other player')
            }
            const copy = findCard(other, IVORY_BOW_ID)
            attachInPlay(copy, readyVampire(turn.gameState, other, 3))
            expectEqual(hasUniqueCopyInPlay(turn.player, turn.card), true, 'a copy is attached')
        },
    },
    {
        name: 'the attached cards follow their minion to torpor and burn with it',
        run() {
            const turn = createEquipTurn(MAGNUM_ID)
            const { gameState, player, card, ready } = turn
            attachInPlay(card, ready, { disciplines: SPY_INFERIOR })

            must(
                gameMutations.moveCardToRegion.act(player, {
                    card: ready,
                    fromCardRegion: player.ready,
                    toCardRegion: player.torpor,
                    x: 0,
                    y: TORPOR_ZONE_Y,
                }),
                'to torpor',
            )
            expectEqual(card.isIn.torpor, true, 'the card follows to torpor')
            expectEqual(getHost(card), ready, 'still attached')
            expectEqual(card.position < ready.position, true, 'under the minion')

            must(
                gameMutations.moveCardToRegion.act(player, {
                    card: ready,
                    fromCardRegion: player.torpor,
                    toCardRegion: player.ashHeap,
                    x: 0,
                    y: 0,
                }),
                'burn the minion',
            )
            expectEqual(card.isIn.ashHeap, true, 'the card burns with the minion')
            expectEqual(isAttached(card), false, 'attached')
            expectEqual(Object.keys(gameState.attachments).length, 0, 'no attachment left')
            expectEqual(Object.keys(gameState.attachmentUsages).length, 0, 'no usage left')
        },
    },
    {
        name: 'a minion that goes to torpor in combat takes its attached cards with it',
        run() {
            const fight = createFight(3, 1, AttachDeck)
            const { defendingPlayer, defending } = fight
            const card = findCard(defendingPlayer, MAGNUM_ID)
            attachInPlay(card, defending)
            strikeRoundToEnd(fight, createStrike('Quick', { damage: 2, firstStrike: true }))
            expectRegion(defending, 'torpor')
            expectEqual(card.isIn.torpor, true, 'the card follows to torpor')
            expectEqual(getHost(card), defending, 'still attached')
        },
    },
    {
        name: 'an attached card that leaves play is detached, its minion stays',
        run() {
            const turn = createEquipTurn(MAGNUM_ID)
            const { gameState, player, card, ready } = turn
            attachInPlay(card, ready)
            gameState.moveCardToRegion(card, player.ashHeap)
            expectEqual(isAttached(card), false, 'attached')
            expectEqual(ready.isIn.ready, true, 'the minion stays')
        },
    },
    {
        name: 'a minion cannot be attached, nor a card to itself',
        run() {
            const turn = createEquipTurn(MAGNUM_ID)
            const { player, ready, torpid } = turn
            mustRefuse(
                botMutations.attachCard.act(player, { card: torpid, minion: ready }),
                'a minion',
            )
            mustRefuse(
                botMutations.attachCard.act(player, { card: ready, minion: ready }),
                'itself',
            )
        },
    },
    {
        name: 'with queued mutations ( the browser ) a retainer still ends attached, with its life',
        run() {
            const turn = createEquipTurn(RAVEN_SPY_ID, AttachDeck, DisciplineLevel.INFERIOR)
            const queue = registerQueuedMutationTrigger()
            const flush = () => {
                while (queue.queued() > 0) {
                    queue.flush()
                }
            }
            try {
                const { decision, mine } = equipOptions(turn)
                applyOption(decision, mine[0])
                flush()
                const agent = new PassiveAgent()
                for (let i = 0; i < 20 && turn.gameState.action; i++) {
                    const player = getDecidingPlayer(turn.gameState)
                    if (!player) {
                        throw new ScenarioFailure('Nobody has the impulse during the action')
                    }
                    stepBot(player, agent)
                    flush()
                }
                expectEqual(turn.gameState.action, null, 'action in progress')
                expectEqual(getHost(turn.card), turn.ready, 'host')
                expectEqual(turn.card.position < turn.ready.position, true, 'under the minion')
                expectEqual(turn.card.blood, 1, 'life of the retainer')
                expectEqual(
                    turn.gameState.attachmentUsages[turn.card.oid]?.[0]?.level,
                    DisciplineLevel.INFERIOR,
                    'the version is remembered',
                )
            } finally {
                registerSyncMutationTrigger()
            }
        },
    },
    {
        name: 'the equipment a human plays is not attached by the engine',
        run() {
            const table = createHumanTable(2, MAGNUM_ID, AttachDeck)
            const card = table.card
            if (!card) {
                throw new ScenarioFailure('The human has no card')
            }
            humanDeclares(table, createActionCardAction(table.acting, card, {}))
            // The human puts the card on the table by hand
            table.gameState.moveCardToRegion(card, table.human.ready)
            const pool = table.human.pool
            must(botMutations.ACTION_resolveAction.act(table.human, {}), 'resolve')
            expectEqual(table.human.pool, pool - 2, 'the cost is paid')
            expectEqual(isAttached(card), false, 'attached')
            expectEqual(card.isIn.ready, true, 'the human keeps the card where it is')
        },
    },
    {
        name: '.44 Magnum: its bearer gets a free ranged strike of 2 and a maneuver that chooses it, not the opposing minion',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const magnum = findCard(fight.actingPlayer, MAGNUM_ID)
            attachInPlay(magnum, fight.acting)

            passUntil(fight, CombatStep.DetermineRange)
            const maneuvers = weaponManeuvers(getCombatDecision(fight, fight.actingPlayer))
            expectEqual(maneuvers.length, 1, 'weapon maneuvers')
            expectEqual(maneuvers[0].weapon, magnum, 'weapon')
            expectEqual(maneuvers[0].card, undefined, 'no card to play')
            expectEqual(maneuvers[0].strike?.damage, 2, 'damage')
            expectEqual(maneuvers[0].strike?.ranged, true, 'ranged')
            expectEqual(maneuvers[0].strike?.source, magnum, 'source')

            passUntil(fight, CombatStep.Strike)
            const strikes = optionsOfType(
                getCombatDecision(fight, fight.actingPlayer).options,
                'combatStrike',
            )
            const weapon = strikes.filter(option => option.strike.source == magnum)
            expectEqual(weapon.length, 1, 'weapon strikes')
            expectEqual(weapon[0].card, undefined, 'no card to play')
            expectEqual(
                strikes.some(option => option.strike.isHand),
                true,
                'the hand strike',
            )
            expectEqual(getAttachedCombatOptions(fight.defending).length, 0, 'the opponent')
        },
    },
    {
        name: '.44 Magnum: the maneuver goes to long range and chooses the strike, which hits where hands cannot',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const magnum = findCard(fight.actingPlayer, MAGNUM_ID)
            attachInPlay(magnum, fight.acting)

            passUntil(fight, CombatStep.DetermineRange)
            const decision = getCombatDecision(fight, fight.actingPlayer)
            applyOption(decision, weaponManeuvers(decision)[0])
            expectEqual(getCombat(fight).range, CombatRange.Long, 'range')
            expectEqual(getCombat(fight).acting.strike?.source, magnum, 'the strike is chosen')
            expectEqual(getCombat(fight).weaponManeuvers.includes(magnum.oid), true, 'recorded')

            strikeRoundToEnd(fight)
            passUntil(fight, null)
            expectEqual(fight.defending.blood, 1, 'defending blood (the 2R strike)')
            expectEqual(fight.acting.blood, 3, 'acting blood (the hand strike is out of range)')
        },
    },
    {
        name: '.44 Magnum: the maneuver is given once per combat, the strike stays available',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const magnum = findCard(fight.actingPlayer, MAGNUM_ID)
            attachInPlay(magnum, fight.acting)

            passUntil(fight, CombatStep.DetermineRange)
            const decision = getCombatDecision(fight, fight.actingPlayer)
            const maneuver = weaponManeuvers(decision)[0]
            applyOption(decision, maneuver)

            // Back to a fresh window of the range step: the weapon has already given its maneuver
            const combat = getCombat(fight)
            combat.acting.strike = null
            combat.lastPlayedBy = null
            combat.impulsePlayer = fight.actingPlayer
            mustRefuse(
                botMutations.COMBAT_maneuver.act(fight.actingPlayer, {
                    minion: fight.acting,
                    strike: maneuver.strike,
                    weapon: magnum,
                }),
                'a second maneuver of the weapon',
            )
            expectEqual(
                weaponManeuvers(getCombatDecision(fight, fight.actingPlayer)).length,
                0,
                'offered again',
            )

            passUntil(fight, CombatStep.Strike)
            const strikes = optionsOfType(
                getCombatDecision(fight, fight.actingPlayer).options,
                'combatStrike',
            )
            expectEqual(
                strikes.some(option => option.strike.source == magnum),
                true,
                'the strike',
            )
        },
    },
    {
        name: '.44 Magnum: only hand strikes under a grapple',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const magnum = findCard(fight.actingPlayer, MAGNUM_ID)
            attachInPlay(magnum, fight.acting)
            passUntil(fight, CombatStep.Strike)
            getCombat(fight).handStrikesOnly = true
            const strikes = optionsOfType(
                getCombatDecision(fight, fight.actingPlayer).options,
                'combatStrike',
            )
            expectEqual(
                strikes.some(option => option.strike.source == magnum),
                false,
                'weapon',
            )
            expectEqual(
                strikes.some(option => option.strike.isHand),
                true,
                'hand strike',
            )
        },
    },
    {
        name: '.44 Magnum: the Govern agent strikes with it when it hits harder than its hands',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const magnum = findCard(fight.actingPlayer, MAGNUM_ID)
            attachInPlay(magnum, fight.acting)
            passUntil(fight, CombatStep.Strike)
            const step = stepBot(fight.actingPlayer, new GovernAgent())
            expectEqual(step?.option.type, 'combatStrike', 'option')
            expectEqual(
                step?.option.type == 'combatStrike' ? step.option.strike.source : null,
                magnum,
                'the weapon strikes',
            )
        },
    },
    {
        name: '.44 Magnum: the Govern agent that is weaker uses the maneuver of the weapon to shoot from afar',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const magnum = findCard(fight.actingPlayer, MAGNUM_ID)
            attachInPlay(magnum, fight.acting)
            getCombat(fight).acting.strength = 1
            getCombat(fight).defending.strength = 2
            passUntil(fight, CombatStep.DetermineRange)
            const step = stepBot(fight.actingPlayer, new GovernAgent())
            expectEqual(step?.option.type, 'combatManeuver', 'option')
            expectEqual(
                step?.option.type == 'combatManeuver' ? step.option.weapon : null,
                magnum,
                'the weapon maneuvers',
            )
            expectEqual(getCombat(fight).range, CombatRange.Long, 'range')
        },
    },
    {
        name: 'Raven Spy: its employer gets +1 intercept, whatever the version, as long as it is attached',
        run() {
            const turn = createEquipTurn(RAVEN_SPY_ID, AttachDeck, DisciplineLevel.INFERIOR)
            const { ready, card } = turn
            const base = ready.minionAttrs.intercept
            expectEqual(getMinionIntercept(ready), base, 'unattached')

            attachInPlay(card, ready, { life: 1, disciplines: SPY_INFERIOR })
            expectEqual(getMinionIntercept(ready), base + 1, 'inferior')

            turn.gameState.attachmentUsages[card.oid] = [
                { discipline: Discipline.Animalism, level: DisciplineLevel.SUPERIOR },
            ]
            expectEqual(getMinionIntercept(ready), base + 1, 'superior')

            // A retainer with no record ( stolen from a human ) counts as its first version
            delete turn.gameState.attachmentUsages[card.oid]
            expectEqual(getMinionIntercept(ready), base + 1, 'no record')

            turn.gameState.moveCardToRegion(card, turn.player.ashHeap)
            expectEqual(getMinionIntercept(ready), base, 'once gone')
        },
    },
    {
        name: 'Raven Spy: the intercept counts when its employer blocks',
        run() {
            const table = createHumanTable(2, undefined, AttachDeck)
            const [prey] = table.others
            const blocker = table.blockers[0]
            attachInPlay(findAnyCard(prey, RAVEN_SPY_ID), blocker, {
                life: 1,
                disciplines: SPY_INFERIOR,
            })
            humanDeclares(table, createBleedAction(table.acting, prey))
            if (!table.gameState.action) {
                throw new ScenarioFailure('No action')
            }
            // Alone, the intercept of the blocker would not be enough
            table.gameState.action.stealth = 2
            const step = stepBot(prey, new GovernAgent())
            expectEqual(step?.option.type, 'block', 'the bot blocks')
            expectEqual(table.gameState.action?.intercept, 2, 'intercept of the block attempt')
        },
    },
    {
        name: 'Raven Spy: a strike aimed at it burns its life, not the blood of its employer',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const spy = findCard(fight.defendingPlayer, RAVEN_SPY_ID)
            attachInPlay(spy, fight.defending, { life: 2, disciplines: SPY_INFERIOR })

            const aimed = getAttachedCombatOptions(fight.acting).find(
                option => option.type == 'combatStrike' && option.strike.retainer == spy,
            )
            if (aimed?.type != 'combatStrike') {
                throw new ScenarioFailure('The strike at the retainer is not offered')
            }
            strikeRoundToEnd(fight, aimed.strike)
            expectEqual(spy.blood, 1, 'life of the retainer')
            expectEqual(getHost(spy), fight.defending, 'still attached')
            expectEqual(fight.defending.blood, 3, 'the employer is not hurt')
            expectEqual(fight.acting.blood, 2, 'the hand strike of the employer')
        },
    },
    {
        name: 'Raven Spy: a retainer with no life left is burned, its employer loses the intercept',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const spy = findCard(fight.defendingPlayer, RAVEN_SPY_ID)
            attachInPlay(spy, fight.defending, { life: 1, disciplines: SPY_INFERIOR })
            const base = fight.defending.minionAttrs.intercept
            expectEqual(getMinionIntercept(fight.defending), base + 1, 'before')

            const aimed = getAttachedCombatOptions(fight.acting).find(
                option => option.type == 'combatStrike' && option.strike.retainer == spy,
            )
            if (aimed?.type != 'combatStrike') {
                throw new ScenarioFailure('The strike at the retainer is not offered')
            }
            strikeRoundToEnd(fight, aimed.strike)
            expectEqual(spy.isIn.ashHeap, true, 'burned')
            expectEqual(isAttached(spy), false, 'attached')
            expectEqual(Object.keys(fight.gameState.attachmentUsages).length, 0, 'usage left')
            expectEqual(getMinionIntercept(fight.defending), base, 'after')
            expectEqual(fight.defending.blood, 3, 'the employer is not hurt')
        },
    },
    {
        name: 'Raven Spy: a dodge protects it from the strike aimed at it',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const spy = findCard(fight.defendingPlayer, RAVEN_SPY_ID)
            attachInPlay(spy, fight.defending, { life: 1, disciplines: SPY_INFERIOR })
            const aimed = getAttachedCombatOptions(fight.acting).find(
                option => option.type == 'combatStrike' && option.strike.retainer == spy,
            )
            if (aimed?.type != 'combatStrike') {
                throw new ScenarioFailure('The strike at the retainer is not offered')
            }
            strikeRoundToEnd(fight, aimed.strike, createDodgeStrike())
            expectEqual(spy.blood, 1, 'life of the retainer')
            expectEqual(getHost(spy), fight.defending, 'still attached')
        },
    },
    {
        name: 'a strike can only be aimed at a retainer of the opposing minion',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const ownSpy = findCard(fight.actingPlayer, RAVEN_SPY_ID)
            const spy = findCard(fight.defendingPlayer, RAVEN_SPY_ID)
            const magnum = findCard(fight.defendingPlayer, MAGNUM_ID)
            attachInPlay(ownSpy, fight.acting, { life: 1, disciplines: SPY_INFERIOR })
            attachInPlay(spy, fight.defending, { life: 1, disciplines: SPY_INFERIOR })
            attachInPlay(magnum, fight.defending)

            const aimed = getAttachedCombatOptions(fight.acting).flatMap(option =>
                option.type == 'combatStrike' && option.strike.retainer ?
                    [option.strike.retainer]
                :   [],
            )
            expectEqual(aimed.length, 1, 'the strikes aimed at a retainer')
            expectEqual(aimed[0], spy, 'the retainer of the opposing minion')

            passUntil(fight, CombatStep.Strike)
            mustRefuse(
                botMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
                    minion: fight.acting,
                    strike: { ...createHandStrike(getCombat(fight).acting), retainer: ownSpy },
                }),
                'a strike at an own retainer',
            )
        },
    },
]
