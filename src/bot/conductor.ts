import { Bot, BotDecision, NEXT_PHASE, NEXT_TURN } from '@/bot/bot.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { TurnPhase, TurnSequence } from '@/model/const.ts'
import {
    AnyGameMutation,
    applyMutationLocally,
    GameMutation,
    gameMutations,
} from '@/state/gameMutations.ts'
import { ActionCardAction, ActionModifier, MinionAction } from '@/state/minionActions.ts'
import { NO_ACTION_MODIFIER, NO_BLOCK, NO_COMBAT, NO_REACTION } from '@/state/actionState.ts'
import { LibraryCard, Minion } from '@/model/Card.ts'
import { GRID_SIZE } from '@/game/const.ts'
import * as logging from '@/logging.ts'

// 500ms between bot decisions to let the human player look at what happens
export const BOT_PAUSE_TIME = 150

export class Conductor {
    turnInitDone = false
    isApplyingADecision = false

    constructor(public bot: Bot) {}

    playCard(card: LibraryCard, actingMinion?: Minion) {
        gameMutations.moveCardToRegion.act(this.bot.player, {
            card,
            fromCardRegion: card.region,
            toCardRegion: this.bot.player.controlled,
            x: actingMinion ? actingMinion.x : 0,
            y: actingMinion ? actingMinion.y - 6 * GRID_SIZE : 0,
        })

        // Draw to replace the action card
        // This won't handle the "do not replace until..." card text
        gameMutations.drawLibrary.act(this.bot.player, {
            player: this.bot.player,
        })
    }

    startTurn() {
        this.turnInitDone = true
        this.bot.startTurn()

        gameMutations.unlockAll.act(this.bot.player, {
            player: this.bot.player,
        })
    }

    endTurn() {
        this.bot.endTurn()
        this.turnInitDone = false
    }

    _applyBotDecision(decisionCallback: () => void) {
        this.isApplyingADecision = true

        setTimeout(() => {
            try {
                decisionCallback()
            } catch (error) {
                logging.captureException(error)
            }

            this.isApplyingADecision = false

            this.runDecisionMaking()
        }, BOT_PAUSE_TIME)
    }

    applyGameMutation(mutation: AnyGameMutation) {
        this._applyBotDecision(() => {
            const validity = mutation.canApply()
            if (!validity.isValid) {
                this.invalidDecision(`Can't apply gameMutation : ${validity.reason}`, mutation)
                return validity
            }
            applyMutationLocally(mutation)
        })
    }

    applyMinionAction(action: MinionAction) {
        this._applyBotDecision(() => {
            const validity = action.canDeclare()
            if (!validity.isValid) {
                this.invalidDecision(validity.reason, action)
                return
            }

            gameMutations.ACTION_declareAction.act(this.bot.player, {
                minionAction: action,
            })

            if (action instanceof ActionCardAction) {
                this.playCard(action.actionCard, action.actingMinion)
            }
        })
    }

    applyActionModifier(actionModifier: ActionModifier) {
        this._applyBotDecision(() => {
            const gameState = useGameStateStore()
            this.playCard(actionModifier.actionModifierCard, gameState.action?.actingMinion)
            actionModifier.apply()
        })
    }

    invalidDecision(reason: string, decision: BotDecision) {
        logging.captureMessage(`INVALID BOT DECISION !!! : ${reason}\n${decision}`)
    }

    mustStopPlaying() {
        const gameState = useGameStateStore()

        // An ousted bot doesn't play anymore
        if (this.bot.player.isOusted) {
            return true
        }
        // Stop playing if we're the last one in game
        if (gameState.competingPlayers.length == 1) {
            return true
        }

        return false
    }

    decisionFallback() {
        if (this.mustStopPlaying()) {
            return
        }

        const gameState = useGameStateStore()

        // it's our turn
        if (gameState.activePlayer == this.bot.player) {
            // Go to the next phase if possible
            if (gameState.turnPhaseIndex < TurnSequence.length - 1) {
                this.nextPhaseDecision()
            }
            // Else end the turn
            else {
                this.endTurnDecision()
            }
        }
    }

    nextPhaseDecision() {
        this.applyGameMutation(
            gameMutations.goToTurnPhase.createMutation(this.bot.player, {
                index: useGameStateStore().turnPhaseIndex + 1,
            }),
        )
    }

    endTurnDecision() {
        this.endTurn()
        this.applyGameMutation(
            gameMutations.goToTurn.createMutation(this.bot.player, {
                index: useGameStateStore().turnNumber + 1,
            }),
        )
    }

    runDecisionMaking() {
        if (this.mustStopPlaying()) {
            return
        }

        // We're already doing something, don't run again in parallel
        if (this.isApplyingADecision) {
            return
        }

        try {
            this._unsafeRunDecisionMaking()
        } catch (error) {
            logging.captureException(error)
            this.decisionFallback()
        }
    }

    _unsafeRunDecisionMaking() {
        if (this.mustStopPlaying()) {
            return
        }

        const gameState = useGameStateStore()
        const botPlayer = this.bot.player
        let decision: BotDecision | undefined

        // First case : it's our turn
        if (gameState.activePlayer == botPlayer) {
            // There's an action in progress
            if (gameState.action) {
                // We have the impulse, take a decision
                if (gameState.action.impulsePlayer == botPlayer) {
                    // Check for an action modifier
                    decision = this.bot.actionModifier()
                }
            }

            // There's a combat in progress
            else if (gameState.combat) {
                // We have the impulse, take a decision
                if (gameState.combat.impulsePlayer == botPlayer) {
                    // Check for an action modifier
                    decision = this.bot.combat()
                }
            }

            // No action nor combat in progress : turn phases and minion actions
            else {
                if (!this.turnInitDone) {
                    this.startTurn()
                    return
                }

                if (gameState.turnPhase == TurnPhase.Unlock) {
                    decision = this.bot.unlockPhase()
                } else if (gameState.turnPhase == TurnPhase.Master) {
                    decision = this.bot.masterPhase()
                } else if (gameState.turnPhase == TurnPhase.Minion) {
                    decision = this.bot.minionPhase()
                } else if (gameState.turnPhase == TurnPhase.Influence) {
                    decision = this.bot.influencePhase()
                } else if (gameState.turnPhase == TurnPhase.Discard) {
                    decision = this.bot.discardPhase()
                }
            }
        }

        // Second case : we're reacting or combatting outside our turn
        else {
            // If we have the impulse, check for a reaction from the bot
            if (gameState.action?.impulsePlayer == botPlayer) {
                decision = this.bot.reaction()
            } else if (gameState.combat?.impulsePlayer == botPlayer) {
                decision = this.bot.combat()
            }
        }

        // Now, apply the decision
        if (decision instanceof GameMutation) {
            this.applyGameMutation(decision)
        } else if (decision instanceof MinionAction) {
            this.applyMinionAction(decision)
        } else if (decision instanceof ActionModifier) {
            this.applyActionModifier(decision)
        } else if (decision == NO_ACTION_MODIFIER) {
            this.applyGameMutation(
                gameMutations.ACTION_declareActionModifier.createMutation(botPlayer, {
                    actionModifier: NO_ACTION_MODIFIER,
                }),
            )
        } else if (decision == NO_REACTION) {
            this.applyGameMutation(
                gameMutations.ACTION_declareReaction.createMutation(botPlayer, {
                    reaction: NO_REACTION,
                }),
            )
        } else if (decision == NO_BLOCK) {
            this.applyGameMutation(
                gameMutations.ACTION_declareBlock.createMutation(botPlayer, {
                    blockingMinion: NO_BLOCK,
                }),
            )
        } else if (decision == NO_COMBAT) {
            // TODO
        } else if (decision == NEXT_PHASE) {
            this.nextPhaseDecision()
        } else if (decision == NEXT_TURN) {
            this.endTurnDecision()
        }
    }
}
