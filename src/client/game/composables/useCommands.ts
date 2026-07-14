import { reactive } from 'vue'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import Phaser from 'phaser'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { TurnSequence } from '@/shared/const/model.ts'
import { Card } from '@/shared/model/Card.ts'
import { resetCamera } from '@/client/game/camera.ts'
import { useHistoryStore } from '@/client/store/history.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { ALL_PLAYERS } from '@/shared/types/state.ts'
import { startTargetDeclaration } from '@/client/game/declaration.ts'
import { cancelMutation } from '@/client/state/gameMutations.ts'
import { GRID_SIZE } from '@/shared/const/game.ts'
import KeyCodes = Phaser.Input.Keyboard.KeyCodes

const KEYCODE_EQUALS_PLUS_FIREFOX = 61
const KEYCODE_PLUS = 171
const KEYCODE_MINUS_FIREFOX = 173

export type Command = {
    name: string // The technical name
    label: string // Verbose label for users
    repr: string // The string to represent this key in the UI
    defaultRepr: string // The default repr
    keyCodes: number[] // Array of Phaser.Input.Keyboard.KeyCodes
    isDisabled: () => boolean
    trigger: VoidFunction
    cardAction: (card: Card) => void
    onKeyDown: VoidFunction
    onKeyUp?: VoidFunction
}
type Commands = Record<string, Command>

let commands: Commands | null = null

function createCommands(): Commands {
    const core = useCoreStore()
    const gameBus = useGameBusStore()
    const gameState = useGameStateStore()
    const players = usePlayersStore()

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
            defaultRepr: command.repr ?? '',
            keyCodes: [],
            isDisabled: () => false,
            trigger: () => {
                throw new Error('trigger must be overridden')
            },
            cardAction: () => {
                throw new Error('cardAction must be overridden')
            },
            onKeyDown: () => {
                command.trigger?.()
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

    function createMoveCommand(dx: number, dy: number, command: Partial<Command>): Command {
        return createCommand({
            isDisabled: () => !gameBus.selectedCards.some(card => card.isIn.play),
            trigger: () => {
                // Direct selection + group members, restricted to play-area cards
                const groupCards = gameBus.indirectSelectedCards.map(oid => gameState.cards[oid])
                const cards = [...gameBus.selectedCards, ...groupCards].filter(c => c?.isIn.play)

                // Sort by movement direction so Card.setCoordinates() overlap-avoidance
                // doesn't bump a card into a cell still occupied by an unmoved card.
                // (Same heuristic as CardGO.vue dispatchDragEvent.)
                cards.sort((a, b) => {
                    const xDelta = (b.x - a.x) * (dx >= 0 ? 1 : -1)
                    const yDelta = (b.y - a.y) * (dy >= 0 ? 1 : -1)
                    return yDelta * 10000 + xDelta
                })

                for (const card of cards) {
                    gameMutations.moveCard.actSelf({ card, x: card.x + dx, y: card.y + dy })
                }
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
            isDisabled: () => {
                return !!gameState.action || !!gameState.combat
            },
            trigger: () => {
                gameMutations.goToTurn.actSelf({ index: gameState.turnNumber + 1 })
            },
        }),
        BackTurn: createCommand({
            isDisabled: () => {
                return gameState.turnNumber == 1 || !!gameState.action || !!gameState.combat
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
                return (
                    gameState.turnPhaseIndex >= TurnSequence.length - 1 ||
                    !!gameState.action ||
                    !!gameState.combat
                )
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
                return gameState.turnPhaseIndex == 0 || !!gameState.action || !!gameState.combat
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

        MoveCardUp: createMoveCommand(0, -GRID_SIZE, {
            name: 'MoveCardUp',
            label: 'Move Card Up',
            repr: 'Numpad8',
            keyCodes: [KeyCodes.NUMPAD_EIGHT],
        }),
        MoveCardDown: createMoveCommand(0, GRID_SIZE, {
            name: 'MoveCardDown',
            label: 'Move Card Down',
            repr: 'Numpad2',
            keyCodes: [KeyCodes.NUMPAD_TWO],
        }),
        MoveCardLeft: createMoveCommand(-GRID_SIZE, 0, {
            name: 'MoveCardLeft',
            label: 'Move Card Left',
            repr: 'Numpad4',
            keyCodes: [KeyCodes.NUMPAD_FOUR],
        }),
        MoveCardRight: createMoveCommand(GRID_SIZE, 0, {
            name: 'MoveCardRight',
            label: 'Move Card Right',
            repr: 'Numpad6',
            keyCodes: [KeyCodes.NUMPAD_SIX],
        }),

        DrawCrypt: createCommand({
            name: 'DrawCrypt',
            label: 'Draw Crypt',
            repr: 'C',
            keyCodes: [KeyCodes.C],
            isDisabled: () => {
                return players.selfPlayer?.crypt.isEmpty ?? true
            },
            trigger: () => {
                if (!players.selfPlayer) {
                    return
                }
                gameMutations.drawCrypt.actSelf({ player: players.selfPlayer })
            },
        }),
        DrawLib: createCommand({
            name: 'DrawLib',
            label: 'Draw Library',
            repr: 'D',
            keyCodes: [KeyCodes.D],
            isDisabled: () => {
                return players.selfPlayer?.library.isEmpty ?? true
            },
            trigger: () => {
                if (!players.selfPlayer) {
                    return
                }
                gameMutations.drawLibrary.actSelf({ player: players.selfPlayer })
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

        GainOrangeCounter: createCardCommand({
            name: 'GainOrangeCounter',
            label: 'Gain Orange Counter',
            repr: 'B',
            keyCodes: [KeyCodes.B],
            cardAction: (card: Card) => {
                gameMutations.changeOrangeCounter.actSelf({
                    card,
                    amount: 1,
                })
            },
        }),
        BurnOrangeCounter: createCardCommand({
            name: 'BurnOrangeCounter',
            label: 'Burn Orange Counter',
            repr: 'N',
            keyCodes: [KeyCodes.N],
            cardAction: (card: Card) => {
                gameMutations.changeOrangeCounter.actSelf({
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

        InvertLock: createCardCommand({
            name: 'InvertLock',
            label: 'Lock / Unlock',
            repr: 'L',
            keyCodes: [KeyCodes.L],
            cardAction: (card: Card) => {
                gameMutations.setLock.actSelf({
                    card,
                    newValue: !card.isLocked,
                })
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
                if (!players.selfPlayer) {
                    return
                }
                gameMutations.unlockAll.actSelf({
                    player: players.selfPlayer,
                })
            },
        }),

        DiscardAtRandom: createCommand({
            name: 'DiscardAtRandom',
            label: 'Discard At Random',
            repr: 'R',
            keyCodes: [KeyCodes.R],
            isDisabled: () => {
                return players.selfPlayer?.hand.isEmpty ?? true
            },
            trigger: () => {
                if (!players.selfPlayer) {
                    return
                }
                gameMutations.discardAtRandom.actSelf({
                    card: players.selfPlayer.hand.getRandomCard(),
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
                const mutationEntry = useHistoryStore().nextCancellableMutation
                if (mutationEntry) {
                    cancelMutation(mutationEntry)
                }
            },
        }),

        MoveToAshHeap: createCardCommand({
            name: 'MoveToAshHeap',
            label: 'Move To Ash Heap',
            repr: 'A',
            keyCodes: [KeyCodes.A],
            cardAction: (card: Card) => {
                if (!card.isIn.ashHeap && !card.isIn.removed) {
                    gameMutations.moveCardToRegion.actSelf({
                        card,
                        fromCardRegion: card.region,
                        toCardRegion: card.owner.ashHeap,
                        position: 0,
                    })
                }
            },
        }),

        RemoveFromGame: createCardCommand({
            name: 'RemoveFromGame',
            label: 'Remove From Game',
            repr: 'END',
            keyCodes: [KeyCodes.END],
            cardAction: (card: Card) => {
                if (!card.isIn.removed) {
                    gameMutations.moveCardToRegion.actSelf({
                        card,
                        fromCardRegion: card.region,
                        toCardRegion: card.owner.removed,
                        position: 0,
                    })
                }
            },
        }),

        QuickReveal: createCardCommand({
            name: 'QuickReveal',
            cardAction: (card: Card) => {
                if (card.isIn.library || card.isIn.crypt) {
                    gameMutations.reveal.actSelf({
                        target: card,
                        viewer: ALL_PLAYERS,
                    })

                    setTimeout(() => {
                        gameMutations.reveal.actSelf({
                            target: card,
                            viewer: ALL_PLAYERS,
                        })
                    }, 500)
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
            cardAction: startTargetDeclaration,
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
                gameMutations.UI_changeTargetDeclaration.actSelf({ targetDeclarations: [] })
            },
        }),

        DecreaseScale: createCommand({
            trigger: () => {
                if (!players.selfPlayer) {
                    return
                }
                gameMutations.UI_changeScale.actSelf({
                    player: players.selfPlayer,
                    scale: players.selfPlayer.scale - 0.1,
                })
            },
        }),

        FocusMode: createCommand({
            name: 'FocusMode',
            label: 'Focus Mode',
            repr: 'F8',
            keyCodes: [KeyCodes.F8],
            trigger: () => {
                gameBus.toggleFocusMode()
            },
        }),

        IncreaseScale: createCommand({
            trigger: () => {
                if (!players.selfPlayer) {
                    return
                }
                gameMutations.UI_changeScale.actSelf({
                    player: players.selfPlayer,
                    scale: players.selfPlayer.scale + 0.1,
                })
            },
        }),

        PingCard: createCardCommand({
            name: 'PingCard',
            label: 'Ping Card',
            repr: 'P',
            keyCodes: [KeyCodes.P],
            cardAction: (card: Card) => {
                gameMutations.UI_pingCard.actSelf({
                    card,
                })
            },
        }),

        ZoomCard: createCommand({
            name: 'ZoomCard',
            label: 'Zoom Card',
            repr: 'Z',
            keyCodes: [KeyCodes.Z],
            onKeyDown: () => {
                gameBus.zoomHoveredCard = true
            },
            onKeyUp: () => {
                gameBus.zoomHoveredCard = false
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
