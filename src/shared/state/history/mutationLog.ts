import { Player } from '@/shared/model/Player.ts'
import { Card } from '@/shared/model/Card.ts'
import { cardLogRef, playerLogRef, revealedCardLogRef } from '@/shared/const/game.ts'
import { MinionAction, MinionActionType } from '@/shared/types/state.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { LogDetail, LogDetailIcon } from '@/shared/types/history.ts'
import * as actions from '@/shared/state/gameplay/minionActions.ts'
import { disciplineUsesImg } from '@/shared/disciplineIcons.ts'

// Helpers writing the log texts and details of the mutations

// How a mutation completing the action in progress goes in the line of its declaration
export type ActionLineFold = 'replace' | 'silent' | null

// A player, or a card other than the mutation's own, in a log text ( see LOG_REF_REGEX ). The
// card is named to the players who can see it when logged ( see secureLogRefs )
export function logPlayer(player: Player | null | undefined): string {
    return player ? playerLogRef(player.oid) : ''
}
export function logCard(card: Card): string {
    return cardLogRef(card.oid)
}
// A card the text reveals to all, even from the hand : the card of a declared action
export function logRevealedCard(card: Card): string {
    return revealedCardLogRef(card.oid)
}

// A counter after a change of `amount`, with its value before ( "pool 15 → 12" ). The icon,
// when there's one, replaces the label
export function counterDetail(
    label: string,
    value: number,
    amount: number,
    icon?: LogDetailIcon,
): LogDetail {
    return { label, icon, from: `${value - amount}`, value: `${value}` }
}

// Blood is the drop, the life of an ally keeps its label
export function bloodDetail(card: Card, amount: number): LogDetail {
    const bloodName = card.bloodName
    return counterDetail(bloodName, card.blood, amount, bloodName === 'blood' ? 'blood' : undefined)
}

export function poolDetail(player: Player, amount: number): LogDetail {
    return counterDetail('pool', player.pool, amount, 'pool')
}

// A region in a log text : its owner is written unless it is the author ( the author heads the
// log block )
export function logRegion(region: AnyCardRegion, author: Player): string {
    const owner = region.owner
    return owner && owner.oid !== author.oid ? `${logPlayer(owner)}'s ${region.name}` : region.name
}

// The action in a log text : its card from hand, the card in play providing it ( "Powerbase's
// action", "Eulogio's action" for a vampire's own ), else its name
export function logActionName(minionAction: MinionAction): string {
    if (minionAction.type == MinionActionType.ActionCardFromHand) {
        return logRevealedCard(minionAction.card)
    }
    if (minionAction.type == MinionActionType.ActionInPlay && minionAction.card) {
        return `${logCard(minionAction.card)}'s action`
    }
    return actions.getName(minionAction).toLowerCase()
}

function logTarget(target: Card | Player): string {
    return target instanceof Card ? logCard(target) : logPlayer(target)
}

// The whole declaration of an action, as ActionInfos shows it : "Declare bleed Govern the
// Unaligned ( disciplines ) X=2 on Bob with Eulogio". Logged again by each mutation completing
// it, its line shows the latest
export function declarationLogText(minionAction: MinionAction): string {
    let actionVerb = ''
    let usage = ''
    if (minionAction.type == MinionActionType.ActionCardFromHand) {
        actionVerb = minionAction.card.actionVerb ? `${minionAction.card.actionVerb} ` : ''
        usage =
            disciplineUsesImg(minionAction.usage.disciplines ?? []) +
            actions.usageXLog(minionAction.usage)
    }
    const target = minionAction.target ? ` on ${logTarget(minionAction.target)}` : ''
    const actingMinion = logCard(minionAction.actingMinion)
    return `Declare ${actionVerb}${logActionName(minionAction)}${usage}${target} with ${actingMinion}`
}
