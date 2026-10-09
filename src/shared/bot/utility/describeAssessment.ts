import { Assessment, survivalCurve } from '@/shared/bot/utility/assessment.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import { everyone, MethuselahSnapshot } from '@/shared/bot/utility/snapshot.ts'
import { PlannedAction, TurnPlan } from '@/shared/bot/utility/turnPlan.ts'

/**
 * The assessment as text: the dev dump ( npm run bot:assess ) and the explain trace of the utility agent.
 */

const percent = (value: number) => `${Math.round(value * 100)}%`
const fixed = (value: number) => value.toFixed(2)

function describeMinionProfile(minion: MinionProfile): string {
    const state = { unlocked: 'U', locked: 'L', torpor: 'T' }[minion.state]
    const parts = [
        `${minion.blood}/${minion.capacity}`,
        `str ${minion.strength}`,
        `bleed ${minion.bleed}`,
        `int ${minion.intercept.general}`,
    ]
    if (minion.intercept.againstBleeds != minion.intercept.general) {
        parts.push(`int vs bleeds ${minion.intercept.againstBleeds}`)
    }
    if (minion.life > 0) {
        parts.push(`life ${minion.life}`)
    }
    if (minion.prevention.length > 0) {
        parts.push(`prevents ${minion.prevention.join('+')}`)
    }
    for (const strike of minion.weaponStrikes) {
        parts.push(
            `${strike.ranged ? 'ranged ' : ''}${strike.aggravated ? 'aggravated ' : ''}weapon ${strike.damage}`,
        )
    }
    if (minion.attached.length > 0) {
        parts.push(`[${minion.attached.join(', ')}]`)
    }
    return `${minion.name} ${state} ${parts.join(' ')}`
}

function describeMethuselah(snapshot: MethuselahSnapshot): string {
    const place =
        snapshot.isMe ? 'me'
        : snapshot.isPrey && snapshot.isPredator ? 'prey and predator'
        : snapshot.isPrey ? 'prey'
        : snapshot.isPredator ? 'predator'
        : 'other'
    const permanents = snapshot.permanents.map(
        permanent => `${permanent.name}${permanent.available ? '' : ' (spent)'}`,
    )
    const inPlay = permanents.length > 0 ? `, permanents ${permanents.join(', ')}` : ''
    return `${snapshot.name} (${place}): pool ${snapshot.pool}, VP ${snapshot.victoryPoints}, hand ${snapshot.handSize}${inPlay}`
}

// The turn plan as text: the posture, what is kept home, what is done in what order, and how the reserves
// compared ( equity = what the bleeds and the other actions bring, less the fights, plus the guard of the
// minions at home, less the cost of the lunge of my predator and of the cards spent )
export function describeTurnPlan(plan: TurnPlan): string[] {
    const names = (minions: MinionProfile[]) =>
        minions.length > 0 ? minions.map(minion => minion.name).join(', ') : 'nobody'
    if (plan.posture == 'forced') {
        return [`forced: ${plan.actions.map(describeAction).join(', ')}`]
    }
    const lines = [`${plan.posture}, keeps ${names(plan.reserved)} unlocked`]
    const best = plan.cases[plan.chosen]
    if (best) {
        lines.push(
            `oust my prey ${percent(best.chanceToOust)}, be ousted ${percent(best.chanceOfBeingOusted)}`,
        )
    }
    lines.push(
        plan.actions.length > 0 ?
            `does ${plan.actions.map(describeAction).join(', ')}`
        :   'does nothing',
    )
    if (plan.bounceRisk > 0) {
        lines.push(`prey bounces ${percent(plan.bounceRisk)}`)
    }
    for (const [index, one] of plan.cases.entries()) {
        const mark = index == plan.chosen ? '>' : ' '
        lines.push(
            `${mark} keep ${one.kept.length}: equity ${fixed(one.equity)} = bleeds ${fixed(one.bleeds.total)} - fights ${fixed(one.combat)} + other ${fixed(one.idle)} + guard ${fixed(one.guard)} - lunge ${fixed(one.lunge.total)} - cards ${fixed(one.cards)}`,
        )
    }
    return lines
}

function describeAction(action: PlannedAction): string {
    return `${action.actor.name} ${action.kind} ( ${fixed(action.value)} )`
}

export function describeAssessment(assessment: Assessment): string[] {
    const { table } = assessment
    const lines: string[] = []
    for (const snapshot of everyone(table)) {
        lines.push(describeMethuselah(snapshot))
        for (const minion of snapshot.minions) {
            lines.push(`    ${describeMinionProfile(minion)}`)
        }
        const densities = Object.entries(assessment.densities[snapshot.oid])
            .filter(([, density]) => density >= 0.05)
            .map(([role, density]) => `${role} ${percent(density)}`)
        lines.push(
            `    power ${fixed(assessment.power[snapshot.oid])}, believed to hold ${densities.join(', ')}`,
        )
        const bloat = assessment.bloat[snapshot.oid]
        if (bloat.pool >= 0.05 || bloat.blood >= 0.05) {
            lines.push(
                `    takes back ${fixed(bloat.pool)} pool and ${fixed(bloat.blood)} blood per turn from the blood bank`,
            )
        }
        if (snapshot.isMe) {
            continue
        }
        const held = snapshot.minions.filter(minion =>
            assessment.held[snapshot.oid].includes(minion.oid),
        )
        if (held.length > 0) {
            lines.push(
                `    keeps ${held.map(minion => minion.name).join(', ')} unlocked against its own predator`,
            )
        }
        const threat = assessment.threat[snapshot.oid]
        const opportunity = assessment.opportunity[snapshot.oid]
        const stake = assessment.stakes[snapshot.oid]
        const oust = snapshot.isPredator ? `, oust me ${percent(threat.chanceOfOust)}` : ''
        lines.push(
            `    threat ${fixed(threat.total)} ( bleed ${fixed(threat.bleed)}, combat ${fixed(threat.combat)}${oust} )`,
        )
        if (snapshot.isPrey) {
            const target = everyone(table).find(other => other.oid == opportunity.bounceTarget)
            const bounce =
                target ?
                    `, bounced ${percent(opportunity.chanceOfBounce)} ( ${fixed(opportunity.bounced)} onto ${target.name} )`
                :   ', no bounce possible'
            lines.push(
                `    opportunity drain ${fixed(opportunity.drain)} ( oust ${percent(opportunity.chanceOfOust)}, blocked ${percent(opportunity.blockedShare)}${bounce} )`,
            )
        }
        lines.push(
            `    stake ${fixed(stake.weight)} = ring ${fixed(stake.ring)} x ( 1 + danger ${fixed(stake.danger)} + leader ${fixed(stake.leader)} - useful ${fixed(stake.useful)} )`,
        )
    }
    for (const opening of assessment.rescues) {
        const owner = everyone(table).find(snapshot => snapshot.oid == opening.owner)
        lines.push(
            `torpor: ${opening.vampire.name} of ${owner?.name ?? opening.owner} ${opening.vampire.blood}/${opening.vampire.capacity}, a helper brings it back ${percent(opening.chance)}, its Methuselah is still there ${percent(opening.survival)}, rescuing it is worth ${fixed(opening.value)}`,
        )
    }
    if (table.predator) {
        const curve = survivalCurve(assessment)
            .map(
                point =>
                    `${point.reserved} unlocked: ${percent(point.chanceOfOust)}, ${fixed(point.expectedLoss)} pool lost`,
            )
            .join(', ')
        lines.push(`chance that ${table.predator.name} ousts me next turn: ${curve}`)
    }
    return lines
}
