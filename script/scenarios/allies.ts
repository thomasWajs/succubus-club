import { LibraryCard, Minion } from '@/shared/model/Card.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { canDeclare } from '@/shared/state/minionActions.ts'
import {
    createBleedAction,
    createHuntAction,
    createRescueFromTorporAction,
} from '@/shared/state/minionActionFactories.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { MinionActionType } from '@/shared/types/state.ts'
import { DisciplineLevel, Discipline } from '@/shared/const/model.ts'
import { MalkavDeck } from '@/shared/bot/decks.ts'
import { applyOption, getDecisionPoint } from '@/shared/bot/referee.ts'
import { chooseThroughView } from '@/shared/bot/playerView.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { DecisionKind, optionsOfType } from '@/shared/bot/types.ts'
import { AttachDeck } from '../attachDeck.ts'
import { CARLTON_ID, QUI_VIVE_ID, ROYALS_ID, UNDERBRIDGE_STRAY_ID } from '../cardIds.ts'
import { resolveAction } from './torpor.ts'
import { createEquipTurn, equipOptions, levelOf } from './attachment.ts'
import { createCatalogBleed, passUntilDecides } from './catalog.ts'
import { emptyHand } from './bounce.ts'
import { createCombatState, createHandStrike, getCombatant } from '@/shared/state/combatState.ts'
import { getMinionIntercept } from '@/shared/cardImpl/catalog/attached.ts'
import { profileMinion } from '@/shared/bot/utility/minionProfile.ts'
import { CombatStep } from '@/shared/types/state.ts'
import { getCombatDecision } from './combatCards.ts'
import {
    Scenario,
    ScenarioFailure,
    createFight,
    expectEqual,
    findCard,
    getCombat,
    must,
    mustRefuse,
    passUntil,
    readyVampire,
    strikeRound,
} from './helpers.ts'

/**
 * Allies: the recruit ally action of a bot ( Underbridge Stray ). The card is an action card
 * that becomes a minion of its own once the action succeeds, with its life as blood counters.
 */

const ALLY_DECK = { ...AttachDeck, [UNDERBRIDGE_STRAY_ID]: 8, [CARLTON_ID]: 8 }

const recruitTurn = (
    level: DisciplineLevel | null = DisciplineLevel.INFERIOR,
    cardId = UNDERBRIDGE_STRAY_ID,
) => createEquipTurn(cardId, ALLY_DECK, level)

type Turn = ReturnType<typeof recruitTurn>

// The recruit action declared and resolved, nobody blocking
function recruit(turn: Turn, level: DisciplineLevel | null = DisciplineLevel.INFERIOR): void {
    const { decision, mine } = equipOptions(turn)
    const option = level ? mine.find(candidate => levelOf(candidate) == level) : mine[0]
    if (!option) {
        throw new ScenarioFailure(`The recruit at ${level} is not offered`)
    }
    applyOption(decision, option)
    resolveAction(turn)
}

// The recruited card as a minion
function allyOf(turn: Turn): Minion {
    if (!turn.card.isMinion()) {
        throw new ScenarioFailure('The card is not a minion')
    }
    return turn.card
}

const isMinionInPlay = (turn: Turn) =>
    turn.player.minionsReady.some(minion => minion.oid == turn.card.oid)

const declaredBy = (turn: Turn, type: MinionActionType) =>
    optionsOfType(getDecisionPoint(turn.gameState, turn.player)?.options ?? [], 'declareAction')
        .filter(option => option.action.type == type)
        .filter(option => option.action.actingMinion == turn.card)

// A fight between a vampire and Carlton Van Wyk, recruited, who defends
function carltonFight() {
    const fight = createFight(3, 3, ALLY_DECK)
    const { gameState, acting, defendingPlayer } = fight
    const ally = findCard(defendingPlayer, CARLTON_ID)
    gameState.moveCardToRegion(ally, defendingPlayer.ready)
    must(botMutations.recruitAlly.act(defendingPlayer, { card: ally, version: {} }), 'recruit')
    if (!ally.isMinion()) {
        throw new ScenarioFailure('Not a minion')
    }
    gameState.combat = createCombatState(acting, ally)
    return { ...fight, ally }
}

// A bleed on a player that has a recruited ally of this card, in the window of the bled player
function allyBleed(cardId: string) {
    const game = createCatalogBleed({
        deck: { ...MalkavDeck, [cardId]: 4 },
        discipline: Discipline.Dominate,
        level: DisciplineLevel.INFERIOR,
        cards: [],
        preyCards: [cardId],
    })
    const ally = findCard(game.bled, cardId)
    game.gameState.moveCardToRegion(ally, game.bled.ready)
    must(botMutations.recruitAlly.act(game.bled, { card: ally, version: {} }), 'recruit')
    return { ...game, ally }
}

function royalsBleed(bleed: number) {
    const game = allyBleed(ROYALS_ID)
    if (game.gameState.action) {
        game.gameState.action.bleed = bleed
    }
    return game
}

const strayBleed = () => allyBleed(UNDERBRIDGE_STRAY_ID)

// A bleed on a player that holds On the Qui Vive and has a recruited, locked ally of this card
function quiViveGame(cardId: string) {
    const game = createCatalogBleed({
        deck: { ...MalkavDeck, [cardId]: 4 },
        discipline: Discipline.Dominate,
        level: DisciplineLevel.INFERIOR,
        cards: [],
        preyCards: [QUI_VIVE_ID, cardId],
    })
    const ally = findCard(game.bled, cardId)
    game.gameState.moveCardToRegion(ally, game.bled.ready)
    must(botMutations.recruitAlly.act(game.bled, { card: ally, version: {} }), 'recruit')
    if (!ally.isMinion()) {
        throw new ScenarioFailure('Not a minion')
    }
    ally.lock()
    return { ...game, ally }
}

export const ALLY_SCENARIOS: Scenario[] = [
    {
        name: 'a recruit is an undirected action of each ready minion with no target, +1 stealth',
        run() {
            const turn = recruitTurn()
            const { decision, mine } = equipOptions(turn)
            expectEqual(mine.length, 1, 'options')
            expectEqual(mine[0].action.actingMinion, turn.ready, 'acting minion')
            expectEqual(mine[0].action.target, undefined, 'target')
            applyOption(decision, mine[0])
            expectEqual(turn.gameState.action?.stealth, 1, 'stealth')
        },
    },
    {
        name: 'a recruit needs the discipline: no Animalism, no Underbridge Stray',
        run() {
            expectEqual(equipOptions(recruitTurn(null)).mine.length, 0, 'options')
        },
    },
    {
        name: 'an inferior recruit pays 1 blood and the ally comes in play with 1 life and 0 strength',
        run() {
            const turn = recruitTurn()
            expectEqual(turn.card.isMinion(), true, 'the card is a minion in the hand already')
            recruit(turn)

            expectEqual(turn.card.isIn.ready, true, 'region')
            expectEqual(turn.ready.blood, 4, 'blood paid by the recruiter')
            expectEqual(turn.card.blood, 1, 'life')
            expectEqual(allyOf(turn).minionAttrs.strength, 0, 'strength')
            expectEqual(allyOf(turn).minionAttrs.bleed, 0, 'bleed')
            expectEqual(isMinionInPlay(turn), true, 'a minion in play')
            expectEqual(
                turn.gameState.turnResources.recruited.includes(turn.card.oid),
                true,
                'noted',
            )
            const next = getDecisionPoint(turn.gameState, turn.player)
            expectEqual(next?.kind == DecisionKind.Cleanup, false, 'nothing to clean up')
        },
    },
    {
        name: 'a superior recruit gives the ally 2 life and 1 strength',
        run() {
            const turn = recruitTurn(DisciplineLevel.SUPERIOR)
            recruit(turn, DisciplineLevel.SUPERIOR)
            expectEqual(turn.card.blood, 2, 'life')
            expectEqual(allyOf(turn).minionAttrs.strength, 1, 'strength')
        },
    },
    {
        name: 'a recruit that fails leaves nothing paid, the card is no minion and goes to the ash heap',
        run() {
            const turn = recruitTurn()
            const { decision, mine } = equipOptions(turn)
            applyOption(decision, mine[0])
            expectEqual(isMinionInPlay(turn), false, 'no minion while the action runs')

            must(gameMutations.ACTION_endAction.act(turn.player, {}), 'end the action')
            expectEqual(isMinionInPlay(turn), false, 'no minion once it failed')
            const cleanup = getDecisionPoint(turn.gameState, turn.player)
            if (cleanup?.kind != DecisionKind.Cleanup) {
                throw new ScenarioFailure(`Expected a cleanup, got ${cleanup?.kind}`)
            }
            applyOption(cleanup, cleanup.options[0])
            expectEqual(turn.card.isIn.ashHeap, true, 'discarded')
            expectEqual(turn.ready.blood, 5, 'blood')
        },
    },
    {
        name: 'a recruited ally cannot act the turn it is recruited, it can the next one',
        run() {
            const turn = recruitTurn()
            recruit(turn)
            expectEqual(declaredBy(turn, MinionActionType.Bleed).length, 0, 'a bleed')
            const prey = turn.player.prey
            if (!prey) {
                throw new ScenarioFailure('No prey')
            }
            mustRefuse(
                canDeclare(createBleedAction(allyOf(turn), prey)),
                'a bleed of the recruited ally',
            )

            turn.gameState.setNewTurnResources()
            turn.gameState.turnResources.unlocked = true
            expectEqual(declaredBy(turn, MinionActionType.Bleed).length, 1, 'a bleed next turn')
        },
    },
    {
        name: 'an ally cannot hunt or rescue',
        run() {
            const turn = recruitTurn()
            recruit(turn)
            turn.gameState.setNewTurnResources()
            turn.gameState.turnResources.unlocked = true
            turn.torpid.blood = 2
            const ally = allyOf(turn)
            expectEqual(declaredBy(turn, MinionActionType.Hunt).length, 0, 'a hunt')
            expectEqual(declaredBy(turn, MinionActionType.RescueFromTorpor).length, 0, 'a rescue')
            mustRefuse(canDeclare(createHuntAction(ally)), 'a hunt')
            mustRefuse(
                canDeclare(createRescueFromTorporAction(ally, turn.torpid, 1, 1)),
                'a rescue',
            )
        },
    },
    {
        name: 'an ally can block an action aimed at its Methuselah',
        run() {
            const game = createCatalogBleed({
                deck: { ...MalkavDeck, [UNDERBRIDGE_STRAY_ID]: 4 },
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                preyCards: [UNDERBRIDGE_STRAY_ID],
            })
            const { gameState, bled } = game
            const ally: LibraryCard = findCard(bled, UNDERBRIDGE_STRAY_ID)
            gameState.moveCardToRegion(ally, bled.ready)
            must(botMutations.recruitAlly.act(bled, { card: ally, version: {} }), 'recruit')

            const decision = passUntilDecides(gameState, bled)
            const blocks = optionsOfType(decision.options, 'block')
            expectEqual(
                blocks.some(option => option.minion == ally),
                true,
                'the ally may block',
            )
        },
    },
    {
        name: 'Carlton Van Wyk: recruited for 2 pool, 2 life, no strength, and the card carries his strike, dodge and intercept',
        run() {
            const turn = recruitTurn(null, CARLTON_ID)
            const pool = turn.player.pool
            recruit(turn, null)
            expectEqual(turn.player.pool, pool - 2, 'pool')
            expectEqual(turn.card.blood, 2, 'life')
            expectEqual(allyOf(turn).minionAttrs.strength, 0, 'strength')
            const profile = profileMinion(allyOf(turn))
            expectEqual(profile.isVampire, false, 'not a vampire')
            expectEqual(profile.attachedKits.length, 1, 'the card is its own kit')
            expectEqual(profile.attachedKits[0].dodge, true, 'dodge')
            expectEqual(profile.attachedKits[0].strikes[0]?.ranged, true, 'ranged strike')
            expectEqual(profile.intercept.general, 1, 'intercept')
            expectEqual(profile.attached.length, 0, 'nothing is attached to him')
        },
    },
    {
        name: 'Carlton Van Wyk: +1 intercept against the action of a vampire only',
        run() {
            const game = createCatalogBleed({
                deck: { ...MalkavDeck, [CARLTON_ID]: 4 },
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                preyCards: [CARLTON_ID],
            })
            const { gameState, bled, blocker } = game
            const ally = findCard(bled, CARLTON_ID)
            gameState.moveCardToRegion(ally, bled.ready)
            must(botMutations.recruitAlly.act(bled, { card: ally, version: {} }), 'recruit')
            if (!ally.isMinion()) {
                throw new ScenarioFailure('Not a minion')
            }
            expectEqual(getMinionIntercept(ally), 1, 'against a vampire')
            expectEqual(getMinionIntercept(blocker), 0, 'a vampire without the card')
            gameState.action = null
            expectEqual(getMinionIntercept(ally), 0, 'no action of a vampire')
        },
    },
    {
        name: 'Carlton Van Wyk: in a combat he strikes 1R or dodges, and a dodge cancels the strike of the vampire',
        run() {
            const fight = carltonFight()
            const { gameState, actingPlayer, defendingPlayer, ally } = fight
            passUntil(fight, CombatStep.Strike)
            const combat = getCombat(fight)
            const acting = getCombatant(combat, fight.acting)
            if (!acting) {
                throw new ScenarioFailure('No acting combatant')
            }
            must(
                botMutations.COMBAT_chooseStrike.act(actingPlayer, {
                    minion: fight.acting,
                    strike: createHandStrike(acting),
                }),
                'the vampire strikes',
            )
            const decision = getCombatDecision(fight, defendingPlayer)
            const mine = optionsOfType(decision.options, 'combatStrike').filter(
                option => option.strike.source == ally,
            )
            expectEqual(mine.length, 2, 'the strike and the dodge')
            const shot = mine.find(option => !option.strike.dodge)
            expectEqual(shot?.strike.damage, 1, 'damage')
            expectEqual(shot?.strike.ranged, true, 'ranged')
            const dodge = mine.find(option => option.strike.dodge)
            if (!dodge) {
                throw new ScenarioFailure('No dodge')
            }
            applyOption(decision, dodge)
            passUntil(fight, CombatStep.EndOfRound)
            expectEqual(ally.blood, 2, 'the dodge cancelled the hand strike')
            expectEqual(fight.acting.blood, 3, 'a dodge does no damage')
            expectEqual(getCombat(fight).usedOnce.includes(ally.oid), true, 'the dodge is used')
            expectEqual(gameState.combat?.step, CombatStep.EndOfRound, 'step')
        },
    },
    {
        name: 'Carlton Van Wyk: the dodge is once per combat, the strike is not',
        run() {
            const fight = carltonFight()
            const { defendingPlayer, ally } = fight
            passUntil(fight, CombatStep.Strike)
            const combat = getCombat(fight)
            const combatant = getCombatant(combat, ally)
            if (!combatant) {
                throw new ScenarioFailure('No ally combatant')
            }
            combat.usedOnce.push(ally.oid)
            combat.impulsePlayer = defendingPlayer
            const options = optionsOfType(
                getCombatDecision(fight, defendingPlayer).options,
                'combatStrike',
            ).filter(option => option.strike.source == ally)
            expectEqual(options.length, 1, 'only the strike is left')
            expectEqual(options[0].strike.dodge, false, 'no dodge')
        },
    },
    {
        name: '47th Street Royals: burned in a window of a bleed against its Methuselah, it takes 3 off the bleed',
        run() {
            const game = royalsBleed(4)
            const { gameState, bled, ally } = game
            const decision = passUntilDecides(gameState, bled)
            const burns = optionsOfType(decision.options, 'burnAlly')
            expectEqual(burns.length, 1, 'offered once')
            expectEqual(burns[0].card, ally, 'the ally')
            applyOption(decision, burns[0])
            expectEqual(gameState.action?.bleed, 1, 'bleed')
            expectEqual(ally.isIn.ashHeap, true, 'burned')
            expectEqual(
                gameState.action?.impulsePlayer,
                game.bleeder,
                'the bleeder regains the impulse',
            )
        },
    },
    {
        name: '47th Street Royals: it never takes more than the bleed, and it is not offered when nothing is bled',
        run() {
            const small = royalsBleed(2)
            const decision = passUntilDecides(small.gameState, small.bled)
            applyOption(decision, optionsOfType(decision.options, 'burnAlly')[0])
            expectEqual(small.gameState.action?.bleed, 0, 'bleed')

            const none = royalsBleed(0)
            expectEqual(
                optionsOfType(passUntilDecides(none.gameState, none.bled).options, 'burnAlly')
                    .length,
                0,
                'nothing to reduce',
            )
        },
    },
    {
        name: '47th Street Royals: the bleeder cannot burn the ally of its prey',
        run() {
            const game = royalsBleed(4)
            const decision = passUntilDecides(game.gameState, game.bleeder)
            expectEqual(optionsOfType(decision.options, 'burnAlly').length, 0, 'bleeder options')
        },
    },
    {
        name: '47th Street Royals: not offered once it is the minion that blocks ( a burned combatant breaks the combat )',
        run() {
            const { gameState, bled, ally } = royalsBleed(4)
            const first = passUntilDecides(gameState, bled)
            const block = optionsOfType(first.options, 'block').find(o => o.minion == ally)
            if (!block) {
                throw new ScenarioFailure('The ally cannot block')
            }
            applyOption(first, block)
            const next = passUntilDecides(gameState, bled)
            expectEqual(optionsOfType(next.options, 'burnAlly').length, 0, 'while it blocks')
        },
    },
    {
        name: 'Underbridge Stray: burned during an action directed at its Methuselah, it unlocks a locked minion that can then block',
        run() {
            const game = strayBleed()
            const { gameState, bled, ally, blocker } = game
            blocker.lock()
            const decision = passUntilDecides(gameState, bled)
            expectEqual(
                optionsOfType(decision.options, 'block').some(o => o.minion == blocker),
                false,
                'locked',
            )
            const burns = optionsOfType(decision.options, 'burnAlly')
            expectEqual(burns.length, 1, 'one locked minion to unlock')
            expectEqual(burns[0].minion, blocker, 'the minion')
            applyOption(decision, burns[0])
            expectEqual(ally.isIn.ashHeap, true, 'burned')
            expectEqual(blocker.isLocked, false, 'unlocked')

            const next = passUntilDecides(gameState, bled)
            expectEqual(
                optionsOfType(next.options, 'block').some(o => o.minion == blocker),
                true,
                'it may block now',
            )
        },
    },
    {
        name: 'Underbridge Stray: not offered while it is the minion that blocks',
        run() {
            const game = strayBleed()
            const { gameState, bled, ally, blocker } = game
            blocker.lock()
            const first = passUntilDecides(gameState, bled)
            applyOption(
                first,
                optionsOfType(first.options, 'block').find(o => o.minion == ally) ??
                    first.options[0],
            )
            const next = passUntilDecides(gameState, bled)
            expectEqual(optionsOfType(next.options, 'burnAlly').length, 0, 'while it blocks')
        },
    },
    {
        name: 'Underbridge Stray: burns 1 life to give a press, burned when that was its last life, kept with 2',
        run() {
            for (const [life, kept] of [
                [1, false],
                [2, true],
            ] as const) {
                const fight = createFight(3, 3, ALLY_DECK)
                const { gameState, actingPlayer } = fight
                const stray = findCard(actingPlayer, UNDERBRIDGE_STRAY_ID)
                gameState.moveCardToRegion(stray, actingPlayer.ready)
                must(
                    botMutations.recruitAlly.act(actingPlayer, { card: stray, version: {} }),
                    'recruit',
                )
                stray.blood = life

                strikeRound(fight)
                passUntil(fight, CombatStep.Press)
                const decision = getCombatDecision(fight, getCombat(fight).impulsePlayer)
                const presses = optionsOfType(decision.options, 'combatPress').filter(o => o.burn)
                if (decision.player != actingPlayer || presses.length != 1) {
                    throw new ScenarioFailure('The press of the Stray is not offered once')
                }
                applyOption(decision, presses[0])
                expectEqual(getCombat(fight).pressed, true, 'pressed')
                expectEqual(stray.isIn.ashHeap, !kept, `burned with ${life} life`)
                expectEqual(stray.blood, life - 1, 'life')
            }
        },
    },
    {
        name: 'Ally reaction: the agent burns 47th Street Royals to cut a bleed that would hurt, not one it can bear',
        run() {
            const choose = (bleed: number, pool: number) => {
                const game = royalsBleed(bleed)
                game.bled.pool = pool
                const first = passUntilDecides(game.gameState, game.bled)
                const noBlock = first.options.find(option => option.type == 'noBlock')
                if (!noBlock) {
                    throw new ScenarioFailure('No way to decline the block')
                }
                applyOption(first, noBlock)
                const window = passUntilDecides(game.gameState, game.bled)
                return chooseThroughView(
                    window,
                    new UtilityAgent({ ...MalkavDeck, [ROYALS_ID]: 4 }),
                ).type
            }
            expectEqual(choose(4, 5), 'burnAlly', 'a bleed of 4 against a pool of 5')
            expectEqual(choose(1, 30), 'noReaction', 'a bleed of 1 against a pool of 30')
        },
    },
    {
        name: 'Ally reaction: the agent burns the Stray to unlock a blocker against a bleed that would hurt, not a small one',
        run() {
            const choose = (bleed: number, pool: number) => {
                const game = strayBleed()
                // The Stray has no intercept and the stealth is 1: only the blocker, once unlocked, can stop it
                game.blocker.lock()
                game.blocker.minionAttrs.intercept = 1
                game.bled.pool = pool
                if (game.gameState.action) {
                    game.gameState.action.bleed = bleed
                    game.gameState.action.stealth = 1
                }
                const window = passUntilDecides(game.gameState, game.bled)
                return chooseThroughView(
                    window,
                    new UtilityAgent({ ...MalkavDeck, [UNDERBRIDGE_STRAY_ID]: 4 }),
                ).type
            }
            expectEqual(choose(5, 5), 'burnAlly', 'a bleed of 5 against a pool of 5')
            expectEqual(choose(1, 30) == 'burnAlly', false, 'a bleed of 1 against a pool of 30')
        },
    },
    {
        name: 'Ally combat: the agent has the Stray burn life for a press when it wins the fight, not when it loses it',
        run() {
            const chooses = (mine: { strength: number; blood: number }, theirs: number) => {
                const fight = createFight(mine.blood, 5, ALLY_DECK)
                const { gameState, acting, defending, actingPlayer } = fight
                acting.minionAttrs.strength = mine.strength
                acting.minionAttrs.capacity = 10
                defending.minionAttrs.strength = theirs
                defending.minionAttrs.capacity = 10
                const stray = findCard(actingPlayer, UNDERBRIDGE_STRAY_ID)
                gameState.moveCardToRegion(stray, actingPlayer.ready)
                must(
                    botMutations.recruitAlly.act(actingPlayer, { card: stray, version: {} }),
                    'recruit',
                )
                stray.blood = 2
                emptyHand(gameState, actingPlayer)
                emptyHand(gameState, fight.defendingPlayer)
                getCombat(fight).acting.strength = mine.strength
                getCombat(fight).defending.strength = theirs
                strikeRound(fight)
                passUntil(fight, CombatStep.Press)
                const decision = getCombatDecision(fight, getCombat(fight).impulsePlayer)
                if (decision.player != actingPlayer) {
                    throw new ScenarioFailure('The acting player does not have the press')
                }
                const option = chooseThroughView(decision, new UtilityAgent(ALLY_DECK))
                return option.type == 'combatPress' && !!option.burn
            }
            expectEqual(chooses({ strength: 4, blood: 8 }, 1), true, 'a strong minion presses')
            expectEqual(chooses({ strength: 1, blood: 5 }, 3), false, 'a weak one does not')
        },
    },
    {
        name: 'On the Qui Vive: an ally that wakes stays locked at its next unlock phase, a vampire does not',
        run() {
            const game = quiViveGame(ROYALS_ID)
            const { gameState, bled, ally, blocker } = game
            blocker.lock()
            const decision = passUntilDecides(gameState, bled)
            const wake = (minion: Minion) =>
                optionsOfType(decision.options, 'playReaction').find(
                    option => option.effect.type == 'wake' && option.minion == minion,
                )
            const forAlly = wake(ally)
            if (!forAlly || !wake(blocker)) {
                throw new ScenarioFailure('The wake is not offered to the ally and the vampire')
            }
            applyOption(decision, forAlly)
            expectEqual(gameState.skipNextUnlock.includes(ally.oid), true, 'the ally is marked')

            gameMutations.unlockAll.act(bled, { player: bled })
            expectEqual(ally.isLocked, true, 'still locked after the next unlock phase')
            expectEqual(blocker.isLocked, false, 'the vampire unlocks as normal')
            expectEqual(gameState.skipNextUnlock.length, 0, 'forgotten')

            gameMutations.unlockAll.act(bled, { player: bled })
            expectEqual(ally.isLocked, false, 'unlocked the phase after')
        },
    },
    {
        name: 'On the Qui Vive: a woken vampire is not marked',
        run() {
            const game = quiViveGame(ROYALS_ID)
            const { gameState, bled, blocker } = game
            blocker.lock()
            const decision = passUntilDecides(gameState, bled)
            const wake = optionsOfType(decision.options, 'playReaction').find(
                option => option.effect.type == 'wake' && option.minion == blocker,
            )
            if (!wake) {
                throw new ScenarioFailure('The wake is not offered')
            }
            applyOption(decision, wake)
            expectEqual(gameState.skipNextUnlock.length, 0, 'nothing marked')
        },
    },
    {
        name: 'On the Qui Vive: the agent wakes the vampire rather than the ally, which would miss the lunge of its predator',
        run() {
            const game = quiViveGame(ROYALS_ID)
            const { gameState, bleeder, bled, ally, blocker } = game
            readyVampire(gameState, bleeder, 5)
            readyVampire(gameState, bleeder, 5)
            ally.lock()
            blocker.lock()
            ally.minionAttrs.intercept = 1
            blocker.minionAttrs.intercept = 1
            bled.pool = 5
            if (gameState.action) {
                gameState.action.bleed = 5
                gameState.action.stealth = 1
            }
            const window = passUntilDecides(gameState, bled)
            const option = chooseThroughView(
                window,
                new UtilityAgent({ ...MalkavDeck, [ROYALS_ID]: 4 }),
            )
            if (option.type != 'playReaction') {
                throw new ScenarioFailure(`The agent chose ${option.type} instead of a wake`)
            }
            expectEqual(option.minion.isVampire(), true, 'the minion that wakes')
        },
    },
]
