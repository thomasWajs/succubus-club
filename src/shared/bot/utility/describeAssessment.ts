import { Assessment, survivalCurve } from '@/shared/bot/utility/assessment.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import { everyone, MethuselahSnapshot } from '@/shared/bot/utility/snapshot.ts'

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
            `torpor: ${opening.vampire.name} of ${owner?.name ?? opening.owner} ${opening.vampire.blood}/${opening.vampire.capacity}, a helper brings it back ${percent(opening.chance)}, rescuing it is worth ${fixed(opening.value)}`,
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
