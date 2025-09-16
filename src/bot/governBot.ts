import { GOVERN_ID, LOST_IN_CROWDS_ID } from '@/resources/cardImpl/cardIds.ts'
import { ActionCardAction, ActionModifier, HuntAction } from '@/state/minionActions.ts'
import { Bot, NEXT_PHASE, NEXT_TURN } from '@/bot/bot.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { Discipline, DisciplineLevel } from '@/model/const.ts'
import { NO_ACTION_MODIFIER, NO_BLOCK, NO_COMBAT } from '@/state/actionState.ts'
import { DeckList } from '@/gateway/deck.ts'

export const GovernDeck = <DeckList>{
    [GOVERN_ID]: 48,
    [LOST_IN_CROWDS_ID]: 12,

    '201634': 1,
    '201626': 1,
    '201617': 1,
    '201628': 1,
    '201632': 1,
    '201532': 1,
    '201640': 1,
    '201548': 1,
    '201543': 1,
    '201627': 1,
    '201569': 1,
    '201533': 1,
}

export class GovernBot extends Bot {
    static deck = GovernDeck

    getUncontrolledSortedCapaDescending() {
        return this.player.vampiresInUncontrolled.toSorted((v1, v2) => v2.capacity - v1.capacity)
    }

    unlockPhase() {
        // Do nothing
        return NEXT_PHASE
    }

    masterPhase() {
        // Do nothing
        return NEXT_PHASE
    }

    minionPhase() {
        // Mandatory actions first : Hunts
        for (const minion of this.player.minionsReadyUnlocked) {
            if (minion.blood == 0) {
                return new HuntAction(minion)
            }
        }

        // If there's vampires in torpor
        // From youngest to oldest unlocked ready vampire
        // Rescue from torpor

        // Now let's do some governing !
        const govern = this.getCardInHand(GOVERN_ID)
        if (govern && this.player.minionsReadyUnlocked.length > 0) {
            // From oldest to youngest unlocked ready vampire
            const actingVampire = this.player.vampiresReadyUnlocked.toSorted(
                (v1, v2) => v2.capacity - v1.capacity,
            )[0]
            // If it has dominate sup and there's a younger vampire in uncontrolled with more than 3 blood remaining
            if (actingVampire.disciplines[Discipline.Dominate] == DisciplineLevel.SUPERIOR) {
                const uncontrolledVampires = this.getUncontrolledSortedCapaDescending()
                for (const vampire of uncontrolledVampires) {
                    if (
                        vampire.capacity < actingVampire.capacity &&
                        vampire.capacity - vampire.blood > 3
                    ) {
                        // govern sup
                        return new ActionCardAction(actingVampire, govern, {
                            level: DisciplineLevel.SUPERIOR,
                            target: vampire,
                        })
                    }
                }
            }

            // If we're here, either the vampire lack DOM, either there's no target for Govern Sup.
            if (actingVampire.disciplines[Discipline.Dominate] >= DisciplineLevel.INFERIOR) {
                // govern inf
                return new ActionCardAction(actingVampire, govern, {
                    level: DisciplineLevel.INFERIOR,
                    target: this.player.prey,
                })
            }
        }

        // No more ready vampire : advance to influence phase
        return NEXT_PHASE
    }

    influencePhase() {
        const gameState = useGameStateStore()

        // If less than 8 pool, do nothing
        if (this.player.pool < 8) {
            return NEXT_PHASE
        }

        const transfers = gameState.turnResources.transfers
        // If we have transfer left and any vampire in uncontrolled
        if (transfers > 0 && this.player.vampiresInUncontrolled.length > 0) {
            // Find highest-capa vampire in crypt
            const oldestVampire = this.getUncontrolledSortedCapaDescending()[0]

            if (oldestVampire) {
                // influence him up to the transfers available OR its capacity
                return gameMutations.influence.createMutation(this.player, {
                    card: oldestVampire,
                    amount: Math.min(transfers, oldestVampire.capacity - oldestVampire.blood),
                })
            }
        }

        // If we end up here, we got nothing more to do, advance the phase
        return NEXT_PHASE
    }

    discardPhase() {
        const gameState = useGameStateStore()
        // Sadness, no more govern, discard the first card in our hand to try to get one
        if (gameState.turnResources.dpa > 0 && !this.getCardInHand(GOVERN_ID)) {
            return gameMutations.discard.createMutation(this.player, {
                card: this.player.hand.cards[0],
            })
        }

        // Do Nothing
        return NEXT_TURN
    }

    actionModifier() {
        const gameState = useGameStateStore()

        if (!gameState.action) {
            return NO_ACTION_MODIFIER
        }

        const actingVampire = gameState.action.actingMinion
        const lostInCrowds = this.getCardInHand(LOST_IN_CROWDS_ID)

        // TODO : remember the action modifier played this action to prevent double lost in crowd
        if (
            lostInCrowds &&
            gameState.action.blockingMinion &&
            gameState.action.intercept >= gameState.action.stealth &&
            gameState.action.stealth <= 1
        ) {
            return new ActionModifier(lostInCrowds, {
                level: actingVampire.disciplines[Discipline.Obfuscate],
            })
        }

        return NO_ACTION_MODIFIER
    }

    reaction() {
        // No reaction, no block
        return NO_BLOCK
    }

    combat() {
        return NO_COMBAT
    }
}
