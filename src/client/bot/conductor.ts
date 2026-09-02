import { Bot, BotDecision } from '@/client/bot/bot.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { TurnPhase, TurnSequence } from '@/shared/const/model.ts'
import { AnyGameMutation, GameMutation, gameMutations } from '@/shared/state/gameMutations.ts'
import {
    ActionModifier,
    MinionAction,
    MinionActionType,
    NO_ACTION_MODIFIER,
    NO_BLOCK,
    NO_COMBAT,
    NO_REACTION,
} from '@/shared/types/state.ts'
import * as actions from '@/shared/state/minionActions.ts'
import { LibraryCard, Minion } from '@/shared/model/Card.ts'
import * as logging from '@/client/logging.ts'
import { declareAction, playCard } from '@/client/game/declaration.ts'
import { BOT_PAUSE_TIME, NEXT_PHASE, NEXT_TURN } from '@/shared/const/bot.ts'
import { applyMutationLocally } from '@/client/state/gameMutations.ts'
import { CardOid } from '@/shared/types/model.ts'

export type ConductorState = {
    turnInitDone: boolean
    cardsPlayed: CardOid[]
}

export class Conductor {
    turnInitDone = false

    // Cards played during an action, that must be discarded at the end of the action
    cardsPlayed = [] as LibraryCard[]

    constructor(public bot: Bot) {}

    getConductorState() {
        return {
            turnInitDone: this.turnInitDone,
            cardsPlayed: this.cardsPlayed.map(c => c.oid),
        }
    }

    setConductorState(conductorState: ConductorState) {
        const gameState = useGameStateStore()

        this.turnInitDone = conductorState.turnInitDone
        this.cardsPlayed = conductorState.cardsPlayed.map(
            cardOid => gameState.cards[cardOid] as LibraryCard,
        )
    }

    playCardFromHand(card: LibraryCard, actingMinion?: Minion) {
        playCard({ card, actingMinion })

        // Draw to replace the action card
        // This won't handle the "do not replace until..." card text
        gameMutations.drawLibrary.act(this.bot.player, {
            player: this.bot.player,
        })

        this.cardsPlayed.push(card)
    }

    onActionResolve() {
        // Send played cards to ash heap
        for (const card of this.cardsPlayed) {
            gameMutations.moveCardToRegion.act(card.controller, {
                card,
                fromCardRegion: card.region,
                toCardRegion: card.owner.ashHeap,
                x: 0,
                y: 0,
            })
        }
        this.cardsPlayed = []
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

    _applyBotDecision(decisionCallback: VoidFunction) {
        setTimeout(() => {
            try {
                decisionCallback()
            } catch (error) {
                logging.captureException(error)
            }
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
            const validity = actions.canDeclare(action)
            if (!validity.isValid) {
                this.invalidDecision(validity.reason, action)
                return validity
            }

            declareAction(action, this.bot.player)

            if (action.type == MinionActionType.ActionCardFromHand) {
                this.playCardFromHand(action.card, action.actingMinion)
            }
        })
    }

    applyActionModifier(actionModifier: ActionModifier) {
        this._applyBotDecision(() => {
            const gameState = useGameStateStore()
            this.playCardFromHand(actionModifier.card, gameState.action?.minionAction.actingMinion)
            actions.applyActionModifier(actionModifier)
        })
    }

    // @ts-expect-error: Silenced for now, the bot is considered low-priority.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    invalidDecision(reason: string, decision: BotDecision) {
        // TODO: uncomment when getting back to work on the bot.
        // logging.captureMessage(`INVALID BOT DECISION !!! : ${reason}\n${JSON.stringify(decision)}`)
    }

    mustStopPlaying() {
        const gameState = useGameStateStore()

        // An ousted bot doesn't play anymore
        // Stop playing if we're the last one in game
        return this.bot.player.isOusted || gameState.competingPlayers.length == 1
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

        if (!decision) {
            return
        }

        // Now, apply the decision
        if (decision instanceof GameMutation) {
            this.applyGameMutation(decision)
        } else if (actions.isMinionAction(decision)) {
            this.applyMinionAction(decision)
        } else if (actions.isActionModifier(decision)) {
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
            // Combat implementation not done yet
        } else if (decision == NEXT_PHASE) {
            this.nextPhaseDecision()
        } else if (decision == NEXT_TURN) {
            this.endTurnDecision()
        }
    }
}
