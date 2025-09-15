import { gameMutations } from '@/state/gameMutations.ts'
import Phaser from 'phaser'
import KeyCodes = Phaser.Input.Keyboard.KeyCodes
import { useGameBusStore } from '@/store/bus.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { RegionName, TurnSequence } from '@/model/const.ts'
import { Card, Vampire } from '@/model/Card.ts'
import { resetCamera } from '@/game/camera.ts'
import { useHistoryStore } from '@/store/history.ts'

const KEYCODE_EQUALS_PLUS = 61
const KEYCODE_PLUS = 171
const KEYCODE_MINUS_FIREFOX = 173

export type Command = {
    keyCodes: number[] // Array of Phaser.Input.Keyboard.KeyCodes
    repr: string // The string to represent this key in the UI
    isDisabled: () => boolean
    trigger: () => void
    cardAction: (card: Card) => void
}

export function useCommands() {
    const gameBus = useGameBusStore()
    const gameState = useGameStateStore()

    function createCommand(command: Partial<Command>): Command {
        return {
            keyCodes: [],
            repr: '',
            isDisabled: () => false,
            trigger: () => {
                throw new Error('trigger must be overridden')
            },
            cardAction: () => {
                throw new Error('cardAction must be overridden')
            },
            ...command,
        }
    }

    function createCardCommand(
        command: Partial<Command> & { cardAction: (card: Card) => void },
    ): Command {
        return createCommand({
            isDisabled: () => {
                return !gameBus.selectedCards.length
            },
            trigger: () => {
                gameBus.selectedCards.forEach(card => command.cardAction(card))
            },
            ...command,
        })
    }

    function createGoToPhaseCommand(keyCodes: number[], index: number) {
        return createCommand({
            keyCodes,
            repr: TurnSequence[index],
            isDisabled: () => {
                return gameState.turnPhaseIndex == index
            },
            trigger: () => {
                gameMutations.goToTurnPhase.actSelf({ index })
            },
        })
    }

    return {
        AdvanceTurn: createCommand({
            keyCodes: [KeyCodes.ENTER],
            repr: '↵',
            trigger: () => {
                gameMutations.goToTurn.actSelf({ index: gameState.turnNumber + 1 })
            },
        }),

        BackTurn: createCommand({
            isDisabled: () => {
                return gameState.turnNumber == 1
            },
            trigger: () => {
                gameMutations.goToTurn.actSelf({ index: gameState.turnNumber - 1 })
            },
        }),

        AdvanceTurnPhase: createCommand({
            keyCodes: [KeyCodes.RIGHT, KeyCodes.SPACE],
            repr: '→',
            isDisabled: () => {
                return gameState.turnPhaseIndex >= TurnSequence.length - 1
            },
            trigger: () => {
                gameMutations.goToTurnPhase.actSelf({ index: gameState.turnPhaseIndex + 1 })
            },
        }),

        GoToUnlock: createGoToPhaseCommand([KeyCodes.ONE], 0),
        GoToMaster: createGoToPhaseCommand([KeyCodes.TWO], 1),
        GoToMinion: createGoToPhaseCommand([KeyCodes.THREE], 2),
        GoToInfluence: createGoToPhaseCommand([KeyCodes.FOUR], 3),
        GoToDiscard: createGoToPhaseCommand([KeyCodes.FIVE], 4),

        BackTurnPhase: createCommand({
            keyCodes: [KeyCodes.LEFT],
            repr: '←',
            isDisabled: () => {
                return gameState.turnPhaseIndex == 0
            },
            trigger: () => {
                gameMutations.goToTurnPhase.actSelf({ index: gameState.turnPhaseIndex - 1 })
            },
        }),

        DrawCrypt: createCommand({
            keyCodes: [KeyCodes.C],
            repr: 'C',
            isDisabled: () => {
                return gameState.selfPlayer.crypt.isEmpty
            },
            trigger: () => {
                gameMutations.drawCrypt.actSelf({ player: gameState.selfPlayer })
            },
        }),

        DrawLib: createCommand({
            keyCodes: [KeyCodes.D],
            repr: 'D',
            isDisabled: () => {
                return gameState.selfPlayer.library.isEmpty
            },
            trigger: () => {
                gameMutations.drawLibrary.actSelf({ player: gameState.selfPlayer })
            },
        }),

        GainBlood: createCardCommand({
            keyCodes: [KeyCodes.NUMPAD_ADD, KEYCODE_PLUS, KEYCODE_EQUALS_PLUS],
            repr: '+',
            cardAction: (card: Card) => {
                gameMutations.changeBlood.actSelf({
                    card,
                    amount: 1,
                })
            },
        }),

        BurnBlood: createCardCommand({
            // Six is for azerty keyboards, because I'm French 🙃
            keyCodes: [
                KeyCodes.NUMPAD_SUBTRACT,
                KeyCodes.MINUS,
                KEYCODE_MINUS_FIREFOX,
                KeyCodes.SIX,
            ],
            repr: '-',
            cardAction: (card: Card) => {
                gameMutations.changeBlood.actSelf({
                    card,
                    amount: -1,
                })
            },
        }),

        GainGreenCounter: createCardCommand({
            keyCodes: [KeyCodes.G],
            repr: 'G',
            cardAction: (card: Card) => {
                gameMutations.changeGreenCounter.actSelf({
                    card,
                    amount: 1,
                })
            },
        }),

        BurnGreenCounter: createCardCommand({
            keyCodes: [KeyCodes.H],
            repr: 'H',
            cardAction: (card: Card) => {
                gameMutations.changeGreenCounter.actSelf({
                    card,
                    amount: -1,
                })
            },
        }),

        Influence: createCardCommand({
            keyCodes: [KeyCodes.I],
            repr: 'I',
            isDisabled: () => {
                return (
                    gameBus.selectedCards.filter(
                        card => card.region.name == RegionName.Uncontrolled,
                    ).length == 0
                )
            },
            cardAction: (card: Card) => {
                if (card instanceof Vampire && card.region.name == RegionName.Uncontrolled) {
                    gameMutations.influence.actSelf({
                        card,
                        amount: 1,
                    })
                }
            },
        }),

        Flip: createCardCommand({
            keyCodes: [KeyCodes.F],
            repr: 'F',
            cardAction: (card: Card) => {
                gameMutations.setFlip.actSelf({
                    card,
                    newValue: !card.isFlipped,
                })
            },
        }),

        UnlockAll: createCommand({
            keyCodes: [KeyCodes.U],
            repr: 'U',
            trigger: () => {
                gameMutations.unlockAll.actSelf({
                    player: gameState.selfPlayer,
                })
            },
        }),

        DiscardAtRandom: createCommand({
            keyCodes: [KeyCodes.R],
            repr: 'R',
            isDisabled: () => {
                return gameState.selfPlayer.hand.isEmpty
            },
            trigger: () => {
                gameMutations.discardAtRandom.actSelf({
                    card: gameState.selfPlayer.hand.getRandomCard(),
                })
            },
        }),

        Cancel: createCommand({
            keyCodes: [KeyCodes.BACKSPACE],
            repr: '⟵',
            isDisabled: () => {
                return !useHistoryStore().nextCancellableMutation
            },
            trigger: () => {
                useHistoryStore().nextCancellableMutation?.cancel()
            },
        }),

        MoveToAshHeap: createCardCommand({
            keyCodes: [KeyCodes.A],
            repr: 'A',
            cardAction: (card: Card) => {
                if (
                    [RegionName.Hand, RegionName.Controlled, RegionName.Torpor].includes(
                        card.region.name,
                    )
                ) {
                    gameMutations.moveCardToRegion.actSelf({
                        card,
                        fromCardRegion: card.region,
                        toCardRegion: card.controller.ashHeap,
                        position: 0,
                    })
                }
            },
        }),

        ResetCamera: createCommand({
            keyCodes: [KeyCodes.M],
            trigger: () => {
                resetCamera()
            },
        }),
    }
}
