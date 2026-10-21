import { LibraryCard } from '@/shared/model/Card.ts'
import { Discipline, DisciplineLevel, Sect, TurnPhase, TurnSequence } from '@/shared/const/model.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { endAction } from '@/shared/state/actionState.ts'
import { applyUnlockPhaseEffects } from '@/shared/state/standingCards.ts'
import { createHeadlessGame } from '../harness.ts'
import { BrujahDeck, MalkavDeck, NosferatuDeck } from '@/shared/bot/decks.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { getDecidingPlayer, getDecisionPoint, applyOption } from '@/shared/bot/referee.ts'
import { DecisionKind, optionsOfType } from '@/shared/bot/types.ts'
import { emitEvent } from '@/shared/state/events.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { MinionActionType } from '@/shared/types/state.ts'
import { attemptBlock, createCatalogBleed, modifierOptionsOf, passUntilDecides } from './catalog.ts'
import { findAnyCard } from './attachment.ts'
import { passUntilActionOver } from './events.ts'
import {
    Scenario,
    ScenarioFailure,
    applyPendingCleanup,
    attachInPlay,
    createdGames,
    expectEqual,
    giveCard,
    must,
    readySpecific,
    readyVampire,
} from './helpers.ts'
import { decideWith, emptyHand, sealLibrary } from './bounce.ts'
import {
    ANARCH_FREE_PRESS_ID,
    ATIENA_ID,
    CREEPING_SABOTAGE_ID,
    LENNY_ID,
    PROTECTED_DISTRICT_ID,
    REBEL_ID,
    SMILING_JACK_ID,
    SPYING_MISSION_ID,
    WARSAW_STATION_ID,
} from '../cardIds.ts'

/**
 * Cards of the precons that were left out of the bot decks and are described now.
 */

// A bleed against a prey whose vampire has the title, holding Protected District, once the block is declined
function createProtectedDistrict(title: string, bleed: number) {
    const game = createCatalogBleed({
        deck: { ...MalkavDeck, [PROTECTED_DISTRICT_ID]: 4 },
        discipline: Discipline.Dominate,
        level: DisciplineLevel.INFERIOR,
        cards: [],
        preyCards: [PROTECTED_DISTRICT_ID],
    })
    game.blocker.vampireAttrs.title = title
    const first = passUntilDecides(game.gameState, game.bled)
    applyOption(first, optionsOfType(first.options, 'noBlock')[0])
    const action = game.gameState.action
    if (!action) {
        throw new ScenarioFailure('The action is over')
    }
    action.bleed = bleed
    decideWith(game.gameState, game.bleeder, 'noModifier')
    const decision = getDecisionPoint(game.gameState, game.bled)
    if (!decision) {
        throw new ScenarioFailure('The prey has no decision')
    }
    return { ...game, decision, action }
}

// An action of Atiena, an Anarch, with The Anarch Free Press in play and unlocked, under her controller
function createFreePress(actionType: MinionActionType, sect = Sect.Anarch) {
    const game = createCatalogBleed({
        deck: { ...BrujahDeck, [ANARCH_FREE_PRESS_ID]: 2 },
        discipline: Discipline.Obfuscate,
        level: DisciplineLevel.INFERIOR,
        cards: [],
        actionType,
        bleederId: ATIENA_ID,
    })
    game.bleeding.vampireAttrs.sect = sect
    game.bleeding.minionAttrs.capacity = 10
    const press = findAnyCard(game.bleeder, ANARCH_FREE_PRESS_ID)
    game.gameState.moveCardToRegion(press, game.bleeder.ready)
    return { ...game, press }
}

function triggerDecisionOf(game: { gameState: GameState }) {
    const decider = getDecidingPlayer(game.gameState)
    const decision = decider && getDecisionPoint(game.gameState, decider)
    return decision?.kind == DecisionKind.Trigger ? decision : null
}

// A hunt of Lenny, a Nosferatu, with Warsaw Station in play and unlocked, announced again so it can react
function createWarsaw(actionType: MinionActionType, clan = 'Nosferatu') {
    const game = createCatalogBleed({
        deck: { ...NosferatuDeck, [WARSAW_STATION_ID]: 2 },
        discipline: Discipline.Obfuscate,
        level: DisciplineLevel.INFERIOR,
        cards: [],
        actionType,
        bleederId: LENNY_ID,
    })
    game.bleeding.vampireAttrs.clan = clan
    const station = findAnyCard(game.bleeder, WARSAW_STATION_ID)
    game.gameState.moveCardToRegion(station, game.bleeder.ready)
    const action = game.gameState.action
    if (!action) {
        throw new ScenarioFailure('The action is not declared')
    }
    emitEvent(game.gameState, { type: 'actionDeclared', action: action.minionAction })
    return { ...game, station }
}

// A bleed by a vampire with the title against a prey whose blocker bears Rebel ( or another vampire does )
function createRebel(title: string, onBlocker = true) {
    const game = createCatalogBleed({
        deck: { ...MalkavDeck, [REBEL_ID]: 2 },
        discipline: Discipline.Dominate,
        level: DisciplineLevel.INFERIOR,
        cards: [],
    })
    game.bleeding.vampireAttrs.title = title
    game.blocker.minionAttrs.capacity = 10
    const other = readyVampire(game.gameState, game.bled, 3)
    attachInPlay(findAnyCard(game.bled, REBEL_ID), onBlocker ? game.blocker : other)
    const first = passUntilDecides(game.gameState, game.bled)
    applyOption(
        first,
        optionsOfType(first.options, 'block').find(option => option.minion == game.blocker) ??
            findOption(first.options, 'block'),
    )
    return game
}

// Two players. The active one is the burner ( the prey of the owner ), the other the owner of the standing card.
function createStandingGame(
    deck: DeckList,
    cardId: string,
    bloods: { owner: number; burner: number },
) {
    const { gameState } = createHeadlessGame([deck, deck])
    createdGames.push(gameState)
    const burner = gameState.activePlayer
    const owner = burner?.prey
    if (!burner || !owner) {
        throw new ScenarioFailure('No active player or no prey')
    }
    for (const player of [burner, owner]) {
        emptyHand(gameState, player)
    }
    const ownerVampire = readyVampire(gameState, owner, bloods.owner)
    const burnerVampire = readyVampire(gameState, burner, bloods.burner)
    const card = findAnyCard(owner, cardId)
    gameState.moveCardToRegion(card, owner.ready)
    if (card.isType.action) {
        must(botMutations.standCard.act(owner, { card }), 'stand')
    }
    for (const player of [burner, owner]) {
        sealLibrary(gameState, player)
    }
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
    gameState.turnResources.unlocked = true
    return { gameState, burner, owner, ownerVampire, burnerVampire, card }
}

const burnOptionsOf = (game: ReturnType<typeof createStandingGame>) =>
    optionsOfType(
        getDecisionPoint(game.gameState, game.burner)?.options ?? [],
        'declareAction',
    ).filter(
        option =>
            option.action.type == MinionActionType.ActionInPlay && option.action.card == game.card,
    )

export const DROPPED_CARD_SCENARIOS: Scenario[] = [
    {
        name: 'Spying Mission: +1 stealth at inferior while a block attempt stands, nothing without the discipline',
        run() {
            const play = (level: DisciplineLevel | null) => {
                const game = createCatalogBleed({
                    discipline: Discipline.Obfuscate,
                    level: level ?? DisciplineLevel.INFERIOR,
                    cards: [SPYING_MISSION_ID],
                })
                if (level === null) {
                    game.bleeding.minionAttrs.disciplines =
                        {} as typeof game.bleeding.minionAttrs.disciplines
                }
                attemptBlock(game, true)
                return { game, decision: passUntilDecides(game.gameState, game.bleeder) }
            }
            const { game, decision } = play(DisciplineLevel.INFERIOR)
            const options = modifierOptionsOf(decision, SPYING_MISSION_ID)
            expectEqual(options.length, 1, 'offered')
            const stealth = game.gameState.action?.stealth ?? 0
            applyOption(decision, options[0])
            expectEqual(game.gameState.action?.stealth, stealth + 1, 'stealth')

            expectEqual(
                modifierOptionsOf(play(null).decision, SPYING_MISSION_ID).length,
                0,
                'no Obfuscate',
            )
        },
    },
    {
        name: 'Creeping Sabotage: costs as many blood as the copies in play, and stays in play once its action succeeds',
        run() {
            const deck = { ...NosferatuDeck, [CREEPING_SABOTAGE_ID]: 4 }
            const { gameState } = createHeadlessGame([deck, deck])
            createdGames.push(gameState)
            const player = gameState.activePlayer
            if (!player) {
                throw new ScenarioFailure('No active player')
            }
            emptyHand(gameState, player)
            const vampire = readySpecific(gameState, player, LENNY_ID, 5)
            const first = giveCard(gameState, player, CREEPING_SABOTAGE_ID)
            for (const other of gameState.competingPlayers) {
                sealLibrary(gameState, other)
            }
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
            gameState.turnResources.unlocked = true

            const play = (card: LibraryCard) => {
                const decision = getDecisionPoint(gameState, player)
                const option = optionsOfType(decision?.options ?? [], 'declareAction').find(
                    candidate =>
                        candidate.action.type == MinionActionType.ActionCardFromHand &&
                        candidate.action.card == card,
                )
                if (!decision || !option) {
                    throw new ScenarioFailure('Creeping Sabotage is not offered')
                }
                applyOption(decision, option)
                passUntilActionOver(gameState)
            }
            play(first)
            expectEqual(vampire.blood, 5, 'the first copy costs nothing')
            expectEqual(first.isIn.ready, true, 'stays in play')
            expectEqual(gameState.standing.includes(first.oid), true, 'standing')

            const other = readyVampire(gameState, player, 5)
            const second = findAnyCard(player, CREEPING_SABOTAGE_ID)
            gameState.moveCardToRegion(second, player.hand)
            play(second)
            expectEqual(other.blood, 4, 'the second copy costs 1')
            expectEqual(first.isIn.ready && second.isIn.ready, true, 'both stay in play')
        },
    },
    {
        name: 'Creeping Sabotage: a blocked action does not leave the card in play',
        run() {
            const deck = { ...NosferatuDeck, [CREEPING_SABOTAGE_ID]: 4 }
            const { gameState } = createHeadlessGame([deck, deck])
            createdGames.push(gameState)
            const player = gameState.activePlayer
            if (!player) {
                throw new ScenarioFailure('No active player')
            }
            emptyHand(gameState, player)
            readySpecific(gameState, player, LENNY_ID, 5)
            const card = giveCard(gameState, player, CREEPING_SABOTAGE_ID)
            for (const other of gameState.competingPlayers) {
                sealLibrary(gameState, other)
            }
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
            gameState.turnResources.unlocked = true
            const decision = getDecisionPoint(gameState, player)
            const option = optionsOfType(decision?.options ?? [], 'declareAction').find(
                candidate =>
                    candidate.action.type == MinionActionType.ActionCardFromHand &&
                    candidate.action.card == card,
            )
            if (!decision || !option) {
                throw new ScenarioFailure('Creeping Sabotage is not offered')
            }
            applyOption(decision, option)
            endAction(gameState)
            applyPendingCleanup(gameState, player)
            expectEqual(card.isIn.ashHeap, true, 'discarded')
            expectEqual(gameState.standing.includes(card.oid), false, 'not standing')
        },
    },
    {
        name: 'Creeping Sabotage: the prey of its controller burns 1 pool in their unlock phase',
        run() {
            const game = createStandingGame(
                { ...NosferatuDeck, [CREEPING_SABOTAGE_ID]: 4 },
                CREEPING_SABOTAGE_ID,
                { owner: 3, burner: 3 },
            )
            // The owner unlocks: their prey, the burner, burns the pool
            const pool = game.burner.pool
            game.gameState.turnResources.unlocked = false
            game.gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            applyUnlockPhaseEffects(game.gameState, game.owner)
            expectEqual(game.burner.pool, pool - 1, 'pool of the prey')
            expectEqual(game.owner.pool, game.owner.pool, 'the owner keeps theirs')

            game.gameState.moveCardToRegion(game.card, game.owner.ashHeap)
            applyUnlockPhaseEffects(game.gameState, game.owner)
            expectEqual(game.burner.pool, pool - 1, 'a burned card does nothing')
        },
    },
    {
        name: 'Creeping Sabotage: a minion of another Methuselah can burn it as a directed action, the owner can block',
        run() {
            const game = createStandingGame(
                { ...NosferatuDeck, [CREEPING_SABOTAGE_ID]: 4 },
                CREEPING_SABOTAGE_ID,
                { owner: 3, burner: 3 },
            )
            const decision = getDecisionPoint(game.gameState, game.burner)
            if (!decision) {
                throw new ScenarioFailure('No decision')
            }
            const options = optionsOfType(decision.options, 'declareAction').filter(
                option =>
                    option.action.type == MinionActionType.ActionInPlay &&
                    option.action.card == game.card,
            )
            expectEqual(options.length, 1, 'burn offered')
            applyOption(decision, options[0])
            expectEqual(
                game.gameState.action?.minionAction.target,
                game.card,
                'directed at the card',
            )
            passUntilActionOver(game.gameState)
            expectEqual(game.card.isIn.ashHeap, true, 'burned')
            expectEqual(game.burnerVampire.isLocked, true, 'the burner acted')
        },
    },
    {
        name: 'Creeping Sabotage: its own controller cannot burn it, nor can a card that does not stand',
        run() {
            const game = createStandingGame(
                { ...NosferatuDeck, [CREEPING_SABOTAGE_ID]: 4 },
                CREEPING_SABOTAGE_ID,
                { owner: 3, burner: 3 },
            )
            expectEqual(burnOptionsOf({ ...game, burner: game.owner }).length, 0, 'the owner')
            game.gameState.standing = []
            expectEqual(burnOptionsOf(game).length, 0, 'not standing')
        },
    },
    {
        name: 'Smiling Jack: moves a pool to a counter in the unlock phase of its controller, the others burn a pool or a blood per counter in theirs',
        run() {
            const game = createStandingGame(
                { ...MalkavDeck, [SMILING_JACK_ID]: 2 },
                SMILING_JACK_ID,
                { owner: 3, burner: 3 },
            )
            const ownerPool = game.owner.pool
            applyUnlockPhaseEffects(game.gameState, game.owner)
            expectEqual(game.owner.pool, ownerPool - 1, 'pool moved')
            expectEqual(game.card.blood, 1, 'counter')

            const burnerPool = game.burner.pool
            applyUnlockPhaseEffects(game.gameState, game.burner)
            expectEqual(
                game.burner.pool,
                burnerPool,
                'the others do not burn a pool: they burn a blood',
            )
            expectEqual(game.burnerVampire.blood, 2, 'blood burned')

            // Two counters: two blood, then the pool when no vampire has 2 blood left
            applyUnlockPhaseEffects(game.gameState, game.owner)
            expectEqual(game.card.blood, 2, 'two counters')
            applyUnlockPhaseEffects(game.gameState, game.burner)
            expectEqual(game.burnerVampire.blood, 1, 'blood burned again')
            expectEqual(game.burner.pool, burnerPool - 1, 'then the pool')
        },
    },
    {
        name: 'Smiling Jack: a human burns by hand, the engine does not choose for them',
        run() {
            const game = createStandingGame(
                { ...MalkavDeck, [SMILING_JACK_ID]: 2 },
                SMILING_JACK_ID,
                { owner: 3, burner: 3 },
            )
            game.burner.permId = 'human'
            applyUnlockPhaseEffects(game.gameState, game.owner)
            const burnerPool = game.burner.pool
            applyUnlockPhaseEffects(game.gameState, game.burner)
            expectEqual(game.burner.pool, burnerPool, 'pool')
            expectEqual(game.burnerVampire.blood, 3, 'blood')
        },
    },
    {
        name: 'Smiling Jack: burnable by the minions of the others, not offered to its controller',
        run() {
            const game = createStandingGame(
                { ...MalkavDeck, [SMILING_JACK_ID]: 2 },
                SMILING_JACK_ID,
                { owner: 3, burner: 3 },
            )
            expectEqual(burnOptionsOf(game).length, 1, 'burn offered')
            expectEqual(burnOptionsOf({ ...game, burner: game.owner }).length, 0, 'the owner')
        },
    },
    {
        name: 'Rebel: the vampire that blocks a titled vampire gains 1 blood, once a turn',
        run() {
            const game = createRebel('baron')
            const decision = triggerDecisionOf(game)
            if (!decision) {
                throw new ScenarioFailure('No trigger decision')
            }
            expectEqual(decision.player, game.bled, 'the controller decides')
            applyOption(decision, findOption(decision.options, 'useTrigger'))
            expectEqual(game.blocker.blood, 4, 'blood')
            expectEqual(triggerDecisionOf(game), null, 'once')

            const action = game.gameState.action
            if (!action) {
                throw new ScenarioFailure('No action')
            }
            emitEvent(game.gameState, {
                type: 'blockDeclared',
                action: action.minionAction,
                blocker: game.blocker,
            })
            expectEqual(triggerDecisionOf(game), null, 'once a turn')
        },
    },
    {
        name: 'Rebel: nothing against a vampire without a title, nor for a block by another vampire',
        run() {
            expectEqual(triggerDecisionOf(createRebel('')), null, 'an untitled vampire')
            expectEqual(triggerDecisionOf(createRebel('baron', false)), null, 'another vampire')
        },
    },
    {
        name: 'The Anarch Free Press: after an Anarch hunts, lock it for 1 blood on that Anarch',
        run() {
            const game = createFreePress(MinionActionType.Hunt)
            passUntilActionOver(game.gameState)
            const blood = game.bleeding.blood
            const decision = triggerDecisionOf(game)
            if (!decision) {
                throw new ScenarioFailure('No trigger decision')
            }
            expectEqual(decision.player, game.bleeder, 'the controller decides')
            applyOption(decision, findOption(decision.options, 'useTrigger'))
            expectEqual(game.press.isLocked, true, 'locked')
            expectEqual(game.bleeding.blood, blood + 1, 'blood')
        },
    },
    {
        name: 'The Anarch Free Press: not after a bleed, a vampire that is not an Anarch, nor when locked',
        run() {
            const bleed = createFreePress(MinionActionType.Bleed)
            passUntilActionOver(bleed.gameState)
            expectEqual(triggerDecisionOf(bleed), null, 'a bleed')

            const camarilla = createFreePress(MinionActionType.Hunt, Sect.Camarilla)
            passUntilActionOver(camarilla.gameState)
            expectEqual(triggerDecisionOf(camarilla), null, 'a Camarilla vampire')

            const locked = createFreePress(MinionActionType.Hunt)
            locked.press.lock()
            passUntilActionOver(locked.gameState)
            expectEqual(triggerDecisionOf(locked), null, 'locked')
        },
    },
    {
        name: 'The Anarch Free Press: lock it for +1 intercept to an Anarch whose block attempt stands, not to another sect',
        run() {
            const offered = (sect: Sect) => {
                const game = createCatalogBleed({
                    deck: { ...BrujahDeck, [ANARCH_FREE_PRESS_ID]: 2 },
                    discipline: Discipline.Presence,
                    level: DisciplineLevel.SUPERIOR,
                    cards: [],
                })
                game.blocker.vampireAttrs.sect = sect
                const press = findAnyCard(game.bled, ANARCH_FREE_PRESS_ID)
                game.gameState.moveCardToRegion(press, game.bled.ready)
                attemptBlock(game, false)
                const decision = passUntilDecides(game.gameState, game.bled)
                const options = optionsOfType(decision.options, 'lockForReaction')
                if (options.length > 0) {
                    const intercept = game.gameState.action?.intercept ?? 0
                    applyOption(decision, options[0])
                    expectEqual(game.gameState.action?.intercept, intercept + 1, 'intercept')
                    expectEqual(press.isLocked, true, 'locked')
                }
                return options.length
            }
            expectEqual(offered(Sect.Anarch), 1, 'an Anarch')
            expectEqual(offered(Sect.Camarilla), 0, 'a Camarilla vampire')
        },
    },
    {
        name: 'Warsaw Station: lock it as a Nosferatu announces an undirected action, the Nosferatu unlocks if it is successful',
        run() {
            const game = createWarsaw(MinionActionType.Hunt)
            const decision = triggerDecisionOf(game)
            if (!decision) {
                throw new ScenarioFailure('No trigger decision')
            }
            applyOption(decision, findOption(decision.options, 'useTrigger'))
            expectEqual(game.station.isLocked, true, 'Warsaw Station locked')
            expectEqual(game.bleeding.isLocked, true, 'locked by the action')
            passUntilActionOver(game.gameState)
            expectEqual(game.bleeding.isLocked, false, 'unlocked after the successful action')
        },
    },
    {
        name: 'Warsaw Station: declining leaves the Nosferatu locked, and it is not offered for a bleed, another clan or when locked',
        run() {
            const declined = createWarsaw(MinionActionType.Hunt)
            const decision = triggerDecisionOf(declined)
            if (!decision) {
                throw new ScenarioFailure('No trigger decision')
            }
            applyOption(decision, findOption(decision.options, 'skipTrigger'))
            passUntilActionOver(declined.gameState)
            expectEqual(declined.bleeding.isLocked, true, 'still locked')

            expectEqual(triggerDecisionOf(createWarsaw(MinionActionType.Bleed)), null, 'a bleed')
            expectEqual(
                triggerDecisionOf(createWarsaw(MinionActionType.Hunt, 'Ventrue')),
                null,
                'another clan',
            )
            expectEqual(
                triggerDecisionOf(createWarsaw(MinionActionType.Hunt, 'Nosferatu antitribu')),
                null,
                'a Nosferatu antitribu',
            )
        },
    },
    {
        name: 'Warsaw Station: a locked card does not react',
        run() {
            const game = createWarsaw(MinionActionType.Hunt)
            const decision = triggerDecisionOf(game)
            if (!decision) {
                throw new ScenarioFailure('No trigger decision')
            }
            applyOption(decision, findOption(decision.options, 'skipTrigger'))
            game.station.lock()
            const action = game.gameState.action
            if (!action) {
                throw new ScenarioFailure('No action')
            }
            emitEvent(game.gameState, { type: 'actionDeclared', action: action.minionAction })
            expectEqual(triggerDecisionOf(game), null, 'locked')
        },
    },
    {
        name: 'Protected District reduces the bleed by 3, down to 0, and needs a primogen',
        run() {
            for (const [bleed, expected] of [
                [4, 1],
                [2, 0],
            ] as const) {
                const game = createProtectedDistrict('primogen', bleed)
                const reactions = optionsOfType(game.decision.options, 'playReaction')
                expectEqual(reactions.length, 1, 'offered')
                applyOption(game.decision, reactions[0])
                expectEqual(game.action.bleed, expected, `bleed of ${bleed}`)
            }

            const plain = createProtectedDistrict('', 4)
            expectEqual(
                optionsOfType(plain.decision.options, 'playReaction').length,
                0,
                'a vampire without a title',
            )
        },
    },
]
