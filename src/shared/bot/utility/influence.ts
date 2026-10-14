import { DeckList } from '@/shared/types/gateway.ts'
import { transfersOfTurn } from '@/shared/const/model.ts'
import { UsageOption } from '@/shared/cardImpl/catalog/requirements.ts'
import { BotOption, BotOptionOf, DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'
import { Assessment, chanceOfOust } from '@/shared/bot/utility/assessment.ts'
import { bloodChange } from '@/shared/bot/utility/bloat.ts'
import { ExplainCandidate } from '@/shared/bot/utility/explain.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import { readyMinions, TableSnapshot, unlockedMinions } from '@/shared/bot/utility/snapshot.ts'
import { CardSummary, summarizeCardId, waysUsableBy } from '@/shared/bot/utility/summaries.ts'

/**
 * Which vampires to bring out, in which order, and when to stop. The transfers of every turn to come are known
 * from the start ( 1, 2, 3 for the first three Methuselahs, then 4 a turn ), so the order is a plan over
 * them: the blood put on a vampire stays on it, and a vampire comes out on the first turn where the transfers
 * so far cover the capacity of those before it and its own. Two vampires of 5 and 8 capacity bought by the first
 * Methuselah ( 1, 5, 9, 13 transfers ) come on turns 2 and 4, where an 8 then a 5 comes on turns 3 and 4.
 * Every order of the vampires of the uncontrolled region is tried, with every number of them brought out, and
 * the best plan by what its vampires do over the turns, less the pool it costs, is the one whose first step is
 * taken. Nothing is kept from one decision to the next: the blood already on the vampires is the progress.
 * What stops the plan is the pool: the crew keeps a share of a floor, and the pool left after this turn must hold
 * against the lunge of my predator.
 */

export type PlannedVampire = {
    vampire: MinionProfile
    // The turn of mine it comes on, 0 being this one
    turn: number
}

export type InfluencePlan = {
    order: PlannedVampire[]
    value: number
    // The pool it costs in all, and this turn
    spend: number
    spendNow: number
    // The transfers of this turn that go on its first vampire
    firstNow: number
}

export type InfluenceJudgement = {
    option: BotOption
    candidates: ExplainCandidate[]
    note: string
}

// A card that puts blood on a younger vampire of the uncontrolled region: what a vampire does with it, by its disciplines
type AccelerationCard = {
    plays: { ways: UsageOption[]; amount: number }[]
    // The chance it is there on a turn: 1 for a card of the hand, its share of the library for a card of the deck
    weight: number
}

type Accelerator = {
    capacity: number
    // The chance that it has a card to accelerate with on a turn, and the blood it puts when it does
    chance: number
    amount: number
}

type Setup = {
    assessment: Assessment
    // The transfers of each turn of mine to come, this one first
    schedule: number[]
    cards: AccelerationCard[]
    // The acceleration cards that are there on a turn, at most
    available: number
    // The vampires of mine in play, which can accelerate from the next turn on
    standing: Accelerator[]
    ready: number
    pool: number
    crewFloor: number
    riskFloors: Map<string, number>
}

// The transfers of every turn of mine to come, this one first ( what is left of it )
export function transferSchedule(table: TableSnapshot, turns: number): number[] {
    const { number, players, competing, transfers } = table.turn
    return Array.from({ length: turns }, (_, turn) =>
        turn == 0 ? transfers : transfersOfTurn(number + turn * competing, players),
    )
}

function accelerationCardOf(summary: CardSummary, weight: number): AccelerationCard | null {
    const plays = summary.plays.flatMap(play =>
        play.kind == 'action' && play.target == 'youngerUncontrolledVampire' ?
            [
                {
                    ways: play.ways,
                    amount: play.effects.reduce(
                        (total, effect) => total + (effect.type == 'gainBlood' ? effect.amount : 0),
                        0,
                    ),
                },
            ]
        :   [],
    )
    return plays.length > 0 ? { plays, weight } : null
}

// The acceleration cards: those of the hand, and the share of the library that is one ( what a draw gives )
function accelerationCardsOf(assessment: Assessment, deck: DeckList): AccelerationCard[] {
    const inHand = assessment.table.me.hand.flatMap(
        ({ summary }) => accelerationCardOf(summary, 1) ?? [],
    )
    let library = 0
    const drawn: { summary: CardSummary; count: number }[] = []
    for (const [id, count] of Object.entries(deck)) {
        const summary = summarizeCardId(id)
        if (!summary || summary.isCrypt) {
            continue
        }
        library += count
        drawn.push({ summary, count })
    }
    const inDeck = drawn.flatMap(
        ({ summary, count }) => accelerationCardOf(summary, count / Math.max(1, library)) ?? [],
    )
    return [...inHand, ...inDeck]
}

function acceleratorOf(vampire: MinionProfile, cards: AccelerationCard[]): Accelerator {
    let chance = 0
    let blood = 0
    for (const card of cards) {
        const amount = Math.max(
            0,
            ...card.plays
                .filter(play => waysUsableBy(play.ways, vampire.disciplines).length > 0)
                .map(play => play.amount),
        )
        chance += amount > 0 ? card.weight : 0
        blood += amount > 0 ? card.weight * amount : 0
    }
    return {
        capacity: vampire.capacity,
        chance: Math.min(1, chance),
        amount: blood / (chance || 1),
    }
}

// The accelerators of a turn, each acting once, and the acceleration cards left to play
type Accelerating = { accelerators: Accelerator[]; cards: number }

// What the accelerators older than `capacity` put on a vampire of that capacity that needs `need` blood, in
// expectation, and the number of their actions it takes. What they used is not there for the next vampire
function accelerateInto(
    accelerating: Accelerating,
    capacity: number,
    need: number,
): { blood: number; actions: number } {
    let blood = 0
    let actions = 0
    const older = accelerating.accelerators
        .filter(accelerator => accelerator.capacity > capacity && accelerator.chance > 0)
        .toSorted((a, b) => b.amount - a.amount)
    for (const accelerator of older) {
        const uses = Math.min(
            accelerator.chance,
            accelerating.cards,
            (need - blood) / accelerator.amount,
        )
        if (uses <= 0) {
            break
        }
        accelerator.chance -= uses
        accelerating.cards -= uses
        blood += uses * accelerator.amount
        actions += uses
    }
    return { blood, actions }
}

type Run = {
    // The turn each vampire of the order comes on
    turns: number[]
    spend: number
    spendNow: number
    firstNow: number
    // The actions of the vampires in play that are spent accelerating
    accelerations: number
}

// The order played over the turns: the acceleration cards of the vampires in play put blood first ( the minion phase
// comes before the influence phase ), then the transfers go on the vampires in order. Null when one is not out
// within the turns looked at. `now` caps the transfers of this turn.
function runOrder(setup: Setup, order: MinionProfile[], now: number): Run | null {
    const needs = order.map(vampire => Math.max(0, vampire.capacity - vampire.blood))
    const turns = order.map((): number | null => null)
    let out = 0
    let spend = 0
    let spendNow = 0
    let firstNow = 0
    let accelerations = 0
    for (let turn = 0; turn < setup.schedule.length && out < order.length; turn++) {
        if (turn > 0) {
            const accelerating: Accelerating = {
                accelerators: [
                    ...setup.standing,
                    ...order.flatMap((vampire, index) => {
                        const came = turns[index]
                        return came !== null && came < turn ?
                                [acceleratorOf(vampire, setup.cards)]
                            :   []
                    }),
                ].map(accelerator => ({ ...accelerator })),
                cards: setup.available,
            }
            for (let index = 0; index < order.length; index++) {
                if (needs[index] > 0) {
                    const { blood, actions } = accelerateInto(
                        accelerating,
                        order[index].capacity,
                        needs[index],
                    )
                    needs[index] -= blood
                    accelerations += actions
                }
            }
        }
        let transfers = turn == 0 ? Math.min(setup.schedule[0], now) : setup.schedule[turn]
        for (let index = 0; index < order.length && transfers > 0; index++) {
            const used = Math.min(transfers, needs[index])
            needs[index] -= used
            transfers -= used
            spend += used
            if (turn == 0) {
                spendNow += used
                firstNow = index == 0 ? used : firstNow
            }
        }
        // A vampire that is complete is in play from this turn, whoever filled it
        for (let index = 0; index < order.length; index++) {
            if (needs[index] == 0 && turns[index] === null) {
                turns[index] = turn
                out++
            }
        }
    }
    const came = turns.filter(turn => turn !== null)
    return came.length == order.length ?
            { turns: came, spend, spendNow, firstNow, accelerations }
        :   null
}

// What a vampire is worth to me over the turns it acts, less nothing: the pool it costs is the plan's
function worthOf(setup: Setup, vampire: MinionProfile, turn: number, crew: number): number {
    const { profile } = setup.assessment
    const { influence } = profile
    const acting = Math.max(0, influence.horizon - turn)
    const crowd = Math.max(influence.crowdFloor, 1 - influence.crowd * crew)
    const perTurn = influence.turnWorth + influence.perCapacity * vampire.capacity
    const blood = bloodChange(
        profile,
        { ...vampire, blood: 0 },
        vampire.capacity,
        setup.assessment.bloat[setup.assessment.table.me.oid],
    )
    return acting * perTurn * crowd + blood
}

function valueOf(setup: Setup, order: MinionProfile[], run: Run): number {
    const { plan } = setup.assessment.profile
    const gained = order.reduce(
        (total, vampire, index) =>
            total + worthOf(setup, vampire, run.turns[index], setup.ready + index),
        0,
    )
    return gained - plan.caution * run.spend - plan.cardAction * run.accelerations
}

// The least pool that leaves my predator at most `tolerance` chance to oust me on its next turn, with the
// vampires brought out this turn standing as blockers. More than the pool when even all of it is not enough
function riskFloorOf(setup: Setup, arrivals: MinionProfile[]): number {
    const key = arrivals
        .map(vampire => vampire.oid)
        .toSorted()
        .join(',')
    const known = setup.riskFloors.get(key)
    if (known !== undefined) {
        return known
    }
    const { assessment } = setup
    const reserved = [
        ...unlockedMinions(assessment.table.me),
        ...arrivals.map(vampire => ({
            ...vampire,
            state: 'unlocked' as const,
            blood: vampire.capacity,
        })),
    ]
    const risky = (pool: number) =>
        chanceOfOust(assessment, { pool, reserved }) > assessment.profile.influence.tolerance
    let floor = setup.pool + 1
    if (!risky(setup.pool)) {
        let low = 0
        let high = setup.pool
        while (low < high) {
            const middle = Math.floor((low + high) / 2)
            if (risky(middle)) {
                low = middle + 1
            } else {
                high = middle
            }
        }
        floor = low
    }
    setup.riskFloors.set(key, floor)
    return floor
}

// Every order of every subset of the vampires, played: the plans that hold against the pool
function plansOf(setup: Setup, vampires: MinionProfile[]): InfluencePlan[] {
    const plans: InfluencePlan[] = []
    const holds = (order: MinionProfile[], run: Run | null): run is Run => {
        if (!run || run.spend > setup.pool - setup.crewFloor) {
            return false
        }
        const arrivals = order.filter((_, index) => run.turns[index] == 0)
        return setup.pool - run.spendNow >= riskFloorOf(setup, arrivals)
    }
    const consider = (order: MinionProfile[]) => {
        let run = runOrder(setup, order, Infinity)
        if (!holds(order, run)) {
            // Spend only what the risk leaves of this turn
            const capped = Math.max(0, setup.pool - riskFloorOf(setup, []))
            run = capped < setup.schedule[0] ? runOrder(setup, order, capped) : null
        }
        if (holds(order, run)) {
            const { turns } = run
            plans.push({
                order: order.map((vampire, index) => ({ vampire, turn: turns[index] })),
                value: valueOf(setup, order, run),
                spend: run.spend,
                spendNow: run.spendNow,
                firstNow: run.firstNow,
            })
        }
    }
    const extend = (order: MinionProfile[]) => {
        if (order.length > 0) {
            consider(order)
        }
        for (const vampire of vampires) {
            if (!order.includes(vampire)) {
                extend([...order, vampire])
            }
        }
    }
    extend([])
    return plans.toSorted((a, b) => b.value - a.value || a.spend - b.spend)
}

function setupOf(assessment: Assessment, deck: DeckList): Setup {
    const { table, profile } = assessment
    const cards = accelerationCardsOf(assessment, deck)
    const ready = readyMinions(table.me)
    return {
        assessment,
        schedule: transferSchedule(table, profile.influence.lookahead),
        cards,
        available: cards.reduce((total, card) => total + card.weight, 0),
        standing: ready
            .filter(minion => minion.isVampire)
            .map(minion => acceleratorOf(minion, cards)),
        ready: ready.length,
        pool: table.me.pool,
        crewFloor:
            profile.influence.floor *
            Math.min(1, ready.length / Math.max(1, profile.influence.crew)),
        riskFloors: new Map(),
    }
}

function describePlan(plan: InfluencePlan): string {
    return plan.order
        .map(({ vampire, turn }) => `${vampire.name} ( ${vampire.capacity} ) +${turn}`)
        .join(', ')
}

function influenceOption(
    options: BotOptionOf<'influence'>[],
    plan: InfluencePlan,
): BotOptionOf<'influence'> | undefined {
    const first = plan.order[0]?.vampire
    return options
        .filter(option => option.vampire.oid == first?.oid && option.amount <= plan.firstNow)
        .toSorted((a, b) => b.amount - a.amount)[0]
}

// The plans that hold, best first
export function influencePlans(assessment: Assessment, deck: DeckList): InfluencePlan[] {
    return plansOf(setupOf(assessment, deck), assessment.table.me.uncontrolled)
}

/**
 * The influence phase: the first step of the best plan, or the end of the phase when none pays. Null when the
 * decision offers no influence ( no transfer or no pool left ).
 */
export function judgeInfluence(
    decision: DecisionPoint,
    assessment: Assessment,
    deck: DeckList,
): InfluenceJudgement | null {
    const options = optionsOfType(decision.options, 'influence')
    const endPhase = decision.options.find(option => option.type == 'endPhase')
    if (options.length == 0 || !endPhase) {
        return null
    }
    const { uncontrolled } = assessment.table.me
    const setup = setupOf(assessment, deck)
    const plans = plansOf(setup, uncontrolled).filter(plan => plan.firstNow > 0)
    const best = plans[0]
    const candidates = plans.slice(0, 6).flatMap((plan): ExplainCandidate[] => {
        const option = influenceOption(options, plan)
        return option ?
                [
                    {
                        option,
                        score: plan.value,
                        parts: {
                            spend: plan.spend,
                            now: plan.spendNow,
                            last: Math.max(...plan.order.map(({ turn }) => turn)),
                        },
                    },
                ]
            :   []
    })
    const floors = `crew floor ${setup.crewFloor.toFixed(1)}, risk floor ${riskFloorOf(setup, []).toFixed(0)}`
    const option =
        best && best.value >= assessment.profile.influence.margin ?
            influenceOption(options, best)
        :   undefined
    if (!best || !option) {
        return {
            option: endPhase,
            candidates,
            note:
                best ?
                    `no plan pays enough ( ${describePlan(best)} ), ${floors}`
                :   `no plan holds, ${floors}`,
        }
    }
    return { option, candidates, note: `${describePlan(best)} | ${floors}` }
}
