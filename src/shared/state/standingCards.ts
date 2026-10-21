import { Card, LibraryCard, Minion, Vampire } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { getAttachedCards, getHost, isAttached } from '@/shared/state/attachments.ts'
import { getCardDef } from '@/shared/cardImpl/catalog/index.ts'
import { InPlayEffect } from '@/shared/cardImpl/catalog/types.ts'
import { getCryptImplementation } from '@/shared/cardImpl/index.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { GameState } from '@/shared/state/gameState.ts'

/**
 * The cards that stay in play on their own and act in the unlock phases ( Creeping Sabotage, Smiling Jack ), and the
 * minions' action to burn them. Bots only: a human applies these by hand.
 */

// What a card in play does while it stays, when the catalog says
export function getInPlayEffects(card: Card): InPlayEffect[] {
    const def = getCardDef(card)
    const play = def?.plays.find(
        candidate => candidate.kind == 'action' || candidate.kind == 'master',
    )
    return play && (play.kind == 'action' || play.kind == 'master') ? (play.whileInPlay ?? []) : []
}

// Can the minions of the other Methuselahs burn the card as an action
function isBurnableByAnyone(card: Card): boolean {
    const def = getCardDef(card)
    return !!def?.plays.some(
        play => (play.kind == 'action' || play.kind == 'master') && play.burnable,
    )
}

// Can the minion the card is on burn it as an action
function isBurnableByBearer(card: Card): boolean {
    for (const effect of getInPlayEffects(card)) {
        if (effect.type == 'bearerBurnsCard') {
            return true
        }
    }
    return false
}

// Can a minion burn the card as an action: any minion of the others ( Creeping Sabotage ), or the minion it is on
export function isBurnable(card: Card): boolean {
    return isBurnableByAnyone(card) || isBurnableByBearer(card)
}

// The stealth of the action that burns the card
export function getBurnStealth(card: Card): number {
    for (const effect of getInPlayEffects(card)) {
        if (effect.type == 'bearerBurnsCard') {
            return effect.stealth
        }
    }
    return 0
}

// A card of the ready region that is in play on its own: a master card, or an action card that stayed
function isStandingIn(gameState: GameState, card: Card): card is LibraryCard {
    return (
        card instanceof LibraryCard &&
        card.isIn.ready &&
        (!card.isType.action || gameState.standing.includes(card.oid))
    )
}

// The cards the player controls that stay in play on their own: in their ready region, or on a vampire of another
// Methuselah ( Fame )
export function getStandingCards(gameState: GameState, player: Player): LibraryCard[] {
    return player.controlledReadyCards.filter(
        (card): card is LibraryCard =>
            isStandingIn(gameState, card) &&
            card.controller == player &&
            getInPlayEffects(card).length > 0,
    )
}

// The cards a minion can burn as an action: the standing cards of the other Methuselahs that anyone can burn, and the
// cards on the minion that it can burn, played by another Methuselah
export function getBurnableCards(minion: Minion): LibraryCard[] {
    const { gameState } = minion
    const burnable: LibraryCard[] = []
    for (const other of gameState.competingPlayers) {
        if (other == minion.controller) {
            continue
        }
        for (const card of other.ready.cards) {
            if (isStandingIn(gameState, card) && isBurnableByAnyone(card) && !isAttached(card)) {
                burnable.push(card)
            }
        }
    }
    for (const card of getAttachedCards(minion)) {
        if (
            card instanceof LibraryCard &&
            card.controller != minion.controller &&
            !card.controller.isOusted &&
            isBurnableByBearer(card)
        ) {
            burnable.push(card)
        }
    }
    return burnable
}

// What a card on the minion lets the others do against it: enter combat with it, with this much stealth
function getFoughtStealth(target: Minion): number | null {
    let stealth: number | null = null
    for (const card of getAttachedCards(target)) {
        if (card.controller.isOusted) {
            continue
        }
        for (const effect of getInPlayEffects(card)) {
            if (effect.type == 'bearerCanBeFought') {
                stealth = Math.max(stealth ?? 0, effect.stealth)
            }
        }
    }
    return stealth
}

// Does the player control a card in play with an effect of this type
function controlsEffect(gameState: GameState, player: Player, type: InPlayEffect['type']): boolean {
    for (const card of getStandingCards(gameState, player)) {
        for (const effect of getInPlayEffects(card)) {
            if (effect.type == type) {
                return true
            }
        }
    }
    return false
}

/**
 * The minions a minion can enter combat with as an action: any ready minion of another Methuselah for a minion that
 * can ( Theo Bell ), a minion of the prey while a Frontal Assault is in play, a minion with a Haven Uncovered on it
 */
export function getEnterCombatTargets(minion: Minion): Minion[] {
    const { gameState, controller } = minion
    const anyone = !!getCryptImplementation(minion)?.canEnterCombat
    const preyOnly =
        !anyone && controlsEffect(gameState, controller, 'combatWithPrey') ? controller.prey : null
    const targets: Minion[] = []
    for (const other of gameState.competingPlayers) {
        if (other == controller) {
            continue
        }
        for (const target of other.minionsReady) {
            if (anyone || other == preyOnly || getFoughtStealth(target) !== null) {
                targets.push(target)
            }
        }
    }
    return targets
}

// The stealth of the action that enters combat with the target: the best card on it, none when the minion can enter
// combat with it without
export function getEnterCombatStealth(target: Minion): number {
    return getFoughtStealth(target) ?? 0
}

// A bot Methuselah that has to burn a pool or a blood of a vampire ( a human chooses by hand ): the blood of the vampire that holds the most while some
// vampire holds 2 or more, else the pool, else the blood that is left
function burnOne(player: Player): void {
    const holders = player.vampiresReady
        .filter(vampire => vampire.blood > 0)
        .toSorted((a: Vampire, b: Vampire) => b.blood - a.blood)
    if (holders.length > 0 && (holders[0].blood >= 2 || player.pool <= 1)) {
        gameMutations.changeBlood.act(player, { card: holders[0], amount: -1 })
    } else if (player.pool > 0) {
        gameMutations.changePool.act(player, { player, amount: -1 })
    }
}

// The pool a Methuselah burns, down to nothing
function burnPool(author: Player, victim: Player, amount: number): void {
    const burned = Math.min(amount, victim.pool)
    if (burned > 0 && !victim.isOusted) {
        gameMutations.changePool.act(author, { player: victim, amount: -burned })
    }
}

/**
 * The player unlocked: its own cards in play act, and the cards of the others that make a Methuselah pay in an unlock
 * phase make it pay.
 */
export function applyUnlockPhaseEffects(gameState: GameState, player: Player): void {
    for (const card of getStandingCards(gameState, player)) {
        for (const effect of getInPlayEffects(card)) {
            if (effect.type == 'preyBurnsPool') {
                const prey = player.prey
                if (prey && !prey.isOusted && prey != player) {
                    burnPool(player, prey, effect.amount)
                }
            }
            if (effect.type == 'poolToCounters' && player.pool > effect.amount) {
                gameMutations.changePool.act(player, { player, amount: -effect.amount })
                gameMutations.changeBlood.act(player, { card, amount: effect.amount })
            }
        }
    }
    for (const holder of gameState.competingPlayers) {
        for (const card of getStandingCards(gameState, holder)) {
            for (const effect of getInPlayEffects(card)) {
                if (
                    effect.type == 'unlockBurnsPoolWhileBearerInTorpor' &&
                    getHost(card)?.isIn.torpor
                ) {
                    burnPool(player, player, effect.amount)
                }
                if (effect.type == 'othersBurnPerCounter' && holder != player && player.isBot) {
                    for (let counter = 0; counter < card.blood && !player.isOusted; counter++) {
                        burnOne(player)
                    }
                }
            }
        }
    }
}

/**
 * The player goes to its influence phase: the cards of its own that burn in it do, and make it pay.
 */
export function applyInfluencePhaseEffects(gameState: GameState, player: Player): void {
    for (const card of getStandingCards(gameState, player)) {
        for (const effect of getInPlayEffects(card)) {
            if (effect.type == 'influenceBurnsSelfAndPoolPerPreyMinion') {
                burnPool(player, player, player.prey?.minionsReady.length ?? 0)
                gameMutations.moveCardToRegion.act(player, {
                    card,
                    fromCardRegion: card.region,
                    toCardRegion: card.owner.ashHeap,
                    x: 0,
                    y: 0,
                })
            }
        }
    }
}

/**
 * A vampire went to torpor: the cards on it that make its controller pay do, and the cards in play that take a hostage
 * do.
 */
export function applyTorporEffects(gameState: GameState, vampire: Minion): void {
    for (const card of getAttachedCards(vampire)) {
        if (!(card instanceof LibraryCard) || !gameState.cards[card.oid]) {
            continue
        }
        for (const effect of getInPlayEffects(card)) {
            if (effect.type == 'bearerTorporBurnsPool') {
                burnPool(card.controller, vampire.controller, effect.amount)
            }
        }
    }
    for (const holder of gameState.competingPlayers) {
        for (const card of getStandingCards(gameState, holder)) {
            for (const effect of getInPlayEffects(card)) {
                if (
                    effect.type == 'hostageOnTorpor' &&
                    vampire.isVampire() &&
                    vampire.minionAttrs.capacity <= effect.maxCapacity
                ) {
                    botMutations.setHostage.act(holder, { vampire, card })
                }
            }
        }
    }
    applyMinionLostEffects(gameState, vampire)
}

/**
 * A ready minion was burned or sent to torpor: the Methuselahs whose prey it is gain what their cards in play say.
 */
export function applyMinionLostEffects(gameState: GameState, minion: Minion): void {
    for (const holder of gameState.competingPlayers) {
        if (holder.prey != minion.controller || holder == minion.controller) {
            continue
        }
        for (const card of getStandingCards(gameState, holder)) {
            for (const effect of getInPlayEffects(card)) {
                if (effect.type == 'poolWhenPreyLosesMinion') {
                    gameMutations.changePool.act(holder, { player: holder, amount: effect.amount })
                }
            }
        }
    }
}

/**
 * Hostages
 */

// Does the vampire hold a hostage counter, put by a card that is still in play
export function isHostage(vampire: Card): boolean {
    const { gameState } = vampire
    const cardOid = gameState.hostages[vampire.oid]
    const card = cardOid ? gameState.cards[cardOid] : undefined
    return !!card && card.isIn.ready && vampire.isIn.play
}

// The vampires with a hostage counter
export function countHostages(gameState: GameState): number {
    let count = 0
    for (const oid of Object.keys(gameState.hostages)) {
        const vampire = gameState.cards[oid]
        if (vampire && isHostage(vampire)) {
            count++
        }
    }
    return count
}

// The vampires of the player that a card can free from its hostage counters, paying `cost` blood: none once the card was
// used this turn, or when no ready vampire holds the blood
export function getFreeableHostages(player: Player, card: Card, cost: number): Vampire[] {
    const { usedCards } = player.gameState.turnResources
    if (usedCards.includes(card.oid) || !getPayerOfHostage(player, cost)) {
        return []
    }
    return player.vampiresInTorpor.filter(
        vampire => player.gameState.hostages[vampire.oid] == card.oid && isHostage(vampire),
    )
}

// The ready vampire of the player that pays for a hostage: the one that holds the most blood
export function getPayerOfHostage(player: Player, cost: number): Vampire | undefined {
    return player.vampiresReady
        .filter(vampire => vampire.blood >= cost)
        .toSorted((a: Vampire, b: Vampire) => b.blood - a.blood)[0]
}
