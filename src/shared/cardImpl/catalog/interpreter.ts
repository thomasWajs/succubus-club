import {
    ActionCardImplementation,
    ActionModifierCardImplementation,
    CardImplementation,
    CombatCardEffect,
    CombatCardImplementation,
    CryptCardImplementation,
    MasterCardImplementation,
    ReactionCardEffect,
    ReactionCardImplementation,
} from '@/shared/cardImpl/base.ts'
import type {
    CardImplementationConstructor,
    MasterCardImplementationConstructor,
} from '@/shared/cardImpl/index.ts'
import {
    Card,
    CryptCard,
    LibraryCard,
    Minion,
    UNKNOWN_MINION_ATTRS,
    Vampire,
} from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { DEFAULT_CARD_ATTRS, LibraryCardType } from '@/shared/const/model.ts'
import { getBlockingDecision, getBlockingMinion, isAwake } from '@/shared/state/actionState.ts'
import {
    createDodgeStrike,
    createHandStrike,
    getCombatant,
    getOpposingCombatant,
    startCombat,
} from '@/shared/state/combatState.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { canEnterCombatWith, isBleed } from '@/shared/state/minionActions.ts'
import {
    ActionProperty,
    CombatRange,
    CombatStep,
    CombatStrike,
    Invalid,
    LibraryCardUsage,
    NO_BLOCK,
    VALID,
    Validity,
} from '@/shared/types/state.ts'
import { findPlay, playsOfKind } from '@/shared/cardImpl/catalog/requirements.ts'
import { getCardDef } from '@/shared/cardImpl/catalog/index.ts'
import {
    CardDef,
    Condition,
    GainBloodEffect,
    MasterAbility,
    ModifierEffect,
} from '@/shared/cardImpl/catalog/types.ts'

/**
 * The generic interpreter: classes that do what the data of a play says. They have the same
 * shape as the hand-written implementations ( base.ts ), so the engine does not know the
 * difference. A card that the data cannot express stays a hand-written class.
 */

const COMBAT_STEPS = {
    beforeRange: CombatStep.BeforeRange,
    beforeStrikes: CombatStep.BeforeStrikes,
    endOfRound: CombatStep.EndOfRound,
}

function conditionHolds(
    implementation: CardImplementation,
    condition: Condition,
    def: CardDef,
): boolean {
    const gameState = implementation.player.gameState
    const action = gameState.action?.minionAction
    switch (condition.type) {
        case 'during':
            return !!action && isBleed(action)
        case 'actionTargets':
            return !!action && action.target == implementation.player
        case 'afterBlocksDeclined':
            return getBlockingDecision(gameState, implementation.player)?.block === NO_BLOCK
        case 'combatRound':
            return gameState.combat?.round == condition.round
        case 'reactorIs':
            return implementation.minion.isVampire()
        case 'targetPoolAtMost':
            return action?.target instanceof Player && action.target.pool <= condition.amount
        case 'yourBlockStands': {
            const blocker = getBlockingMinion(gameState)
            return (
                blocker?.controller == implementation.player &&
                (!condition.sect ||
                    (blocker.isVampire() && blocker.vampireAttrs.sect == condition.sect))
            )
        }
        case 'usableWhileLocked':
            return true
        case 'minionLocked':
            return implementation.minion.isLocked && !isAwake(gameState, implementation.minion)
        case 'oncePerUnlock':
            return !gameState.playedSinceUnlock[implementation.minion.oid]?.includes(def.id)
        case 'combatStep':
            return gameState.combat?.step == COMBAT_STEPS[condition.step]
        case 'closeRange':
            return gameState.combat?.range == CombatRange.Close
        case 'oncePerRound':
            return !gameState.combat?.playedThisRound[implementation.minion.oid]?.includes(def.id)
        case 'opposingIsVampire': {
            const combat = gameState.combat
            const combatant = combat && getCombatant(combat, implementation.minion)
            return (
                !!combat &&
                !!combatant &&
                getOpposingCombatant(combat, combatant).minion.isVampire()
            )
        }
    }
}

function checkConditions(
    implementation: CardImplementation,
    conditions: Condition[] | undefined,
    def: CardDef,
): Validity {
    const failed = conditions?.find(condition => !conditionHolds(implementation, condition, def))
    return failed ? Invalid(`Condition not met: ${failed.type}`) : VALID
}

class InterpretedAction extends ActionCardImplementation {
    constructor(
        private readonly def: CardDef,
        minion: Minion,
        usage: LibraryCardUsage,
    ) {
        super(minion, usage)
    }

    private get play() {
        return findPlay(this.def, 'action', this.usage)
    }

    getStealth() {
        return (this.play?.effects ?? []).reduce(
            (sum, effect) => (effect.type == 'stealth' ? sum + effect.amount : sum),
            0,
        )
    }

    get isBleed() {
        return !!this.play?.effects.some(effect => effect.type == 'bleedAction')
    }

    get blockedStrengthBonus() {
        return (this.play?.effects ?? []).reduce(
            (sum, effect) => (effect.type == 'strengthIfBlocked' ? sum + effect.amount : sum),
            0,
        )
    }

    getTargets(): LibraryCardUsage['target'][] {
        switch (this.play?.target) {
            case 'player':
                return this.player.gameState.competingPlayers.filter(other => other != this.player)
            case 'youngerUncontrolledVampire':
                return this.player.vampiresInUncontrolled
            case 'minionOfOtherMethuselah':
                return this.player.gameState.competingPlayers
                    .filter(other => other != this.player)
                    .flatMap(other => other.minionsReady)
            default:
                return []
        }
    }

    canDeclare(): Validity {
        const play = this.play
        if (!play) {
            return Invalid('The way the card is used matches none of its plays')
        }
        const target = this.usage.target
        if (!target) {
            return Invalid('Usage has no target')
        }
        switch (play.target) {
            case 'player':
                return target instanceof Player ? VALID : Invalid('Target must be a player')
            case 'youngerUncontrolledVampire':
                if (!(target instanceof Card && target.isVampire())) {
                    return Invalid('Target must be a vampire')
                }
                if (!this.player.vampiresInUncontrolled.includes(target)) {
                    return Invalid('Target must be one of your uncontrolled vampires')
                }
                if (this.minion.minionAttrs.capacity <= target.minionAttrs.capacity) {
                    return Invalid('Target must be younger')
                }
                return VALID
            case 'minionOfOtherMethuselah':
                return target instanceof Card && target.isMinion() ?
                        canEnterCombatWith(this.minion, target)
                    :   Invalid('Target must be a minion')
        }
    }

    declare() {
        for (const effect of this.play?.effects ?? []) {
            if (effect.type == 'bleed') {
                gameMutations.ACTION_changeProperty.act(this.player, {
                    propertyName: ActionProperty.Bleed,
                    amount: effect.amount,
                })
            }
        }
    }

    resolve() {
        const target = this.usage.target
        for (const effect of this.play?.effects ?? []) {
            if (effect.type == 'gainBlood' && target instanceof CryptCard) {
                gameMutations.changeBlood.act(this.player, {
                    card: target,
                    amount: effect.amount,
                })
            }
            if (effect.type == 'stealPool' && target instanceof Player) {
                const stolen = Math.min(effect.amount, target.pool)
                gameMutations.changePool.act(this.player, { player: target, amount: -stolen })
                gameMutations.changePool.act(this.player, { player: this.player, amount: stolen })
            }
            if (effect.type == 'enterCombat' && target instanceof Card && target.isMinion()) {
                startCombat(this.player.gameState, this.minion, target)
            }
        }
    }
}

function hasLimitedBleed(effects: ModifierEffect[]): boolean {
    return effects.some(effect => effect.type == 'bleed' && effect.limited)
}

class InterpretedModifier extends ActionModifierCardImplementation {
    constructor(
        private readonly def: CardDef,
        minion: Minion,
        usage: LibraryCardUsage,
    ) {
        super(minion, usage)
    }

    private get play() {
        return findPlay(this.def, 'modifier', this.usage)
    }

    canPlay(): Validity {
        const play = this.play
        if (!play) {
            return Invalid('The way the card is used matches none of its plays')
        }
        const actingMinion = this.player.gameState.action?.minionAction.actingMinion
        if (play.by == 'otherThanActing') {
            if (!this.minion.isVampire() || this.minion == actingMinion) {
                return Invalid('Must be played by another vampire than the acting minion')
            }
        } else if (this.minion != actingMinion) {
            return Invalid('Must be played by the acting minion')
        }
        if (hasLimitedBleed(play.effects) && this.limitedBleedPlayed()) {
            return Invalid('Only one limited bleed bonus per action')
        }
        return checkConditions(this, play.when, this.def)
    }

    // The modifiers played in the action are still in the ready region until the end of it.
    // The level they were played at is not recorded: a card counts as soon as it has a limited
    // bleed at any level ( true of every limited bleed card so far ).
    private limitedBleedPlayed(): boolean {
        return this.player.ready.cards.some(card => {
            const def = card instanceof LibraryCard ? getCardDef(card) : undefined
            return (
                !!def &&
                card instanceof LibraryCard &&
                card.hasType(LibraryCardType.ActionModifier) &&
                playsOfKind(def, 'modifier').some(play => hasLimitedBleed(play.effects))
            )
        })
    }

    apply() {
        for (const effect of this.play?.effects ?? []) {
            if (effect.type == 'lockFailedBlockers') {
                gameMutations.ACTION_lockFailedBlockers.act(this.player, {})
                continue
            }
            const propertyName = {
                stealth: ActionProperty.Stealth,
                bleed: ActionProperty.Bleed,
                intercept: ActionProperty.Intercept,
            }[effect.type]
            gameMutations.ACTION_changeProperty.act(this.player, {
                propertyName,
                amount: effect.amount == 'X' ? (this.usage.x ?? 0) : effect.amount,
            })
        }
    }
}

class InterpretedCombat extends CombatCardImplementation {
    constructor(
        private readonly def: CardDef,
        minion: Minion,
        usage: LibraryCardUsage,
    ) {
        super(minion, usage)
    }

    getEffects(): CombatCardEffect[] {
        const play = findPlay(this.def, 'combat', this.usage)
        if (!play || !checkConditions(this, play.when, this.def).isValid) {
            return []
        }
        const combat = this.combat
        const combatant = combat && getCombatant(combat, this.minion)
        if (!combat || !combatant) {
            return []
        }
        const opposing = getOpposingCombatant(combat, combatant)
        const hasStrike = play.effects.some(effect => effect.type == 'strike')
        // The additional strike of a strike card comes with it, unless a limited one was gained
        const additional = play.effects.find(effect => effect.type == 'additionalStrike')
        const additionalWithStrike =
            additional && !(additional.limited && combatant.limitedAdditionalGained) ?
                { limited: additional.limited }
            :   undefined

        const strikes = play.effects.flatMap((effect): CombatStrike[] => {
            if (effect.type != 'strike') {
                return []
            }
            return [
                effect.preset == 'dodge' ?
                    createDodgeStrike()
                :   {
                        ...createHandStrike(combatant),
                        name: `Hand strike +${effect.extraDamage}`,
                        damage: combatant.strength + effect.extraDamage,
                        undodgeable: !!effect.undodgeable,
                    },
            ]
        })
        // The maneuver of a card that is also a strike card chooses the strike as well
        const effects = play.effects.flatMap((effect): CombatCardEffect[] => {
            switch (effect.type) {
                case 'maneuver':
                    return effect.toCloseOnly && combat.range != CombatRange.Long ?
                            []
                        :   [{ type: 'maneuver', strike: strikes[0] }]
                case 'strike':
                    return []
                case 'setStrength':
                    return effect.amount > combatant.strength ?
                            [{ type: 'setStrength', amount: effect.amount }]
                        :   []
                case 'additionalStrike':
                    return hasStrike || (effect.limited && combatant.limitedAdditionalGained) ?
                            []
                        :   [{ type: 'additionalStrike', limited: effect.limited }]
                case 'grapple':
                    return [
                        {
                            type: 'grapple',
                            press: effect.press,
                            closeNextRound: effect.closeNextRound,
                        },
                    ]
                case 'gainBloodFromDamage':
                    return opposing.bloodLost > 0 ?
                            [{ type: 'gainBlood', amount: opposing.bloodLost }]
                        :   []
            }
        })
        return [
            ...strikes.map(
                (strike): CombatCardEffect => ({
                    type: 'strike',
                    strike,
                    additional: additionalWithStrike,
                }),
            ),
            ...effects,
        ]
    }
}

class InterpretedReaction extends ReactionCardImplementation {
    constructor(
        private readonly def: CardDef,
        minion: Minion,
        usage: LibraryCardUsage,
    ) {
        super(minion, usage)
    }

    private get play() {
        return findPlay(this.def, 'reaction', this.usage)
    }

    get usableWhileLocked() {
        return !!this.play?.when?.some(
            condition => condition.type == 'minionLocked' || condition.type == 'usableWhileLocked',
        )
    }

    get oncePerUnlock() {
        return !!this.play?.when?.some(condition => condition.type == 'oncePerUnlock')
    }

    getEffects(): ReactionCardEffect[] {
        const play = this.play
        const action = this.player.gameState.action?.minionAction
        if (!play || !action || !checkConditions(this, play.when, this.def).isValid) {
            return []
        }

        const actingPlayer = action.actingMinion.controller
        const gameState = this.player.gameState
        return play.effects.flatMap((effect): ReactionCardEffect[] => {
            if (!checkConditions(this, effect.when, this.def).isValid) {
                return []
            }
            switch (effect.type) {
                case 'unlockAndBlock': {
                    // Only while a block is still possible
                    if (getBlockingMinion(gameState)) {
                        return []
                    }
                    const attempted = gameState.action?.blockAttempters ?? []
                    return this.player.vampiresReady
                        .filter(
                            vampire =>
                                vampire.isLocked &&
                                vampire.vampireAttrs.sect == effect.sect &&
                                !attempted.includes(vampire),
                        )
                        .map(target => ({
                            type: 'unlockBlock',
                            target,
                            intercept: effect.intercept,
                        }))
                }
                case 'intercept':
                    return [{ type: 'intercept', amount: effect.amount }]
                case 'wake':
                    return [{ type: 'wake' }]
                case 'changeTarget':
                    return this.player.gameState.competingPlayers
                        .filter(other => other != this.player && other != actingPlayer)
                        .map(target => ({
                            type: 'changeTarget',
                            target,
                            lockMinion: effect.lockReactor,
                        }))
            }
        })
    }
}

class InterpretedMaster extends MasterCardImplementation {
    constructor(
        private readonly def: CardDef,
        player: Player,
        card: LibraryCard,
    ) {
        super(player, card)
    }

    private get play() {
        return playsOfKind(this.def, 'master')[0]
    }

    get staysInPlay() {
        return (this.play?.staysInPlay ?? 'discard') != 'discard'
    }

    get handSizeBonus() {
        return (this.play?.effects ?? []).reduce((sum, effect) => sum + effect.amount, 0)
    }

    private get unlockAbilitySect() {
        return this.unlockAbility?.sect
    }

    private get unlockAbility() {
        return this.play?.abilities?.find(
            (ability): ability is Extract<MasterAbility, { activate: 'unlock' }> =>
                ability.activate == 'unlock',
        )
    }

    private get lockAbility() {
        return this.play?.abilities?.find(
            (ability): ability is Extract<MasterAbility, { activate: 'lock' }> =>
                ability.activate == 'lock',
        )
    }

    private get transferAbilities() {
        return (this.play?.abilities ?? []).flatMap((ability, index) =>
            ability.activate == 'transfer' ? [{ ability, index }] : [],
        )
    }

    getTransferOptions(): { ability: number; removed?: CryptCard }[] {
        const transfers = this.player.gameState.turnResources.transfers
        return this.transferAbilities.flatMap(({ ability, index }) => {
            if (transfers < ability.transfers) {
                return []
            }
            if (!ability.effects.some(effect => effect.type == 'drawCryptRemoveUncontrolled')) {
                return [{ ability: index }]
            }
            if (this.player.crypt.isEmpty) {
                return []
            }
            // One of the cards already there is removed; with none, the card drawn is
            const uncontrolled = this.player.uncontrolled.cards.filter(
                (card): card is CryptCard => card instanceof CryptCard,
            )
            return uncontrolled.length > 0 ?
                    uncontrolled.map(removed => ({ ability: index, removed }))
                :   [{ ability: index }]
        })
    }

    applyTransferEffect(abilityIndex: number, removed?: CryptCard): Validity {
        const found = this.transferAbilities.find(({ index }) => index == abilityIndex)
        const allowed = this.getTransferOptions().some(
            option => option.ability == abilityIndex && option.removed == removed,
        )
        if (!found || !allowed) {
            return Invalid('The ability cannot be used')
        }
        const { player } = this
        const spent = gameMutations.spendTransfers.act(player, {
            player,
            amount: found.ability.transfers,
        })
        if (!spent.isValid) {
            return spent
        }
        let validity: Validity = VALID
        for (const effect of found.ability.effects) {
            switch (effect.type) {
                case 'drawCryptRemoveUncontrolled': {
                    const drawn = player.crypt.firstCard
                    if (removed) {
                        validity = gameMutations.drawCrypt.act(player, { player })
                    }
                    // The card drawn and removed right away never has to enter the uncontrolled region
                    const gone = removed ?? drawn
                    validity =
                        validity.isValid ?
                            gameMutations.moveCardToRegion.act(player, {
                                card: gone,
                                fromCardRegion: gone.region,
                                toCardRegion: player.removed,
                                x: 0,
                                y: 0,
                            })
                        :   validity
                    break
                }
                case 'burnSelf':
                    validity = gameMutations.moveCardToRegion.act(player, {
                        card: this.card,
                        fromCardRegion: this.card.region,
                        toCardRegion: player.ashHeap,
                        x: 0,
                        y: 0,
                    })
                    break
                case 'gainPool':
                    validity = gameMutations.changePool.act(player, {
                        player,
                        amount: effect.amount,
                    })
                    break
            }
            if (!validity.isValid) {
                return validity
            }
        }
        return validity
    }

    hasLockAbility(): boolean {
        return !!this.lockAbility && !this.card.isLocked
    }

    applyLockEffect(discarded: LibraryCard): Validity {
        if (!this.lockAbility || !this.hasLockAbility()) {
            return Invalid('The card cannot be locked')
        }
        if (!discarded.isIn.hand) {
            return Invalid('The discarded card must come from the hand')
        }
        const locked = gameMutations.setLock.act(this.player, { card: this.card, newValue: true })
        if (!locked.isValid) {
            return locked
        }
        return gameMutations.moveCardToRegion.act(this.player, {
            card: discarded,
            fromCardRegion: discarded.region,
            toCardRegion: discarded.owner.ashHeap,
            x: 0,
            y: 0,
        })
    }

    // A vampire never goes over its capacity
    private readyVampiresBelowCapacity(sect?: string): Vampire[] {
        return this.player.vampiresReady.filter(
            vampire =>
                vampire.blood < vampire.minionAttrs.capacity &&
                (!sect || vampire.vampireAttrs.sect == sect),
        )
    }

    private gainBlood(effects: GainBloodEffect[], vampire: Vampire): Validity {
        let validity: Validity = VALID
        for (const effect of effects) {
            validity = gameMutations.changeBlood.act(this.player, {
                card: vampire,
                amount: effect.amount,
            })
        }
        return validity
    }

    getPlayTargets(): Vampire[] | null {
        return this.play?.onPlay ? this.readyVampiresBelowCapacity() : null
    }

    applyPlayEffect(vampire: Vampire): Validity {
        const onPlay = this.play?.onPlay
        if (!onPlay || !this.readyVampiresBelowCapacity().includes(vampire)) {
            return Invalid('The vampire cannot gain blood')
        }
        return this.gainBlood(onPlay.effects, vampire)
    }

    getUnlockEffectTargets(): Vampire[] {
        return this.unlockAbility ? this.readyVampiresBelowCapacity(this.unlockAbilitySect) : []
    }

    applyUnlockEffect(vampire: Vampire): Validity {
        const ability = this.unlockAbility
        if (!ability || !this.getUnlockEffectTargets().includes(vampire)) {
            return Invalid('The vampire cannot gain blood')
        }
        return this.gainBlood(ability.effects, vampire)
    }
}

// The constructors the registries hold: the data of the card is captured in a subclass

export function actionImplementation(
    def: CardDef,
): CardImplementationConstructor<ActionCardImplementation> {
    return class extends InterpretedAction {
        constructor(minion: Minion, usage: LibraryCardUsage) {
            super(def, minion, usage)
        }
    }
}

export function modifierImplementation(
    def: CardDef,
): CardImplementationConstructor<ActionModifierCardImplementation> {
    return class extends InterpretedModifier {
        constructor(minion: Minion, usage: LibraryCardUsage) {
            super(def, minion, usage)
        }
    }
}

export function combatImplementation(
    def: CardDef,
): CardImplementationConstructor<CombatCardImplementation> {
    return class extends InterpretedCombat {
        constructor(minion: Minion, usage: LibraryCardUsage) {
            super(def, minion, usage)
        }
    }
}

export function reactionImplementation(
    def: CardDef,
): CardImplementationConstructor<ReactionCardImplementation> {
    return class extends InterpretedReaction {
        constructor(minion: Minion, usage: LibraryCardUsage) {
            super(def, minion, usage)
        }
    }
}

export function masterImplementation(def: CardDef): MasterCardImplementationConstructor {
    return class extends InterpretedMaster {
        constructor(player: Player, card: LibraryCard) {
            super(def, player, card)
        }
    }
}

export function cryptImplementation(def: CardDef): CryptCardImplementation {
    const {
        bleed,
        strength,
        handSize,
        canEnterCombat,
        undirectedStealth,
        mustBleedWhileMinionLocked,
    } = def.crypt ?? {}
    return {
        // Set from the default, not added to the current value: harmless if called twice
        adapt:
            bleed || strength ?
                (card: CryptCard) => {
                    if (card.minionAttrs != UNKNOWN_MINION_ATTRS) {
                        card.minionAttrs.bleed = DEFAULT_CARD_ATTRS.Bleed + (bleed ?? 0)
                        card.minionAttrs.strength = DEFAULT_CARD_ATTRS.Strength + (strength ?? 0)
                    }
                }
            :   undefined,
        handSizeBonus: handSize,
        canEnterCombat,
        undirectedStealth,
        mustBleedWhileMinionLocked,
    }
}
