import { MinionActionType } from '@/shared/types/state.ts'
import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { CARLTON_ID, ROYALS_ID, UNDERBRIDGE_STRAY_ID } from '../cardIds.ts'
import { MinionSetup } from './assessment.ts'
import { cardTurn, cardValues } from './cardActions.ts'
import { planAs } from './plan.ts'
import { Scenario, expectEqual } from './helpers.ts'

/**
 * What a recruit is worth to the bot: the attacks the ally stops at home, less the fights its blocks run it into, what
 * its card gives to a fight, its abilities once. Three Methuselahs, nobody holds a hidden card.
 */

const ANIMALISM = { [Discipline.Animalism]: DisciplineLevel.INFERIOR }

const LUNGE: MinionSetup[] = [{ bleed: 3 }, { bleed: 3 }, { bleed: 3 }, { bleed: 3 }]

// A table where my minions can recruit the card, against a predator with these minions. The second minion is a
// Brujah, which 47th Street Royals asks for
function recruitTurn(id: string, predator: MinionSetup[], pool = 30) {
    const turn = cardTurn({
        minions: [{ disciplines: ANIMALISM }, { disciplines: {} }],
        hand: [id],
        extra: [id],
        predator,
        blockers: [{}],
    })
    turn.minions[1].vampireAttrs.clan = 'Brujah'
    turn.me.pool = pool
    return turn
}

function recruitValue(id: string, predator: MinionSetup[], pool = 30): number {
    const [first] = cardValues(recruitTurn(id, predator, pool))
    if (!first) {
        throw new Error('The recruit is not offered')
    }
    return first.value
}

export const ALLY_VALUE_SCENARIOS: Scenario[] = [
    {
        name: 'Ally values: an ally is worth the attacks it stops at home, more against a predator that bleeds than against none',
        run() {
            const against = recruitValue(CARLTON_ID, LUNGE)
            const alone = recruitValue(CARLTON_ID, [])
            expectEqual(alone > 0, true, 'his own kit is worth something')
            expectEqual(against > alone + 2, true, `blockers count ( ${against} against ${alone} )`)
        },
    },
    {
        name: 'Ally values: an ally with one life that dies in its first fight is worth less than one that lives through it',
        run() {
            const stray = recruitValue(UNDERBRIDGE_STRAY_ID, LUNGE)
            const carlton = recruitValue(CARLTON_ID, LUNGE)
            expectEqual(
                stray < carlton,
                true,
                `the Stray ( ${stray} ) is less than Carlton ( ${carlton} )`,
            )
        },
    },
    {
        name: 'Ally values: 47th Street Royals are worth the bleed they can cut, up to 3',
        run() {
            const small = recruitValue(ROYALS_ID, [{ bleed: 1 }, { bleed: 1 }])
            const big = recruitValue(ROYALS_ID, LUNGE)
            expectEqual(
                small < big,
                true,
                `a small bleed ( ${small} ) is less than a big one ( ${big} )`,
            )
        },
    },
    {
        name: 'Ally values: the plan recruits when my predator lunges hard, and bleeds when it has nothing',
        run() {
            const recruits = (predator: MinionSetup[], pool: number) => {
                const turn = recruitTurn(CARLTON_ID, predator, pool)
                const [carlton] = turn.me.hand.cards
                const plan = planAs(turn.ring, turn.me, { cards: true })
                return plan.actions.some(
                    action =>
                        action.option.action.type == MinionActionType.ActionCardFromHand &&
                        action.option.action.card.oid == carlton.oid,
                )
            }
            expectEqual(recruits(LUNGE, 8), true, 'a predator that would take 12 a turn')
            expectEqual(recruits([], 30), false, 'a predator with nothing: the minions bleed')
        },
    },
]
