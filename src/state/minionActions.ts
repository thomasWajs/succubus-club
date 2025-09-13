import { Card, LibraryCard, Minion } from '@/model/Card.ts'
import { Player } from '@/model/Player.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import {
    Discipline,
    DisciplineLevel,
    LEAVE_TORPOR_COST,
    LibraryCardType,
    RegionName,
} from '@/model/const.ts'
import {
    ActionCardImplementation,
    ActionCardUsage,
    ActionModifierCardImplementation,
    ActionModifierUsage,
} from '@/resources/cardImpl/base.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { Invalid, VALID, Validity } from '@/state/types.ts'
import {
    ActionCardImplementationConstructor,
    ActionModifierCardImplementationConstructor,
} from '@/resources/cardImpl'

export abstract class MinionAction {
    abstract name: string

    constructor(
        public actingMinion: Minion,
        public target?: Card | Minion | Player,
    ) {}

    get isUndirected() {
        const gameState = useGameStateStore()
        return (
            !this.target ||
            this.target == gameState.activePlayer ||
            (this.target instanceof Card && this.target.controller == gameState.activePlayer)
        )
    }

    get isDirected() {
        return !this.isUndirected
    }

    abstract get defaultStealth(): number

    get isBleed() {
        return false
    }

    get isHunt() {
        return false
    }

    canDeclare(): Validity {
        return VALID
    }

    declare() {}

    resolve() {
        if (this.isBleed) {
            this.resolveBleed()
        }
        if (this.isHunt) {
            this.resolveHunt()
        }
    }

    resolveBleed() {
        const gameState = useGameStateStore()

        if (!(this.target instanceof Player)) {
            throw new Error('Bleed target must be a player')
        }
        if (!gameState.action) {
            throw new Error('Resolve bleed without gameState.action')
        }

        gameMutations.changePool.act(this.actingMinion.controller, {
            player: this.target,
            amount: -gameState.action.bleed,
        })

        if (this.actingMinion.controller.oid != useGameStateStore().theEdgeControllerOid) {
            gameMutations.changeTheEdgeControl.act(this.actingMinion.controller, {
                newController: this.actingMinion.controller,
            })
        }
    }

    resolveHunt() {
        const gameState = useGameStateStore()
        if (!gameState.action) {
            throw new Error('Resolve hunt without gameState.action')
        }

        gameMutations.changeBlood.act(this.actingMinion.controller, {
            card: this.actingMinion,
            amount: gameState.action.hunt,
        })
    }
}

export class BleedAction extends MinionAction {
    name = 'Bleed'

    constructor(
        public actingMinion: Minion,
        public targetPlayer: Player,
    ) {
        super(actingMinion, targetPlayer)
    }

    get defaultStealth() {
        return 0
    }

    get isBleed() {
        return true
    }
}

export class HuntAction extends MinionAction {
    name = 'Hunt'

    constructor(public actingMinion: Minion) {
        super(actingMinion)
    }

    get defaultStealth() {
        return 1
    }

    get isHunt() {
        return true
    }
}

export class LeaveTorporAction extends MinionAction {
    name = 'Leave torpor'

    constructor(public actingMinion: Minion) {
        super(actingMinion)
    }

    get defaultStealth() {
        return 1
    }

    canDeclare() {
        if (this.actingMinion.region.name != RegionName.Torpor) {
            return Invalid('Acting vampire must be in torpor')
        }
        if (this.actingMinion.blood < LEAVE_TORPOR_COST) {
            return Invalid("Acting vampire doesn't have enough blood")
        }
        return VALID
    }

    resolve() {
        gameMutations.changeBlood.act(this.actingMinion.controller, {
            card: this.actingMinion,
            amount: -LEAVE_TORPOR_COST,
        })
        gameMutations.moveCardToRegion.act(this.actingMinion.controller, {
            card: this.actingMinion,
            fromCardRegion: this.actingMinion.region,
            toCardRegion: this.actingMinion.controller.controlled,
            x: 0,
            y: 0,
        })
    }
}

export class RescueFromTorporAction extends MinionAction {
    name = 'Rescue from torpor'

    constructor(
        public actingMinion: Minion,
        public rescuedMinion: Minion,
        public bloodPaidByActingMinion: number,
        public bloodPaidByRescuedMinion: number,
    ) {
        super(actingMinion, rescuedMinion)
    }

    get defaultStealth() {
        return this.actingMinion.controllerOid == this.rescuedMinion.controllerOid ? 1 : 0
    }

    canDeclare() {
        if (this.actingMinion.region.name != RegionName.Controlled) {
            return Invalid('Acting vampire must be ready')
        }
        if (this.rescuedMinion.region.name != RegionName.Torpor) {
            return Invalid('Rescued vampire must be in torpor')
        }
        if (this.actingMinion.blood + this.rescuedMinion.blood < LEAVE_TORPOR_COST) {
            return Invalid('Not enough blood')
        }
        return VALID
    }

    resolve() {
        gameMutations.changeBlood.act(this.actingMinion.controller, {
            card: this.actingMinion,
            amount: -this.bloodPaidByActingMinion,
        })
        gameMutations.changeBlood.act(this.actingMinion.controller, {
            card: this.rescuedMinion,
            amount: -this.bloodPaidByRescuedMinion,
        })
        gameMutations.moveCardToRegion.act(this.actingMinion.controller, {
            card: this.rescuedMinion,
            fromCardRegion: this.rescuedMinion.region,
            toCardRegion: this.rescuedMinion.controller.controlled,
            x: 0,
            y: 0,
        })
    }
}

export class BecomeAnarchAction extends MinionAction {
    name = 'BecomeAnarch'

    constructor(public actingMinion: Minion) {
        super(actingMinion)
    }

    get defaultStealth() {
        return 1
    }

    resolve() {}
}

export class ActionCardAction extends MinionAction {
    name = 'Generic ActionCard'
    implementation: ActionCardImplementation

    constructor(
        public actingMinion: Minion,
        public actionCard: LibraryCard,
        public usage: ActionCardUsage,
    ) {
        if (actionCard.type != LibraryCardType.Action) {
            throw new Error("ActionCardAction needs a LibraryCard with type 'Action'")
        }
        if (!actionCard.implementation) {
            throw new Error(`No implementation for card ${actionCard.name}`)
        }
        super(actingMinion, usage.target)

        const ImplementationClass = actionCard.implementation as ActionCardImplementationConstructor
        if (!ImplementationClass) {
            throw new Error('Cannot create an ActionCardAction without its implementation')
        }
        this.implementation = new ImplementationClass(usage)
        const level =
            usage.level ?
                usage.level == DisciplineLevel.SUPERIOR ?
                    ' SUP'
                :   ' inf'
            :   ''
        this.name = `${actionCard.name}${level}`
    }

    get defaultStealth() {
        return this.implementation.getStealth()
    }

    get isBleed() {
        return this.implementation.isBleed
    }

    get isHunt() {
        return this.implementation.isHunt
    }

    canDeclare() {
        // Check for discipline compatibility if needed
        // For now, don't take into account multi-discipline cards
        const cardDiscipline = this.actionCard.resource.discipline as Discipline
        if (cardDiscipline) {
            if (!this.usage.level) {
                return Invalid('Usage has no level')
            }
            if (!this.actingMinion.hasDiscipline(cardDiscipline, this.usage.level)) {
                return Invalid("Acting vampire doesn't have corresponding discipline level")
            }
        }
        return this.implementation.canDeclare(this.actingMinion)
    }

    declare() {
        this.implementation.declare()
    }

    resolve() {
        // TODO: fizzle if cannot pay cost

        // Pay blood cost
        if (this.actionCard.bloodCost) {
            gameMutations.changeBlood.act(this.actingMinion.controller, {
                card: this.actingMinion,
                amount: -this.actionCard.bloodCost,
            })
        }
        // Pay pool cost
        if (this.actionCard.poolCost) {
            gameMutations.changePool.act(this.actingMinion.controller, {
                player: this.actingMinion.controller,
                amount: -this.actionCard.poolCost,
            })
        }

        super.resolve()
        this.implementation.resolve()

        // Send the action card to ash heap
        this.sendCardToAshHeap()
    }

    sendCardToAshHeap() {
        gameMutations.moveCardToRegion.act(this.actingMinion.controller, {
            card: this.actionCard,
            fromCardRegion: this.actionCard.region,
            toCardRegion: this.actingMinion.controller.ashHeap,
            x: 0,
            y: 0,
        })
    }
}

export class ActionModifier {
    name: string
    implementation: ActionModifierCardImplementation

    constructor(
        public actionModifierCard: LibraryCard,
        public usage: ActionModifierUsage,
    ) {
        if (actionModifierCard.type != LibraryCardType.ActionModifier) {
            throw new Error("ActionModifier needs a LibraryCard with type 'ActionModifier'")
        }
        if (!actionModifierCard.implementation) {
            throw new Error(`No implementation for card ${actionModifierCard.name}`)
        }

        const ImplementationClass =
            actionModifierCard.implementation as ActionModifierCardImplementationConstructor
        if (!ImplementationClass) {
            throw new Error('Cannot create an ActionModifier without its implementation')
        }
        this.implementation = new ImplementationClass(usage)
        const level =
            usage.level ?
                usage.level == DisciplineLevel.SUPERIOR ?
                    ' SUP'
                :   ' inf'
            :   ''
        this.name = `${actionModifierCard.name}${level}`
    }

    apply() {
        this.implementation.apply()
    }
}
