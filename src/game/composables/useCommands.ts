import { reactive } from 'vue'
import { gameMutations } from '@/state/gameMutations.ts'
import Phaser from 'phaser'
import KeyCodes = Phaser.Input.Keyboard.KeyCodes
import { useGameBusStore } from '@/store/bus.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { TurnSequence } from '@/model/const.ts'
import { Card } from '@/model/Card.ts'
import { resetCamera } from '@/game/camera.ts'
import { useHistoryStore } from '@/store/history.ts'
import { useCoreStore } from '@/store/core.ts'

const KEYCODE_EQUALS_PLUS_FIREFOX = 61
const KEYCODE_PLUS = 171
const KEYCODE_MINUS_FIREFOX = 173

export type Command = {
    name: string // The technical name
    label: string // Verbose label for users
    repr: string // The string to represent this key in the UI
    keyCodes: number[] // Array of Phaser.Input.Keyboard.KeyCodes
    isDisabled: () => boolean
    trigger: () => void
    cardAction: (card: Card) => void
}
type Commands = Record<string, Command>

let commands: Commands | null = null

function createCommands(): Commands {
    const core = useCoreStore()
    const gameBus = useGameBusStore()
    const gameState = useGameStateStore()

    // Initialize shortcuts object if it doesn't exist
    if (!core.userProfile.preferences.keyBindings) {
        core.userProfile.preferences.keyBindings = {}
    }
    const keyBindings = core.userProfile.preferences.keyBindings

    function createCommand(command: Partial<Command>): Command {
        const keyBinding = keyBindings[command.name ?? '']
        const custom: Partial<Command> = {}
        if (keyBinding) {
            custom.repr = keyBinding.repr
            custom.keyCodes = [keyBinding.keyCode]
        }

        return {
            name: '',
            label: '',
            repr: '',
            keyCodes: [],
            isDisabled: () => false,
            trigger: () => {
                throw new Error('trigger must be overridden')
            },
            cardAction: () => {
                throw new Error('cardAction must be overridden')
            },
            ...command,
            ...custom,
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
            name: `GoToPhase-${TurnSequence[index]}`,
            label: `${TurnSequence[index]} Phase`,
            repr: index.toString(),
            keyCodes,
            isDisabled: () => {
                return gameState.turnPhaseIndex == index
            },
            trigger: () => {
                gameMutations.goToTurnPhase.actSelf({ index })
            },
        })
    }

    return reactive({
        AdvanceTurn: createCommand({
            name: 'AdvanceTurn',
            label: 'Advance Turn',
            repr: '↵',
            keyCodes: [KeyCodes.ENTER],
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
            name: 'AdvanceTurnPhase',
            label: 'Next Phase',
            repr: '→',
            keyCodes: [KeyCodes.RIGHT, KeyCodes.SPACE],
            isDisabled: () => {
                return gameState.turnPhaseIndex >= TurnSequence.length - 1
            },
            trigger: () => {
                gameMutations.goToTurnPhase.actSelf({ index: gameState.turnPhaseIndex + 1 })
            },
        }),
        BackTurnPhase: createCommand({
            name: 'BackTurnPhase',
            label: 'Previous Phase',
            repr: '←',
            keyCodes: [KeyCodes.LEFT],
            isDisabled: () => {
                return gameState.turnPhaseIndex == 0
            },
            trigger: () => {
                gameMutations.goToTurnPhase.actSelf({ index: gameState.turnPhaseIndex - 1 })
            },
        }),

        GoToUnlock: createGoToPhaseCommand([KeyCodes.ONE], 0),
        GoToMaster: createGoToPhaseCommand([KeyCodes.TWO], 1),
        GoToMinion: createGoToPhaseCommand([KeyCodes.THREE], 2),
        GoToInfluence: createGoToPhaseCommand([KeyCodes.FOUR], 3),
        GoToDiscard: createGoToPhaseCommand([KeyCodes.FIVE], 4),

        DrawCrypt: createCommand({
            name: 'DrawCrypt',
            label: 'Draw Crypt',
            repr: 'C',
            keyCodes: [KeyCodes.C],
            isDisabled: () => {
                return gameState.selfPlayer?.crypt.isEmpty ?? true
            },
            trigger: () => {
                if (!gameState.selfPlayer) {
                    return
                }
                gameMutations.drawCrypt.actSelf({ player: gameState.selfPlayer })
            },
        }),
        DrawLib: createCommand({
            name: 'DrawLib',
            label: 'Draw Library',
            repr: 'D',
            keyCodes: [KeyCodes.D],
            isDisabled: () => {
                return gameState.selfPlayer?.library.isEmpty ?? true
            },
            trigger: () => {
                if (!gameState.selfPlayer) {
                    return
                }
                gameMutations.drawLibrary.actSelf({ player: gameState.selfPlayer })
            },
        }),

        GainBlood: createCardCommand({
            name: 'GainBlood',
            label: 'Gain Blood',
            repr: '+',
            keyCodes: [
                KeyCodes.PLUS,
                KeyCodes.NUMPAD_ADD,
                KEYCODE_PLUS,
                KEYCODE_EQUALS_PLUS_FIREFOX,
            ],
            cardAction: (card: Card) => {
                gameMutations.changeBlood.actSelf({
                    card,
                    amount: 1,
                })
            },
        }),
        BurnBlood: createCardCommand({
            name: 'BurnBlood',
            label: 'Burn Blood',
            repr: '-',
            // Six is for azerty keyboards, because I'm French 🙃
            keyCodes: [
                KeyCodes.NUMPAD_SUBTRACT,
                KeyCodes.MINUS,
                KEYCODE_MINUS_FIREFOX,
                KeyCodes.SIX,
            ],
            cardAction: (card: Card) => {
                gameMutations.changeBlood.actSelf({
                    card,
                    amount: -1,
                })
            },
        }),

        GainGreenCounter: createCardCommand({
            name: 'GainGreenCounter',
            label: 'Gain Green Counter',
            repr: 'G',
            keyCodes: [KeyCodes.G],
            cardAction: (card: Card) => {
                gameMutations.changeGreenCounter.actSelf({
                    card,
                    amount: 1,
                })
            },
        }),
        BurnGreenCounter: createCardCommand({
            name: 'BurnGreenCounter',
            label: 'Burn Green Counter',
            repr: 'H',
            keyCodes: [KeyCodes.H],
            cardAction: (card: Card) => {
                gameMutations.changeGreenCounter.actSelf({
                    card,
                    amount: -1,
                })
            },
        }),

        Influence: createCardCommand({
            name: 'Influence',
            label: 'Influence',
            repr: 'I',
            keyCodes: [KeyCodes.I],
            isDisabled: () => {
                return gameBus.selectedCards.filter(card => card.isIn.uncontrolled).length == 0
            },
            cardAction: (card: Card) => {
                if (card.isVampire() && card.isIn.uncontrolled) {
                    gameMutations.influence.actSelf({
                        card,
                        amount: 1,
                    })
                }
            },
        }),

        Flip: createCardCommand({
            name: 'Flip',
            label: 'Flip',
            repr: 'F',
            keyCodes: [KeyCodes.F],
            cardAction: (card: Card) => {
                gameMutations.setFlip.actSelf({
                    card,
                    newValue: !card.isFlipped,
                })
            },
        }),

        UnlockAll: createCommand({
            name: 'UnlockAll',
            label: 'Unlock All',
            repr: 'U',
            keyCodes: [KeyCodes.U],
            trigger: () => {
                if (!gameState.selfPlayer) {
                    return
                }
                gameMutations.unlockAll.actSelf({
                    player: gameState.selfPlayer,
                })
            },
        }),

        DiscardAtRandom: createCommand({
            name: 'DiscardAtRandom',
            label: 'Discard At Random',
            repr: 'R',
            keyCodes: [KeyCodes.R],
            isDisabled: () => {
                return gameState.selfPlayer?.hand.isEmpty ?? true
            },
            trigger: () => {
                if (!gameState.selfPlayer) {
                    return
                }
                gameMutations.discardAtRandom.actSelf({
                    card: gameState.selfPlayer.hand.getRandomCard(),
                })
            },
        }),

        Cancel: createCommand({
            name: 'Cancel',
            label: 'Cancel',
            repr: '⟵',
            keyCodes: [KeyCodes.BACKSPACE],
            isDisabled: () => {
                return !useHistoryStore().nextCancellableMutation
            },
            trigger: () => {
                useHistoryStore().nextCancellableMutation?.cancel()
            },
        }),

        MoveToAshHeap: createCardCommand({
            name: 'MoveToAshHeap',
            label: 'Move To Ash Heap',
            repr: 'A',
            keyCodes: [KeyCodes.A],
            cardAction: (card: Card) => {
                if (card.isIn.controlled || card.isIn.hand) {
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

        DeclareTarget: createCardCommand({
            name: 'DeclareTarget',
            label: 'Declare Target',
            repr: 'T',
            keyCodes: [KeyCodes.T],
            isDisabled: () => {
                return gameBus.selectedCards.length > 1
            },
            cardAction: (card: Card) => {
                gameBus.declaringTargetOrigin = card
            },
        }),

        ClearDeclaredTargets: createCommand({
            name: 'ClearDeclaredTargets',
            label: 'Clear Targets',
            repr: 'X',
            keyCodes: [KeyCodes.X],
            isDisabled: () => {
                return gameState.targetDeclarations.length == 0
            },
            trigger: () => {
                gameMutations.UI_arrowClear.actSelf({})
            },
        }),

        DecreaseScale: createCommand({
            trigger: () => {
                if (!gameState.selfPlayer) {
                    return
                }
                gameMutations.UI_changeScale.actSelf({
                    player: gameState.selfPlayer,
                    scale: gameState.selfPlayer.scale - 0.1,
                })
            },
        }),

        IncreaseScale: createCommand({
            trigger: () => {
                if (!gameState.selfPlayer) {
                    return
                }
                gameMutations.UI_changeScale.actSelf({
                    player: gameState.selfPlayer,
                    scale: gameState.selfPlayer.scale + 0.1,
                })
            },
        }),
    })
}

export function updateCommands() {
    if (commands) {
        Object.assign(commands, createCommands())
    }
}

export function useCommands(): Commands {
    if (!commands) {
        commands = createCommands()
    }
    return commands
}
