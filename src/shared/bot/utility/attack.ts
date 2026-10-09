/**
 * One turn of bleeds against a defence: the model behind the lunge of my predator on me and my own
 * opportunity on my prey ( .claude/docs/bot-ai-phase3.md, section 3b points 2, 3 and 5 ). Exact for
 * what is public or known ( the minions, their intercept, the cards I hold ), and a small distribution
 * for what is hidden ( the cards in an opponent's hand ). No randomness: the distribution is
 * enumerated, so the same table always gives the same numbers.
 */

// A value with its probability: the hidden part of a hand ( cards of a role in it, times their effect )
export type Dist = { value: number; p: number }[]

export function exact(value: number): Dist {
    return [{ value, p: 1 }]
}

// How many of `trials` cards have the role when each has `chance` to ( a share of the deck ), times
// `scale`. Above `cap` the tail is folded into `cap`: a hand rarely holds more.
export function binomial(trials: number, chance: number, cap: number, scale = 1): Dist {
    const n = Math.max(0, Math.floor(trials))
    const top = Math.min(n, cap)
    const odds = Math.min(1, Math.max(0, chance))
    const result: Dist = []
    let used = 0
    let coefficient = 1
    for (let k = 0; k <= top; k++) {
        if (k > 0) {
            coefficient = (coefficient * (n - k + 1)) / k
        }
        const p = k == top ? 1 - used : coefficient * odds ** k * (1 - odds) ** (n - k)
        result.push({ value: k * scale, p })
        used += p
    }
    return result
}

export type Attacker = {
    bleed: number
    stealth: number
}

// What stands between the actions and the pool
export type DefenceSide = {
    // The intercept of each unlocked minion that can block
    reactors: number[]
    // The intercept each locked minion would have if a wake card brought it back, best first
    wakers: number[]
    // How many wake cards are held
    wakeCards: Dist
    bounceCards: Dist
    // How many of the reactors can play a bounce
    bouncers: number
    // Intercept a standing ability adds to the best reactor
    standingIntercept: number
}

// The cards of the attacker that matter, in points
export type AttackKit = {
    stealth: Dist
    // Bleed points added to the bleeds that land
    bonus: Dist
    // Stealth points of standing abilities, free of cards
    standingStealth: number
}

export type AttackOutcome = {
    p: number
    // Pool the target loses
    loss: number
    blocked: number
    bounced: number
    // Pool of the bleeds that were bounced: it does not hit the target, it lands on the Methuselah the
    // bounce sends it to ( the prey of the target, never the attacker: nothing is bounced with two left )
    bouncedLoss: number
    landed: number
}

export type AttackResult = {
    attackers: number
    outcomes: AttackOutcome[]
    expectedLoss: number
    expectedBounced: number
    chanceOfBounce: number
    // Of the attackers, the share that a block stopped
    blockedShare: number
}

function playOut(
    attackers: Attacker[],
    defence: DefenceSide,
    stealthPoints: number,
    bonus: number,
    wakes: number,
    bounces: number,
): Omit<AttackOutcome, 'p'> {
    const reactors = [...defence.reactors, ...defence.wakers.slice(0, wakes)].toSorted(
        (a, b) => a - b,
    )
    if (reactors.length > 0 && defence.standingIntercept > 0) {
        reactors[reactors.length - 1] += defence.standingIntercept
        reactors.sort((a, b) => a - b)
    }

    // The attacker leads with its biggest bleeds, so the stealth goes where it counts
    let stealthLeft = stealthPoints
    let blocked = 0
    const landed: number[] = []
    for (const attacker of attackers.toSorted((a, b) => b.bleed - a.bleed)) {
        const best = reactors[reactors.length - 1]
        if (best === undefined) {
            landed.push(attacker.bleed)
            continue
        }
        const needed = Math.max(0, best + 1 - attacker.stealth)
        if (needed <= stealthLeft) {
            stealthLeft -= needed
            landed.push(attacker.bleed)
            continue
        }
        // The weakest reactor that is enough blocks, and locks
        reactors.splice(
            reactors.findIndex(intercept => intercept >= attacker.stealth),
            1,
        )
        blocked++
    }

    landed.sort((a, b) => b - a)
    if (landed.length > 0) {
        landed[0] += bonus
    }
    // A bounce needs a reactor that is still unlocked: one that blocked is locked
    const bounced = Math.min(bounces, defence.bouncers, reactors.length, landed.length)
    const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + amount, 0)
    const kept = landed.slice(bounced)
    return {
        loss: sum(kept),
        blocked,
        bounced,
        bouncedLoss: sum(landed.slice(0, bounced)),
        landed: kept.length,
    }
}

// One bleed per attacker: a minion cannot bleed twice in a turn, even if it unlocks
export function resolveAttack(
    attackers: Attacker[],
    defence: DefenceSide,
    kit: AttackKit,
): AttackResult {
    const outcomes: AttackOutcome[] = []
    for (const stealth of kit.stealth) {
        for (const bonus of kit.bonus) {
            for (const wake of defence.wakeCards) {
                for (const bounce of defence.bounceCards) {
                    outcomes.push({
                        p: stealth.p * bonus.p * wake.p * bounce.p,
                        ...playOut(
                            attackers,
                            defence,
                            stealth.value + kit.standingStealth,
                            bonus.value,
                            wake.value,
                            bounce.value,
                        ),
                    })
                }
            }
        }
    }
    const expect = (pick: (outcome: AttackOutcome) => number) =>
        outcomes.reduce((total, outcome) => total + outcome.p * pick(outcome), 0)
    return {
        attackers: attackers.length,
        outcomes,
        expectedLoss: expect(outcome => outcome.loss),
        expectedBounced: expect(outcome => outcome.bouncedLoss),
        chanceOfBounce: expect(outcome => (outcome.bounced > 0 ? 1 : 0)),
        blockedShare:
            attackers.length > 0 ? expect(outcome => outcome.blocked) / attackers.length : 0,
    }
}

// Several possible boards, each with its chance ( the vampires a helper may bring back from torpor ): the
// attack as a whole is their mix
export function mixResults(parts: { p: number; result: AttackResult }[]): AttackResult {
    const expect = (pick: (result: AttackResult) => number) =>
        parts.reduce((total, part) => total + part.p * pick(part.result), 0)
    return {
        attackers: expect(result => result.attackers),
        outcomes: parts.flatMap(part =>
            part.result.outcomes.map(outcome => ({ ...outcome, p: outcome.p * part.p })),
        ),
        expectedLoss: expect(result => result.expectedLoss),
        expectedBounced: expect(result => result.expectedBounced),
        chanceOfBounce: expect(result => result.chanceOfBounce),
        blockedShare: expect(result => result.blockedShare),
    }
}

// The chance that the pool the target loses is at least `pool` ( an ouster when it is its pool )
export function chanceOfLossAtLeast(result: AttackResult, pool: number): number {
    const sum = (outcomes: AttackOutcome[]) =>
        outcomes.reduce((total, outcome) => total + outcome.p, 0)
    // Divided by the whole, so that the rounding of the products does not leave a certainty at 0.9999
    return sum(result.outcomes.filter(outcome => outcome.loss >= pool)) / sum(result.outcomes)
}
