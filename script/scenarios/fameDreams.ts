import { LibraryCard } from '@/shared/model/Card.ts'
import { TurnPhase, TurnSequence } from '@/shared/const/model.ts'
import { CombatStep } from '@/shared/types/state.ts'
import { getHost } from '@/shared/state/attachments.ts'
import { applyUnlockPhaseEffects } from '@/shared/state/standingCards.ts'
import { chooseThroughView } from '@/shared/bot/playerView.ts'
import { applyOption, getDecisionPoint } from '@/shared/bot/referee.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { BotOptionOf, DecisionKind, optionsOfType } from '@/shared/bot/types.ts'
import { summarizeCardId } from '@/shared/bot/utility/summaries.ts'
import { AttachDeck } from '../attachDeck.ts'
import { findAnyCard } from './attachment.ts'
import { MASTER_DECK, MasterTurn, decisionOf, masterTurn, playPhase } from './masterPhase.ts'
import {
    Scenario,
    ScenarioFailure,
    attachInPlay,
    createFight,
    expectEqual,
    expectRegion,
    passUntil,
    damageResolution,
} from './helpers.ts'
import { DREAMS_OF_THE_SPHINX_ID, FAME_ID } from '../cardIds.ts'

/**
 * Fame and Dreams of the Sphinx.
 */

// A fight where the defending vampire carries a Fame played by the acting player, in the damage resolution
function createFameFight(damage: number, defendingBlood: number) {
    const fight = createFight(3, defendingBlood, { ...AttachDeck, [FAME_ID]: 2 })
    const fame = findAnyCard(fight.actingPlayer, FAME_ID)
    attachInPlay(fame, fight.defending)
    damageResolution(fight, fight.defending, damage, 0)
    return { ...fight, fame }
}

// A card the player controls that is in play, on a vampire or not
function inPlay(turn: MasterTurn, krcgId: string): LibraryCard {
    const card = turn.me.controlledReadyCards.find(candidate => candidate.krcgId == krcgId)
    if (!(card instanceof LibraryCard)) {
        throw new ScenarioFailure(`Card ${krcgId} is not in play`)
    }
    return card
}

const fameTargets = (turn: MasterTurn) =>
    optionsOfType(decisionOf(turn).options, 'playMaster')
        .filter(option => option.card.krcgId == FAME_ID)
        .map(option => option.target)

// A turn of the first player with the card in play and unlocked, in the phase
function dreamsTurn(phase: 'unlock' | 'discard', counters = 0, uncontrolled = 6) {
    const turn = masterTurn({
        phase: 'unlock',
        ready: [{ blood: 3 }],
        inPlay: [DREAMS_OF_THE_SPHINX_ID],
        uncontrolled,
    })
    const dreams = inPlay(turn, DREAMS_OF_THE_SPHINX_ID)
    dreams.blood = counters
    if (phase == 'discard') {
        // The libraries were sealed: some cards to draw
        const drawable = turn.me.removed.cards
            .filter(card => card instanceof LibraryCard)
            .slice(0, 12)
        for (const card of drawable) {
            turn.ring.gameState.moveCardToRegion(card, turn.me.library)
        }
        turn.ring.gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Discard)
    }
    return { ...turn, dreams }
}

const lockUses = (turn: MasterTurn) => optionsOfType(decisionOf(turn).options, 'lockUse')

type LockUse = BotOptionOf<'lockUse'>

// The first use ( or the one `pick` chooses ), applied through the decision it was offered in
function useDreams(
    turn: MasterTurn,
    pick: (uses: LockUse[]) => LockUse | undefined = uses => uses[0],
): LockUse {
    const decision = decisionOf(turn)
    const use = pick(optionsOfType(decision.options, 'lockUse'))
    if (!use) {
        throw new ScenarioFailure('No use offered')
    }
    applyOption(decision, use)
    return use
}

export const FAME_DREAMS_SCENARIOS: Scenario[] = [
    {
        name: 'Fame: put on a ready vampire of another Methuselah only, never on one of the player',
        run() {
            const turn = masterTurn({
                hand: [FAME_ID],
                ready: [{ blood: 3 }],
                prey: [{ blood: 2 }],
                predator: [{ blood: 5 }],
            })
            const targets = fameTargets(turn)
            expectEqual(targets.length, 2, 'targets')
            expectEqual(
                targets.some(target => target?.controller == turn.me),
                false,
                'not one of mine',
            )
        },
    },
    {
        name: 'Fame: the bot puts it on the emptier vampire of the others',
        run() {
            const turn = masterTurn({
                hand: [FAME_ID],
                ready: [{ blood: 3 }],
                prey: [{ blood: 5 }],
                predator: [{ blood: 1 }],
            })
            const done = playPhase(turn)
            const played = done[0]
            if (played?.type != 'playMaster' || played.card.krcgId != FAME_ID) {
                throw new ScenarioFailure(
                    `Expected Fame first, got ${done.map(o => o.type).join()}`,
                )
            }
            expectEqual(played.target?.blood, 1, 'the emptier vampire')
            const fame = inPlay(turn, FAME_ID)
            expectEqual(getHost(fame), played.target, 'attached')
            expectEqual(fame.controller, turn.me, 'controlled by the player')
        },
    },
    {
        name: 'Fame: when its host goes to torpor its controller burns 3 pool, and nothing while it is ready',
        run() {
            const spared = createFameFight(1, 3)
            const sparedPool = spared.defendingPlayer.pool
            passUntil(spared, CombatStep.EndOfRound)
            expectRegion(spared.defending, 'ready')
            expectEqual(spared.defendingPlayer.pool, sparedPool, 'ready host')

            const fight = createFameFight(5, 1)
            const pool = fight.defendingPlayer.pool
            const actingPool = fight.actingPlayer.pool
            passUntil(fight, CombatStep.EndOfRound)
            expectRegion(fight.defending, 'torpor')
            expectEqual(fight.defendingPlayer.pool, pool - 3, 'the controller of the host burns 3')
            expectEqual(fight.actingPlayer.pool, actingPool, 'not the player of the card')
            expectEqual(getHost(fight.fame), fight.defending, 'still on its host')
        },
    },
    {
        name: 'Fame: in each unlock phase a Methuselah burns 1 pool while the host is in torpor, not while it is ready',
        run() {
            const fight = createFameFight(0, 3)
            const players = [fight.actingPlayer, fight.defendingPlayer]
            const pools = players.map(player => player.pool)
            for (const player of players) {
                applyUnlockPhaseEffects(fight.gameState, player)
            }
            expectEqual(players.map(player => player.pool).join(), pools.join(), 'ready host')

            fight.gameState.moveCardToRegion(fight.defending, fight.defendingPlayer.torpor)
            for (const player of players) {
                applyUnlockPhaseEffects(fight.gameState, player)
            }
            expectEqual(
                players.map(player => player.pool).join(),
                pools.map(pool => pool - 1).join(),
                'host in torpor',
            )
        },
    },
    {
        name: 'Dreams of the Sphinx: in the unlock phase 1 blood on a vampire of the uncontrolled region, a counter, locked',
        run() {
            const turn = dreamsTurn('unlock')
            const uses = lockUses(turn)
            expectEqual(uses.length > 0, true, 'offered')
            expectEqual(
                uses.every(use => !!use.target),
                true,
                'the Edge is not held: only the blood',
            )
            const before = uses[0].target?.blood ?? 0
            const use = useDreams(turn)
            expectEqual(use.target?.blood, before + 1, 'blood')
            expectEqual(turn.dreams.blood, 1, 'counter')
            expectEqual(turn.dreams.isLocked, true, 'locked')
            expectEqual(lockUses(turn).length, 0, 'once locked, not again')
        },
    },
    {
        name: 'Dreams of the Sphinx: 1 pool in the unlock phase only while the player has the Edge',
        run() {
            const turn = dreamsTurn('unlock')
            const poolUse = (held: boolean) => {
                turn.ring.gameState.theEdgeControllerOid = held ? turn.me.oid : undefined
                return lockUses(turn).filter(use => !use.target)
            }
            expectEqual(poolUse(false).length, 0, 'no Edge')
            const uses = poolUse(true)
            expectEqual(uses.length, 1, 'with the Edge')
            const pool = turn.me.pool
            useDreams(turn, offered => offered.find(use => !use.target))
            expectEqual(turn.me.pool, pool + 1, 'pool')
            expectEqual(turn.dreams.blood, 1, 'counter')
        },
    },
    {
        name: 'Dreams of the Sphinx: a vampire that reaches its capacity leaves the uncontrolled region',
        run() {
            const turn = dreamsTurn('unlock')
            const target = lockUses(turn)[0]?.target
            if (!target) {
                throw new ScenarioFailure('No vampire to aim at')
            }
            target.blood = target.minionAttrs.capacity - 1
            useDreams(turn, offered => offered.find(use => use.target == target))
            expectRegion(target, 'ready')
        },
    },
    {
        name: 'Dreams of the Sphinx: the third use burns the card',
        run() {
            const turn = dreamsTurn('unlock', 2)
            useDreams(turn)
            expectEqual(turn.dreams.isIn.ashHeap, true, 'burned')
        },
    },
    {
        name: 'Dreams of the Sphinx: +2 hand size in the discard phase draws 2 cards at once, and ends with the turn',
        run() {
            const turn = dreamsTurn('discard')
            const uses = lockUses(turn)
            expectEqual(uses.length, 1, 'offered in the discard phase')
            expectEqual(turn.me.hand.length, 0, 'empty hand')
            useDreams(turn)
            expectEqual(turn.me.handSize, 9, 'hand size')
            expectEqual(turn.me.hand.length, 9, 'drawn up')
            turn.ring.gameState.setNewTurnResources()
            expectEqual(turn.me.handSize, 7, 'back to normal the next turn')
        },
    },
    {
        name: 'Dreams of the Sphinx: the hand size is not offered in the unlock phase, nor the blood and the pool in the discard phase',
        run() {
            const unlock = dreamsTurn('unlock')
            expectEqual(
                lockUses(unlock).some(
                    use => !use.target && !unlock.ring.gameState.theEdgeControllerOid,
                ),
                false,
                'unlock phase',
            )
            const discard = dreamsTurn('discard')
            discard.ring.gameState.theEdgeControllerOid = discard.me.oid
            expectEqual(lockUses(discard).length, 1, 'discard phase')
        },
    },
    {
        name: 'Dreams of the Sphinx: the utility bot plays it, uses it in the unlock phase and for the hand size in the discard phase',
        run() {
            const hand = masterTurn({
                hand: [DREAMS_OF_THE_SPHINX_ID],
                ready: [{ blood: 3 }],
            })
            const played = playPhase(hand)
            expectEqual(
                played.some(
                    option =>
                        option.type == 'playMaster' &&
                        option.card.krcgId == DREAMS_OF_THE_SPHINX_ID,
                ),
                true,
                'played',
            )

            const unlock = dreamsTurn('unlock')
            const agent = new UtilityAgent(MASTER_DECK)
            expectEqual(chooseThroughView(decisionOf(unlock), agent).type, 'lockUse', 'unlock')

            const discard = dreamsTurn('discard')
            const decision = getDecisionPoint(discard.ring.gameState, discard.me)
            if (decision?.kind != DecisionKind.Discard) {
                throw new ScenarioFailure(`Expected a discard, got ${decision?.kind}`)
            }
            expectEqual(chooseThroughView(decision, agent).type, 'lockUse', 'discard')
        },
    },
    {
        name: 'Fame and Dreams of the Sphinx have roles',
        run() {
            expectEqual(summarizeCardId(FAME_ID)?.roles.join(), 'drain,attachment,master', 'Fame')
            expectEqual(
                summarizeCardId(DREAMS_OF_THE_SPHINX_ID)?.roles.join(),
                'accelerate,poolGain,master,handSize',
                'Dreams',
            )
        },
    },
]
