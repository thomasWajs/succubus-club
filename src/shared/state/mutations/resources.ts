import { Player } from '@/shared/model/Player.ts'
import { Card, COUNTER_FIELDS } from '@/shared/model/Card.ts'
import { Marker } from '@/shared/const/model.ts'
import {
    AMOUNT_LOG_PLACEHOLDER,
    CARD_LOG_PLACEHOLDER,
    COUNT_LOG_PLACEHOLDER,
} from '@/shared/const/game.ts'
import { CardBaseAttribute, Invalid, VALID, Validity } from '@/shared/types/state.ts'
import { MutationSyncMode, VersioningId, VersioningTarget } from '@/shared/types/multiplayer.ts'
import { getCardAttribute, setCardAttribute } from '@/shared/state/cards/cardAttributes.ts'
import { secureName } from '@/shared/state/cards/cardVisibility.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { LogGroup } from '@/shared/types/history.ts'
import {
    bloodDetail,
    counterDetail,
    logPlayer,
    poolDetail,
} from '@/shared/state/history/mutationLog.ts'
import {
    AnyGameMutation,
    ChangeColoredCounterParams,
    ChangeCounterMutation,
    GameMutation,
    GameMutationParams,
} from '@/shared/state/mutations/base.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'

/**
 * Change Blood/life
 */

export class ChangeBlood extends ChangeCounterMutation {
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        const bloodName = this.params.card.bloodName

        // There's no blood outside of the play area
        if (!this.params.card.isIn.play)
            return Invalid(
                `${secureName(this.params.card, this.author)} : Cannot change ${bloodName} because it is not in play`,
            )

        // Cannot get a negative blood amount
        if (this.params.card.blood + this.params.amount < 0) {
            return Invalid(
                `${secureName(this.params.card, this.author)} : Cannot go below 0 ${bloodName}`,
            )
        }

        return VALID
    }

    protected updateGameState() {
        this.params.card.changeBlood(this.params.amount)
    }

    formatForLog() {
        return `${AMOUNT_LOG_PLACEHOLDER} ${this.params.card.bloodName} on ${CARD_LOG_PLACEHOLDER}`
    }

    formatLogDetails() {
        return [bloodDetail(this.params.card, this.params.amount)]
    }

    get logGroup(): LogGroup {
        return { key: `${this.name}-${this.params.card.oid}`, amount: this.params.amount }
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.changeBlood.createCancelMutation(this, {
            card: this.params.card,
            amount: this.params.amount * -1,
        })
    }
}

/**
 * Change a colored counter (green, orange, purple)
 */

export class ChangeCounter extends ChangeCounterMutation<ChangeColoredCounterParams> {
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        // There's no counters outside of the play area
        if (!this.params.card.isIn.play)
            return Invalid(
                `${secureName(this.params.card, this.author)} : Cannot change counter because it is not in play`,
            )

        // Cannot get a negative counter amount
        if (this.params.card[COUNTER_FIELDS[this.params.color]] + this.params.amount < 0) {
            return Invalid(
                `${secureName(this.params.card, this.author)} : Cannot go below 0 counter`,
            )
        }

        return VALID
    }

    protected updateGameState() {
        const field = COUNTER_FIELDS[this.params.color]
        this.params.card[field] = Math.max(0, this.params.card[field] + this.params.amount)
    }

    formatForLog() {
        return `${AMOUNT_LOG_PLACEHOLDER} ${this.params.color} counter on ${CARD_LOG_PLACEHOLDER}`
    }

    formatLogDetails() {
        const value = this.params.card[COUNTER_FIELDS[this.params.color]]
        return [
            counterDetail(
                `${this.params.color} counter`,
                value,
                this.params.amount,
                this.params.color,
            ),
        ]
    }

    get logGroup(): LogGroup {
        return {
            key: `${this.name}-${this.params.card.oid}-${this.params.color}`,
            amount: this.params.amount,
        }
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.changeCounter.createCancelMutation(this, {
            card: this.params.card,
            color: this.params.color,
            amount: this.params.amount * -1,
        })
    }
}

/**
 * Change Marker
 */
interface ChangeMarkerParams extends GameMutationParams {
    card: Card
    marker: Marker
    operation: 'Add' | 'Remove'
}

export class ChangeMarker extends GameMutation<ChangeMarkerParams> {
    readonly syncMode = MutationSyncMode.Ordered

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Marker}-${this.params.card.oid}`
    }

    getValidity() {
        // There's no markers outside of the play area
        if (!this.params.card.isIn.play)
            return Invalid(
                `${secureName(this.params.card, this.author)} : Cannot change marker because it is not in play`,
            )

        return VALID
    }

    protected updateGameState() {
        if (this.params.operation == 'Remove') {
            this.params.card.markers = this.params.card.markers.filter(
                marker => marker !== this.params.marker,
            )
        }

        if (this.params.operation == 'Add' && !this.params.card.hasMarker(this.params.marker)) {
            this.params.card.markers.push(this.params.marker)
        }
    }

    formatForLog() {
        return `${this.params.operation} ${this.params.marker} on ${CARD_LOG_PLACEHOLDER}`
    }

    get card() {
        return this.params.card
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.changeMarker.createCancelMutation(this, {
            card: this.params.card,
            marker: this.params.marker,
            operation: this.params.operation == 'Add' ? 'Remove' : 'Add',
        })
    }
}

/**
 * Change a card attribute
 *
 * A manual override for the numeric attributes the interface can't always
 * derive : a minion's bleed, stealth, intercept and strength, a vampire's hunt,
 * votes and ballots.
 */
interface ChangeCardAttributeParams extends GameMutationParams {
    card: Card
    attribute: CardBaseAttribute
    amount: number
}

export class ChangeCardAttribute extends GameMutation<ChangeCardAttributeParams> {
    readonly syncMode = MutationSyncMode.Merge

    get card() {
        return this.params.card
    }

    getValidity() {
        const value = getCardAttribute(this.params.card, this.params.attribute)
        if (value === null) {
            return Invalid(
                `${secureName(this.params.card, this.author)} : cannot edit ${this.params.attribute}`,
            )
        }
        return VALID
    }

    protected updateGameState() {
        const value = getCardAttribute(this.params.card, this.params.attribute)
        if (value !== null) {
            setCardAttribute(this.params.card, this.params.attribute, value + this.params.amount)
        }
    }

    formatForLog() {
        return `${AMOUNT_LOG_PLACEHOLDER} base ${this.params.attribute} on ${CARD_LOG_PLACEHOLDER}`
    }

    formatLogDetails() {
        const value = getCardAttribute(this.params.card, this.params.attribute) ?? 0
        return [counterDetail(this.params.attribute, value, this.params.amount)]
    }

    get logGroup(): LogGroup {
        return {
            key: `${this.name}-${this.params.card.oid}-${this.params.attribute}`,
            amount: this.params.amount,
        }
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.changeCardAttribute.createCancelMutation(this, {
            card: this.params.card,
            attribute: this.params.attribute,
            amount: this.params.amount * -1,
        })
    }
}

/**
 * Change Pool
 */
interface ChangePoolParams extends GameMutationParams {
    player: Player
    amount: number
}

export class ChangePool extends GameMutation<ChangePoolParams> {
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        // Cannot get a negative pool amount
        if (this.params.player.pool + this.params.amount < 0) {
            return Invalid(`${this.params.player.name} : Cannot go below 0 pool`)
        }

        return VALID
    }

    protected getStrictValidity(_gameState: GameState): Validity {
        if (this.params.player.oid != this.author.oid) {
            return Invalid(`Players can only change their own pool`)
        }

        return VALID
    }

    protected updateGameState() {
        this.params.player.changePool(this.params.amount)
    }

    formatForLog() {
        return `${AMOUNT_LOG_PLACEHOLDER} pool on ${logPlayer(this.params.player)}`
    }

    formatLogDetails() {
        return [poolDetail(this.params.player, this.params.amount)]
    }

    get logGroup(): LogGroup {
        return { key: `${this.name}-${this.params.player.oid}`, amount: this.params.amount }
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.changePool.createCancelMutation(this, {
            player: this.params.player,
            amount: this.params.amount * -1,
        })
    }
}

/**
 * Influence : pool to blood, a transfer per blood. A negative amount is a retro ( blood back to
 * the pool ), so it groups with the influences in the log : 2 transfers per blood. The undo of
 * either is an influence too, giving back the transfers it cost
 */

function influenceTransfers(amount: number): number {
    return amount > 0 ? amount : -amount * 2
}

export class Influence extends ChangeCounterMutation {
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        if (!this.params.card.canBeInfluenced()) {
            return Invalid('Influence must be done on uncontrolled vampires')
        }
        // Retro ( a negative amount ) : the blood goes back to the pool, it must be there
        if (this.params.card.blood + this.params.amount < 0) {
            return Invalid('Not enough blood to move back to the pool')
        }
        return VALID
    }

    protected getStrictValidity(_gameState: GameState): Validity {
        if (this.params.card.controllerOid != this.author.oid) {
            return Invalid(`Players can only influence their own cards`)
        }

        return VALID
    }

    protected updateGameState(gameState: GameState) {
        const card = this.params.card
        card.changeBlood(this.params.amount)
        card.controller.changePool(-this.params.amount)
        // An undo has the opposite amount of the influence it undoes
        gameState.turnResources.transfers +=
            this.cancelsMutationId !== undefined ?
                influenceTransfers(-this.params.amount)
            :   -influenceTransfers(this.params.amount)
    }

    // A retro gives its size, unsigned : the log groups it with the influences all the same
    formatForLog() {
        if (this.params.amount < 0) {
            return `Retro ${COUNT_LOG_PLACEHOLDER} on ${CARD_LOG_PLACEHOLDER}`
        }
        return `Influence ${COUNT_LOG_PLACEHOLDER} on ${CARD_LOG_PLACEHOLDER}`
    }

    // The pool pays for the blood
    formatLogDetails() {
        return [
            bloodDetail(this.params.card, this.params.amount),
            poolDetail(this.params.card.controller, -this.params.amount),
        ]
    }

    get logGroup(): LogGroup {
        return { key: `${this.name}-${this.params.card.oid}`, amount: this.params.amount }
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.influence.createCancelMutation(this, {
            card: this.params.card,
            amount: this.params.amount * -1,
        })
    }
}
