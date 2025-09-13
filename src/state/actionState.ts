import { Minion } from '@/model/Card.ts'
import { Player } from '@/model/Player.ts'
import { MinionAction } from '@/state/minionActions.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { gameMutations } from '@/state/gameMutations.ts'

/**
 * Markers for Conductor
 */
export class NO_BLOCK {} // No block for this impulse
export class NO_ACTION_MODIFIER {} // No action modifier for this impulse
export class NO_COMBAT {} // No combat card for this impulse
export class NO_REACTION {} // No reaction for this impulse

export enum ActionProperty {
    stealth = 'stealth',
    intercept = 'intercept',
    bleed = 'bleed',
    hunt = 'hunt',
}

// TODO: make mutations for all the state modifier methods
// TODO: handle multiple player who declines ( prey/predator )
export class ActionState {
    blockingDecision = null as Minion | NO_BLOCK | null

    stealth = 0
    intercept = 0
    bleed = 0
    hunt = 0

    impulsePlayer: Player

    constructor(public minionAction: MinionAction) {
        this.stealth = this.actingMinion.stealth + minionAction.defaultStealth
        this.bleed = this.actingMinion.bleed
        this.hunt = this.actingMinion.hunt
        this.impulsePlayer = this.actingMinion.controller
    }

    get actingMinion() {
        return this.minionAction.actingMinion
    }

    get blockingMinion(): Minion | null {
        return this.blockingDecision instanceof Minion ? this.blockingDecision : null
    }

    get canAttemptBlock() {
        return this.blockingDecision == null
    }

    // Acting player regain impulse after another player used it
    regainImpulse() {
        this.impulsePlayer = this.actingMinion.controller
    }

    // We don't handle cards ignoring normal impulse rules, like eagle's sight
    passImpulse() {
        const gameState = useGameStateStore()
        if (this.minionAction.isDirected) {
            if (this.impulsePlayer == gameState.activePlayer) {
                // On directed action, the impulse goes to the target
                if (this.minionAction.target instanceof Player) {
                    this.impulsePlayer = this.minionAction.target
                } else if (this.minionAction.target instanceof Minion) {
                    this.impulsePlayer = this.minionAction.target.controller
                }
            }
            // The target passed, we can resolve the action/block
            else {
                this.resolve()
            }
        }
        // On undirected actions, the impulse goes to the prey, then the predator
        else {
            const prey = this.actingMinion.controller.prey
            const predator = this.actingMinion.controller.predator
            if (prey && this.impulsePlayer == this.actingMinion.controller) {
                this.impulsePlayer = prey
            } else if (predator && this.impulsePlayer == prey && prey != predator) {
                this.impulsePlayer = predator
            }
            // The prey and predator both passed, we can resolve the action/block
            else {
                this.resolve()
            }
        }
    }

    resolve() {
        const gameState = useGameStateStore()

        // Block attempt
        if (this.blockingMinion) {
            gameMutations.ACTION_resolveBlock.act(gameState.activePlayer, {})
        }
        // Successful action
        else {
            gameMutations.ACTION_resolveAction.act(gameState.activePlayer, {})
        }
    }
}
