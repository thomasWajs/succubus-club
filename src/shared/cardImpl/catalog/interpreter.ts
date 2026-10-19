import {
    ActionCardImplementation,
    ActionModifierCardImplementation,
    CardImplementation,
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
import { Card, CryptCard, LibraryCard, Minion, Vampire } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import {
    canAddIntercept,
    canAddStealth,
    getBlockingDecision,
    getBlockingMinion,
    isAwake,
} from '@/shared/state/actionState.ts'
import { getCombatant, getOpposingCombatant, startCombat } from '@/shared/state/combatState.ts'
import { resolveCost } from '@/shared/state/cardCosts.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { getAutoPlayPosition, getPlayRegion } from '@/shared/state/cardPlacement.ts'
import { canEnterCombatWith, isBleed } from '@/shared/state/minionActions.ts'
import {
    ActionProperty,
    Invalid,
    LibraryCardUsage,
    NO_BLOCK,
    VALID,
    Validity,
} from '@/shared/types/state.ts'
import {
    CombatCardEffect,
    CombatCondition,
    combatConditionHolds,
    CombatPlayContext,
    combatPlayEffects,
} from '@/shared/cardImpl/catalog/combatPlay.ts'
import { findPlay, playsOfKind } from '@/shared/cardImpl/catalog/requirements.ts'
import { getCardDef } from '@/shared/cardImpl/catalog/index.ts'
import {
    getAttachCandidates,
    getExtraPlayCost,
    hasAttachedCopy,
    matchesMinionFilter,
} from '@/shared/cardImpl/catalog/attached.ts'
import {
    ActionPlay,
    CardDef,
    Condition,
    GainBloodEffect,
    MasterAbility,
    MasterOnPlay,
    ModifierEffect,
} from '@/shared/cardImpl/catalog/types.ts'

/**
 * The generic interpreter: classes that do what the data of a play says. They have the same
 * shape as the hand-written implementations ( base.ts ), so the engine does not know the
 * difference. A card that the data cannot express stays a hand-written class.
 */

// The combat as the conditions of a play see it, for the minion that plays it ( null: no combat )
function combatContextOf(
    implementation: CardImplementation,
    gameState: GameState,
): CombatPlayContext | null {
    const combat = gameState.combat
    if (!combat) {
        return null
    }
    const { minion } = implementation
    const combatant = getCombatant(combat, minion)
    const opposing = combatant && getOpposingCombatant(combat, combatant)
    return {
        round: combat.round,
        step: combat.step,
        range: combat.range,
        playedThisRound: combat.playedThisRound[minion.oid] ?? [],
        playedThisCombat: combat.playedThisCombat[minion.oid] ?? [],
        strength: combatant?.strength ?? 0,
        limitedAdditionalGained: !!combatant?.limitedAdditionalGained,
        opposingBloodLost: opposing?.bloodLost ?? 0,
        opposingIsVampire: !!opposing?.minion.isVampire(),
    }
}

function conditionHolds(
    implementation: CardImplementation,
    condition: Condition,
    def: CardDef,
): boolean {
    const gameState = implementation.player.gameState
    // Once the block is resolved, what is about the action ( target, block attempts ) is over
    const blockResolved = !!gameState.action?.blockResolved
    const action = blockResolved ? undefined : gameState.action?.minionAction
    const combatCondition = (narrowed: CombatCondition) =>
        combatConditionHolds(narrowed, def.id, combatContextOf(implementation, gameState))
    switch (condition.type) {
        case 'during':
            return !!action && isBleed(action)
        case 'actionTargets':
            return !!action && action.target == implementation.player
        case 'actorControlledBy':
            return (
                !!action &&
                !!implementation.player.predator &&
                action.actingMinion.controller == implementation.player.predator
            )
        case 'afterBlocksDeclined':
            return (
                !blockResolved &&
                getBlockingDecision(gameState, implementation.player)?.block === NO_BLOCK
            )
        case 'afterYourBlock':
            return !gameState.combat && gameState.action?.blockResolved == implementation.minion
        case 'combatRound':
            return combatCondition(condition)
        case 'reactorIs':
            return implementation.minion.isVampire()
        case 'reactorTitled':
            return (
                implementation.minion.isVampire() &&
                !!implementation.minion.vampireAttrs.title == condition.titled
            )
        case 'targetPoolAtMost':
            return action?.target instanceof Player && action.target.pool <= condition.amount
        case 'yourBlockStands': {
            const blocker = blockResolved ? null : getBlockingMinion(gameState)
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
        case 'closeRange':
        case 'oncePerRound':
        case 'oncePerCombat':
        case 'opposingIsVampire':
            return combatCondition(condition)
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

    get attachesToMinion() {
        return this.play?.staysInPlay == 'onMinion'
    }

    get recruit() {
        return this.play?.recruit
    }

    get attachedLife() {
        return (this.play?.attached ?? []).reduce(
            (sum, effect) => (effect.type == 'life' ? sum + effect.amount : sum),
            0,
        )
    }

    // The minions the player can choose to put the card on, when it does not go on the acting one
    private get attachFilter() {
        const attachTo = this.play?.attachTo
        return typeof attachTo == 'object' ? attachTo : undefined
    }

    private get attachCandidates(): Minion[] {
        const filter = this.attachFilter
        const onePerMinion = this.play?.onePerMinion
        return filter ?
                getAttachCandidates(this.player, filter).filter(
                    candidate => !(onePerMinion && hasAttachedCopy(candidate, this.def.id)),
                )
            :   []
    }

    get attachHost(): Minion {
        const target = this.usage.target
        return this.attachFilter && target instanceof Card && target.isMinion() ?
                target
            :   this.minion
    }

    getTargets(): LibraryCardUsage['target'][] {
        if (this.attachFilter) {
            return this.attachCandidates
        }
        switch (this.play?.target) {
            case 'none':
                return [undefined]
            case 'player':
                return this.player.gameState.competingPlayers.filter(other => other != this.player)
            case 'youngerUncontrolledVampire':
                return this.player.vampiresInUncontrolled
            case 'minionOfOtherMethuselah':
                return this.player.gameState.competingPlayers
                    .filter(other => other != this.player)
                    .flatMap(other => other.minionsReady)
            case 'vampireOfOtherMethuselah':
                return this.player.gameState.competingPlayers
                    .filter(other => other != this.player)
                    .flatMap(other => other.vampiresReady)
            case 'retainerOfOtherMethuselah':
            case 'allyOfOtherMethuselah':
                return this.player.gameState.competingPlayers
                    .flatMap(other => other.ready.cards)
                    .filter(card => this.canDeclareOn(card).isValid)
            default:
                return []
        }
    }

    private canDeclareOn(target: Card): Validity {
        switch (this.play?.target) {
            case 'retainerOfOtherMethuselah':
                return this.canSteal(target, 'retainer')
            case 'allyOfOtherMethuselah':
                return this.canSteal(target, 'ally')
            default:
                return Invalid('The action has no card to steal')
        }
    }

    private canSteal(target: Card, kind: 'retainer' | 'ally'): Validity {
        if (!target.isIn.ready) {
            return Invalid('Target must be ready')
        }
        if (target.controller == this.player || target.controller.isOusted) {
            return Invalid('Target must be controlled by another Methuselah')
        }
        return target instanceof LibraryCard && target.isType[kind] ?
                VALID
            :   Invalid(`Target must be a${kind == 'ally' ? 'n' : ''} ${kind}`)
    }

    canDeclare(): Validity {
        const play = this.play
        if (!play) {
            return Invalid('The way the card is used matches none of its plays')
        }
        const target = this.usage.target
        if (play.target == 'none') {
            return this.canDeclareOnMinion(play, target)
        }
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
            case 'vampireOfOtherMethuselah':
                return target instanceof Card && target.isVampire() ?
                        canEnterCombatWith(this.minion, target)
                    :   Invalid('Target must be a vampire')
            case 'retainerOfOtherMethuselah':
            case 'allyOfOtherMethuselah':
                return target instanceof Card ?
                        this.canDeclareOn(target)
                    :   Invalid('Target must be a card')
        }
    }

    // An action with no target: it has none, or the minion the card is put on is its target
    private canDeclareOnMinion(play: ActionPlay, target: LibraryCardUsage['target']): Validity {
        const filter = this.attachFilter
        if (!filter && target) {
            return Invalid('The action has no target')
        }
        if (filter) {
            if (!(target instanceof Card && target.isMinion())) {
                return Invalid('Target must be a minion')
            }
            if (!getAttachCandidates(this.player, filter).includes(target)) {
                return Invalid('The card cannot be put on this minion')
            }
        }
        return play.onePerMinion && hasAttachedCopy(this.attachHost, this.def.id) ?
                Invalid('The minion already has this card')
            :   VALID
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
            if (effect.type == 'lockTarget' && target instanceof Card && target.isMinion()) {
                target.lock()
            }
            if (effect.type == 'enterCombat' && target instanceof Card && target.isMinion()) {
                const [acting, defending] =
                    effect.targetActs ? [target, this.minion] : [this.minion, target]
                startCombat(this.player.gameState, acting, defending)
            }
            if (effect.type == 'steal' && target instanceof Card) {
                this.steal(target)
            }
        }
    }

    // The card comes to the play area of the acting Methuselah. An ally is a minion of its own, on some free
    // space. A retainer is first moved next to the acting minion, and a bot's is attached to it.
    private steal(target: Card) {
        gameMutations.takeControl.act(this.player, { card: target, controller: this.player })
        const isRetainer = this.play?.target == 'retainerOfOtherMethuselah'
        const toCardRegion = getPlayRegion(this.player)
        if (target.region != toCardRegion) {
            const { x, y } = getAutoPlayPosition(
                this.player,
                target,
                toCardRegion,
                isRetainer ? this.minion : undefined,
            )
            gameMutations.moveCardToRegion.act(this.player, {
                card: target,
                fromCardRegion: target.region,
                toCardRegion,
                x,
                y,
            })
        }
        if (isRetainer && this.player.isBot) {
            botMutations.attachCard.act(this.player, { card: target, minion: this.minion })
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
        // A card that gives stealth is subject to the rule even when it gives something else too
        if (play.effects.some(effect => effect.type == 'stealth')) {
            const needed = canAddStealth(this.player.gameState)
            if (!needed.isValid) {
                return needed
            }
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
                card.isType.actionModifier &&
                playsOfKind(def, 'modifier').some(play => hasLimitedBleed(play.effects))
            )
        })
    }

    apply() {
        for (const effect of this.play?.effects ?? []) {
            if (effect.type == 'armTrigger') {
                botMutations.ACTION_armTrigger.act(this.player, { trigger: effect.trigger })
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
        const context = combatContextOf(this, this.player.gameState)
        if (!combat || !getCombatant(combat, this.minion) || !context) {
            return []
        }
        return combatPlayEffects(play, context)
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
        const gameState = this.player.gameState
        const action = gameState.action?.minionAction
        // Once the block is resolved, only the plays made for the post block window are possible
        // ( and they are possible only then )
        const madeForBlockResolved = !!play?.when?.some(
            condition => condition.type == 'afterYourBlock',
        )
        if (
            !play ||
            !action ||
            !!gameState.action?.blockResolved != madeForBlockResolved ||
            !checkConditions(this, play.when, this.def).isValid
        ) {
            return []
        }

        const actingPlayer = action.actingMinion.controller
        const blockManeuver = play.effects.some(
            effect =>
                effect.type == 'blockManeuver' &&
                checkConditions(this, effect.when, this.def).isValid,
        )
        const effects = play.effects.flatMap((effect): ReactionCardEffect[] => {
            if (!checkConditions(this, effect.when, this.def).isValid) {
                return []
            }
            switch (effect.type) {
                // Not an alternative: it comes with the other effects, see below
                case 'blockManeuver':
                    return []
                case 'unlock':
                    return [{ type: 'unlock' }]
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
                    return canAddIntercept(gameState, this.minion).isValid ?
                            [{ type: 'intercept', amount: effect.amount }]
                        :   []
                case 'wake':
                    return [
                        effect.allyMissesUnlock ?
                            { type: 'wake', allyMissesUnlock: true }
                        :   { type: 'wake' },
                    ]
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
        return blockManeuver ? effects.map(effect => ({ ...effect, blockManeuver })) : effects
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

    private get lockForActionAbility() {
        return this.play?.abilities?.find(
            (ability): ability is Extract<MasterAbility, { activate: 'lockForAction' }> =>
                ability.activate == 'lockForAction',
        )
    }

    private get lockForReactionAbility() {
        return this.play?.abilities?.find(
            (ability): ability is Extract<MasterAbility, { activate: 'lockForReaction' }> =>
                ability.activate == 'lockForReaction',
        )
    }

    private get transferAbilities() {
        return (this.play?.abilities ?? []).flatMap((ability, index) =>
            ability.activate == 'transfer' ? [{ ability, index }] : [],
        )
    }

    getTransferOptions(): number[] {
        const { transfers } = this.player.gameState.turnResources
        return this.transferAbilities.flatMap(({ ability, index }) => {
            if (transfers < ability.transfers) {
                return []
            }
            const draws = ability.effects.some(
                effect => effect.type == 'drawCryptRemoveUncontrolled',
            )
            return draws && this.player.crypt.isEmpty ? [] : [index]
        })
    }

    applyTransferEffect(abilityIndex: number): Validity {
        const found = this.transferAbilities.find(({ index }) => index == abilityIndex)
        if (!found || !this.getTransferOptions().includes(abilityIndex)) {
            return Invalid('The ability cannot be used')
        }
        const { player } = this
        const spent = botMutations.spendTransfers.act(player, {
            player,
            amount: found.ability.transfers,
        })
        if (!spent.isValid) {
            return spent
        }
        let validity: Validity = VALID
        for (const effect of found.ability.effects) {
            switch (effect.type) {
                case 'drawCryptRemoveUncontrolled':
                    validity = gameMutations.drawCrypt.act(player, { player })
                    if (validity.isValid) {
                        validity = botMutations.setPendingRemoval.act(player, {
                            player,
                            card: this.card,
                            open: true,
                        })
                    }
                    break
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

    // The card drawn is one of the uncontrolled vampires, and may be the one removed
    getRemovalOptions(): CryptCard[] {
        if (this.player.gameState.pendingRemoval?.card != this.card) {
            return []
        }
        return this.player.uncontrolled.cards.filter(
            (card): card is CryptCard => card instanceof CryptCard,
        )
    }

    applyRemoval(removed: CryptCard): Validity {
        if (!this.getRemovalOptions().includes(removed)) {
            return Invalid('The vampire cannot be removed')
        }
        const { player } = this
        const moved = gameMutations.moveCardToRegion.act(player, {
            card: removed,
            fromCardRegion: removed.region,
            toCardRegion: player.removed,
            x: 0,
            y: 0,
        })
        if (!moved.isValid) {
            return moved
        }
        return botMutations.setPendingRemoval.act(player, { player, card: this.card, open: false })
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

    canLockForAction(actingMinion: Minion): boolean {
        const ability = this.lockForActionAbility
        return (
            !!ability &&
            !this.card.isLocked &&
            actingMinion.controller == this.player &&
            matchesMinionFilter(actingMinion, ability.minion) &&
            canAddStealth(this.player.gameState).isValid
        )
    }

    applyLockForAction(actingMinion: Minion): Validity {
        const ability = this.lockForActionAbility
        if (!ability || !this.canLockForAction(actingMinion)) {
            return Invalid('The card cannot be locked for this action')
        }
        const locked = gameMutations.setLock.act(this.player, { card: this.card, newValue: true })
        let validity: Validity = locked
        for (const effect of ability.effects) {
            if (!validity.isValid) {
                break
            }
            validity = gameMutations.ACTION_changeProperty.act(this.player, {
                propertyName: ActionProperty.Stealth,
                amount: effect.amount,
            })
        }
        return validity
    }

    canLockForReaction(blocker: Minion): boolean {
        const ability = this.lockForReactionAbility
        return (
            !!ability &&
            !this.card.isLocked &&
            blocker.controller == this.player &&
            matchesMinionFilter(blocker, ability.minion) &&
            canAddIntercept(this.player.gameState, blocker).isValid
        )
    }

    applyLockForReaction(blocker: Minion): Validity {
        const ability = this.lockForReactionAbility
        if (!ability || !this.canLockForReaction(blocker)) {
            return Invalid('The card cannot be locked for this block attempt')
        }
        let validity: Validity = gameMutations.setLock.act(this.player, {
            card: this.card,
            newValue: true,
        })
        for (const effect of ability.effects) {
            if (!validity.isValid) {
                break
            }
            validity = gameMutations.ACTION_changeProperty.act(this.player, {
                propertyName: ActionProperty.Intercept,
                amount: effect.amount,
            })
        }
        return validity
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

    // The vampires of the player that have blood to move, in torpor too
    private vampiresWithBlood(): Vampire[] {
        return [...this.player.vampiresReady, ...this.player.vampiresInTorpor].filter(
            vampire => vampire.blood > 0,
        )
    }

    // The minions the effect on play can be aimed at, before what the cards on them add to the cost
    private playCandidates(): Minion[] | null {
        const play = this.play
        if (play?.attachTo) {
            const { onPlay } = play
            return getAttachCandidates(this.player, play.attachTo).filter(
                candidate =>
                    !(play.onePerMinion && hasAttachedCopy(candidate, this.def.id)) &&
                    (!onPlay || this.onPlayFits(onPlay.target, candidate)),
            )
        }
        if (!play?.onPlay) {
            return null
        }
        return play.onPlay.target == 'vampireWithBlood' ?
                this.vampiresWithBlood()
            :   this.readyVampiresBelowCapacity()
    }

    private onPlayFits(target: MasterOnPlay['target'], minion: Minion): boolean {
        return target == 'vampireWithBlood' ?
                minion.blood > 0
            :   minion.isIn.ready && minion.blood < minion.minionAttrs.capacity
    }

    // The pool that comes on top of the cost of the card when it is played on the minion
    private extraCost(minion: Minion): number {
        return getExtraPlayCost(minion, this.def.id)
    }

    // The cost of the card is paid by the referee, the extra cost is paid with the effect on play: a
    // Methuselah that pays it with all it has must still be able to gain what the card gives
    getPlayTargets(): Minion[] | null {
        const left = this.player.pool - resolveCost(this.card.poolCost)
        return this.playCandidates()?.filter(candidate => this.extraCost(candidate) <= left) ?? null
    }

    // The amounts are what the vampire gives: one that holds less than the least amount of the card gives
    // what it has
    getPlayAmounts(minion: Minion): number[] | null {
        for (const effect of this.play?.onPlay?.effects ?? []) {
            if (effect.type == 'bloodToPool') {
                const least = Math.min(effect.min ?? 1, minion.blood)
                const most = Math.min(effect.max ?? minion.blood, minion.blood)
                return Array.from({ length: Math.max(0, most - least + 1) }, (_, i) => least + i)
            }
        }
        return null
    }

    // The extra cost is paid in the same change of the pool as what the card gives: a Methuselah is not
    // ousted in between
    applyPlayEffect(minion: Minion, amount?: number): Validity {
        const play = this.play
        if (!play || !this.playCandidates()?.includes(minion)) {
            return Invalid('The card cannot be played on this minion')
        }
        const extra = this.extraCost(minion)
        if (extra > this.player.pool) {
            return Invalid('The extra cost of the card cannot be paid')
        }
        if (play.onPlay && !minion.isVampire()) {
            return Invalid('The card has no effect on this minion')
        }
        let validity: Validity = VALID
        if (play.attachTo) {
            validity = botMutations.attachCard.act(this.player, { card: this.card, minion })
            if (!validity.isValid) {
                return validity
            }
        }
        let gained = 0
        for (const effect of play.onPlay?.effects ?? []) {
            switch (effect.type) {
                case 'gainBlood':
                    validity = gameMutations.changeBlood.act(this.player, {
                        card: minion,
                        amount: effect.amount,
                    })
                    break
                case 'bloodToPool': {
                    if (!amount || !this.getPlayAmounts(minion)?.includes(amount)) {
                        return Invalid('The amount of blood cannot be moved')
                    }
                    validity = gameMutations.changeBlood.act(this.player, {
                        card: minion,
                        amount: -amount,
                    })
                    gained += amount
                    break
                }
            }
            if (!validity.isValid) {
                return validity
            }
        }
        return gained == extra ? validity : (
                gameMutations.changePool.act(this.player, {
                    player: this.player,
                    amount: gained - extra,
                })
            )
    }

    // Once a turn, twice for a card that says so while a baron is ready
    private get unlockUses(): number {
        const extra =
            this.unlockAbility?.extraWithBaron &&
            this.player.vampiresReady.some(
                vampire => vampire.vampireAttrs.title.toLowerCase() == 'baron',
            )
        return extra ? 2 : 1
    }

    getUnlockEffectTargets(): Vampire[] {
        const { usedCards, groundVampires } = this.player.gameState.turnResources
        if (
            !this.unlockAbility ||
            usedCards.filter(oid => oid == this.card.oid).length >= this.unlockUses
        ) {
            return []
        }
        return this.readyVampiresBelowCapacity(this.unlockAbilitySect).filter(
            vampire => !(this.card.isHuntingGround && groundVampires.includes(vampire.oid)),
        )
    }

    applyUnlockEffect(vampire: Vampire): Validity {
        const ability = this.unlockAbility
        if (!ability || !this.getUnlockEffectTargets().includes(vampire)) {
            return Invalid('The vampire cannot gain blood')
        }
        const used = botMutations.markCardUsed.act(this.player, {
            player: this.player,
            card: this.card,
            maxUses: this.unlockUses,
            groundVampire: this.card.isHuntingGround ? vampire : undefined,
        })
        return used.isValid ? this.gainBlood(ability.effects, vampire) : used
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
        handSize,
        canEnterCombat,
        undirectedStealth,
        mustBleedWhileMinionLocked,
        discardForBleed,
    } = def.crypt ?? {}
    return {
        handSizeBonus: handSize,
        canEnterCombat,
        undirectedStealth,
        mustBleedWhileMinionLocked,
        discardForBleed,
    }
}
