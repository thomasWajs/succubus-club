import { LibraryCard } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { MinionActionType } from '@/shared/types/state.ts'
import { DisciplineLevel, Discipline } from '@/shared/const/model.ts'
import { CARD_HEIGHT } from '@/shared/const/game.ts'
import { getHost } from '@/shared/state/attachments.ts'
import { GovernDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { applyOption } from '@/shared/bot/referee.ts'
import { Turn, createMinionPhase, getActionOptions, resolveAction } from './torpor.ts'
import { getDefaultStealth } from '@/shared/state/minionActions.ts'
import { describeEffect } from '@/shared/bot/utility/summaries.ts'
import { cardTurn, cardValues } from './cardActions.ts'
import {
    Scenario,
    ScenarioFailure,
    attachInPlay,
    expectEqual,
    findCard,
    giveCard,
    summaryOf,
} from './helpers.ts'
import {
    ABYSSAL_HUNTER_ID,
    CAMARILLA_VITAE_SLAVE_ID,
    CARLTON_ID,
    FAR_MASTERY_ID,
    MURDER_OF_CROWS_ID,
} from '../cardIds.ts'

/**
 * Far Mastery: the card proposes its own targets (a retainer at inferior, an ally at
 * superior), both controlled by another Methuselah.
 */

const HeistDeck = <DeckList>{
    ...GovernDeck,
    [FAR_MASTERY_ID]: 3,
    [CAMARILLA_VITAE_SLAVE_ID]: 3,
    [ABYSSAL_HUNTER_ID]: 3,
}

type Heist = {
    turn: Turn
    victim: Player
    card: LibraryCard
    retainer: LibraryCard
    ally: LibraryCard
}

// The acting player holds Far Mastery, the other one has a retainer and an ally in play
function createHeist(level: DisciplineLevel): Heist {
    const turn = createMinionPhase(5, 0, HeistDeck)
    const victim = turn.gameState.competingPlayers.find(player => player != turn.player)
    if (!victim) {
        throw new ScenarioFailure('No other player')
    }
    turn.ready.minionAttrs.disciplines[Discipline.Dominate] = level
    const card = findCard(turn.player, FAR_MASTERY_ID)
    giveCard(turn.gameState, turn.player, FAR_MASTERY_ID)
    const retainer = findCard(victim, CAMARILLA_VITAE_SLAVE_ID)
    const ally = findCard(victim, ABYSSAL_HUNTER_ID)
    turn.gameState.moveCardToRegion(retainer, victim.ready)
    turn.gameState.moveCardToRegion(ally, victim.ready)
    return { turn, victim, card, retainer, ally }
}

// The declarations of Far Mastery among everything the acting player can declare
function getHeistOptions(heist: Heist) {
    const { decision, options } = getActionOptions(heist.turn, MinionActionType.ActionCardFromHand)
    const farMastery = options.flatMap(option =>
        (
            option.action.type == MinionActionType.ActionCardFromHand &&
            option.action.card == heist.card
        ) ?
            [{ option, usage: option.action.usage }]
        :   [],
    )
    return { decision, farMastery }
}

// What the Far Mastery options steal, with the level of each
function getHeistTargets(heist: Heist) {
    return getHeistOptions(heist).farMastery.map(({ usage }) => ({
        target: usage.target,
        level: usage.disciplines?.[0]?.level,
    }))
}

export const FAR_MASTERY_SCENARIOS: Scenario[] = [
    {
        name: 'inferior Far Mastery targets only the retainer of another Methuselah',
        run() {
            const heist = createHeist(DisciplineLevel.INFERIOR)
            const targets = getHeistTargets(heist)
            expectEqual(targets.length, 1, 'options')
            expectEqual(targets[0].target, heist.retainer, 'target')
            expectEqual(targets[0].level, DisciplineLevel.INFERIOR, 'level')
        },
    },
    {
        name: 'superior Far Mastery also targets the ally, not with the inferior level',
        run() {
            const heist = createHeist(DisciplineLevel.SUPERIOR)
            const targets = getHeistTargets(heist)
            expectEqual(targets.length, 2, 'options')
            for (const { target, level } of targets) {
                expectEqual(
                    target,
                    level == DisciplineLevel.SUPERIOR ? heist.ally : heist.retainer,
                    `target at level ${level}`,
                )
            }
        },
    },
    {
        name: 'Far Mastery cannot steal what the acting player already controls',
        run() {
            const heist = createHeist(DisciplineLevel.SUPERIOR)
            heist.turn.gameState.moveCardToRegion(heist.retainer, heist.turn.player.ready)
            heist.turn.gameState.moveCardToRegion(heist.ally, heist.turn.player.ready)
            expectEqual(getHeistTargets(heist).length, 0, 'options')
        },
    },
    {
        name: 'a resolved Far Mastery takes control of the target and pays its blood',
        run() {
            const heist = createHeist(DisciplineLevel.INFERIOR)
            const { turn, retainer } = heist
            const { decision, farMastery } = getHeistOptions(heist)
            expectEqual(farMastery.length, 1, 'options')
            expectEqual(retainer.controller, heist.victim, 'controller before')
            applyOption(decision, farMastery[0].option)
            resolveAction(turn)
            expectEqual(retainer.controller, turn.player, 'controller after')
            expectEqual(retainer.region, turn.player.ready, 'retainer region')
            expectEqual(turn.ready.blood, 4, 'blood after the 1 blood cost')
            // The retainer is attached to the acting minion, close to it
            expectEqual(getHost(retainer), turn.ready, 'the retainer is attached')
            const distance = Math.hypot(retainer.x - turn.ready.x, retainer.y - turn.ready.y)
            expectEqual(distance < 2 * CARD_HEIGHT, true, `retainer distance ${distance}`)
        },
    },
    {
        name: 'a stolen ally comes to the play area of the acting player as a minion of its own',
        run() {
            const heist = createHeist(DisciplineLevel.SUPERIOR)
            const { turn, ally } = heist
            const { decision, farMastery } = getHeistOptions(heist)
            const steal = farMastery.find(({ usage }) => usage.target == ally)
            if (!steal) {
                throw new ScenarioFailure('The ally is not offered')
            }
            applyOption(decision, steal.option)
            resolveAction(turn)
            expectEqual(ally.controller, turn.player, 'controller after')
            expectEqual(ally.region, turn.player.ready, 'ally region')
            expectEqual(
                heist.victim.ready.cards.includes(ally),
                false,
                'still in the victim region',
            )
        },
    },
]

// The Methuselah right after the bot at a table of three holds the card in play: the scenario setup seals every
// library, so the card is taken from the removed pile. A retainer is attached to the one minion its owner has
function createValuedHeist(retainerLife: number) {
    const turn = cardTurn({
        minions: [{ disciplines: { [Discipline.Dominate]: DisciplineLevel.SUPERIOR }, blood: 5 }],
        hand: [FAR_MASTERY_ID],
        blockers: [{ blood: 5 }],
        extra: [FAR_MASTERY_ID, MURDER_OF_CROWS_ID, CARLTON_ID],
    })
    const take = (id: string) => {
        const card = turn.prey.removed.cards.find(
            candidate => candidate.krcgId == id && candidate instanceof LibraryCard,
        )
        if (!(card instanceof LibraryCard)) {
            throw new ScenarioFailure(`${id} is not in the removed pile`)
        }
        return card
    }
    const retainer = take(MURDER_OF_CROWS_ID)
    attachInPlay(retainer, turn.prey.vampiresReady[0], { life: retainerLife })
    const ally = take(CARLTON_ID)
    turn.ring.gameState.moveCardToRegion(ally, turn.prey.ready)
    ally.blood = 3
    return { turn, retainer, ally }
}

export const FAR_MASTERY_VALUE_SCENARIOS: Scenario[] = [
    {
        name: 'Far Mastery: the card is described by the catalog, two plays with +1 stealth that steal a retainer and an ally',
        run() {
            const summary = summaryOf(FAR_MASTERY_ID)
            expectEqual(
                summary.plays.map(play => play.target).join(),
                'retainerOfOtherMethuselah,allyOfOtherMethuselah',
                'targets',
            )
            for (const play of summary.plays) {
                expectEqual(
                    play.effects.map(describeEffect).join('; '),
                    'stealth +1; take control of the target',
                    'effects',
                )
                expectEqual(play.roles.join(), 'steal', 'role')
            }
        },
    },
    {
        name: 'Far Mastery: the action has stealth 1, the +1 stealth of the card',
        run() {
            const heist = createHeist(DisciplineLevel.INFERIOR)
            const { farMastery } = getHeistOptions(heist)
            expectEqual(getDefaultStealth(farMastery[0].option.action), 1, 'stealth')
        },
    },
    {
        name: 'Far Mastery: a retainer or an ally in play of another Methuselah is a play worth making',
        run() {
            const { turn } = createValuedHeist(2)
            const plays = cardValues(turn).filter(play => play.name == 'Far Mastery')
            expectEqual(plays.length, 2, 'a retainer at inferior, an ally at superior')
            for (const play of plays) {
                expectEqual(play.unblocked > 0, true, `${play.level} is worth ${play.unblocked}`)
            }
        },
    },
    {
        name: 'Far Mastery: a retainer is worth the counters it has left',
        run() {
            const worth = (life: number) => {
                const { turn, retainer } = createValuedHeist(life)
                const target = retainer.oid
                const play = cardValues(turn).find(candidate => candidate.target == target)
                if (!play) {
                    throw new ScenarioFailure('The steal of the retainer is not offered')
                }
                return play.unblocked
            }
            expectEqual(worth(3) > worth(1), true, 'two counters more')
        },
    },
]
