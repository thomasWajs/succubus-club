// Hand-built bot scenarios (combat, actions, reactions, master cards, hand size, uniqueness...)
// checked against the rulebook, one file per area in script/scenarios/. Run from the repo root:
//   npx tsx script/botScenarios.ts [--filter text]
// --filter keeps only the scenarios whose name contains the text (case-insensitive).
// Several texts can be given separated by '|' ( --filter "Conditioning|Bonding" ).
// Exits with code 1 if any scenario fails.
import { readFileSync } from 'node:fs'
import { deleteGameState, registerLogger, setGameResources } from '@/shared/registries.ts'
import { initWasmHasher } from '@/shared/hashing.ts'
import { registerSyncMutationTrigger } from './harness.ts'
import { SCENARIOS } from './scenarios/combat.ts'
import { TORPOR_SCENARIOS } from './scenarios/torpor.ts'
import { COST_SCENARIOS } from './scenarios/costs.ts'
import { DECLARE_SCENARIOS } from './scenarios/declare.ts'
import { FAR_MASTERY_SCENARIOS } from './scenarios/farMastery.ts'
import { CARD_SCENARIOS } from './scenarios/combatCards.ts'
import { HUMAN_DAMAGE_SCENARIOS } from './scenarios/humanDamage.ts'
import { BOUNCE_SCENARIOS } from './scenarios/bounce.ts'
import { HUMAN_ACTION_SCENARIOS } from './scenarios/humanAction.ts'
import { MASTER_SCENARIOS } from './scenarios/master.ts'
import { CATALOG_SCENARIOS } from './scenarios/catalog.ts'
import { BRUJAH_SCENARIOS } from './scenarios/brujah.ts'
import { BRUJAH_COMBAT_SCENARIOS } from './scenarios/brujahCombat.ts'
import { BRUJAH_ACTION_SCENARIOS } from './scenarios/brujahAction.ts'
import { BRUJAH_REACTION_SCENARIOS } from './scenarios/brujahReaction.ts'
import { WARRENS_SCENARIOS } from './scenarios/warrens.ts'
import { ANIMALISM_REACTION_SCENARIOS } from './scenarios/animalismReaction.ts'
import { CATS_GUIDANCE_SCENARIOS } from './scenarios/catsGuidance.ts'
import { EVENT_SCENARIOS } from './scenarios/events.ts'
import { ALINE_SCENARIOS } from './scenarios/aline.ts'
import { NOSFERATU_SCENARIOS } from './scenarios/nosferatu.ts'
import { LABYRINTH_SCENARIOS } from './scenarios/labyrinth.ts'
import { KRCG_SCENARIOS } from './scenarios/krcg.ts'
import { CROWS_SCENARIOS } from './scenarios/crows.ts'
import { ATTACHMENT_SCENARIOS } from './scenarios/attachment.ts'
import { PUT_ON_SCENARIOS } from './scenarios/putOn.ts'
import { GUARDIAN_ANGEL_SCENARIOS } from './scenarios/guardianAngel.ts'
import { UTILITY_SCENARIOS } from './scenarios/utility.ts'
import { SUMMARY_SCENARIOS } from './scenarios/summary.ts'
import { ASSESSMENT_SCENARIOS } from './scenarios/assessment.ts'
import { PLAN_SCENARIOS } from './scenarios/plan.ts'
import { BLOAT_SCENARIOS } from './scenarios/bloat.ts'
import { COMBAT_MODEL_SCENARIOS } from './scenarios/combatModel.ts'
import { COMBAT_POSITION_SCENARIOS } from './scenarios/combatPosition.ts'
import { COMBAT_PLAN_SCENARIOS } from './scenarios/combatPlan.ts'
import { LIVE_COMBAT_SCENARIOS } from './scenarios/liveCombat.ts'
import { BLOCK_SCENARIOS } from './scenarios/block.ts'
import { REACTION_SCENARIOS } from './scenarios/reaction.ts'
import { MODIFIER_SCENARIOS } from './scenarios/modifier.ts'
import { CARD_ACTION_SCENARIOS } from './scenarios/cardActions.ts'
import { INFLUENCE_SCENARIOS, INFLUENCE_VALUE_SCENARIOS } from './scenarios/influence.ts'
import { MASTER_PHASE_SCENARIOS } from './scenarios/masterPhase.ts'
import { createdGames } from './scenarios/helpers.ts'

type ScenarioResult = { name: string; error: string | null }

function parseFilter(argv: string[]): string[] {
    const index = argv.indexOf('--filter')
    if (index < 0) {
        return ['']
    }
    const text = argv[index + 1]
    if (!text) {
        throw new Error('--filter needs a text')
    }
    return text
        .toLowerCase()
        .split('|')
        .map(part => part.trim())
        .filter(part => part.length > 0)
}

function runScenarios(filters: string[]): ScenarioResult[] {
    return [
        ...SCENARIOS,
        ...TORPOR_SCENARIOS,
        ...COST_SCENARIOS,
        ...DECLARE_SCENARIOS,
        ...FAR_MASTERY_SCENARIOS,
        ...CARD_SCENARIOS,
        ...HUMAN_DAMAGE_SCENARIOS,
        ...BOUNCE_SCENARIOS,
        ...HUMAN_ACTION_SCENARIOS,
        ...MASTER_SCENARIOS,
        ...CATALOG_SCENARIOS,
        ...BRUJAH_SCENARIOS,
        ...BRUJAH_COMBAT_SCENARIOS,
        ...BRUJAH_ACTION_SCENARIOS,
        ...BRUJAH_REACTION_SCENARIOS,
        ...WARRENS_SCENARIOS,
        ...ANIMALISM_REACTION_SCENARIOS,
        ...CATS_GUIDANCE_SCENARIOS,
        ...EVENT_SCENARIOS,
        ...ALINE_SCENARIOS,
        ...NOSFERATU_SCENARIOS,
        ...LABYRINTH_SCENARIOS,
        ...KRCG_SCENARIOS,
        ...CROWS_SCENARIOS,
        ...ATTACHMENT_SCENARIOS,
        ...PUT_ON_SCENARIOS,
        ...GUARDIAN_ANGEL_SCENARIOS,
        ...UTILITY_SCENARIOS,
        ...SUMMARY_SCENARIOS,
        ...ASSESSMENT_SCENARIOS,
        ...PLAN_SCENARIOS,
        ...BLOAT_SCENARIOS,
        ...COMBAT_MODEL_SCENARIOS,
        ...COMBAT_POSITION_SCENARIOS,
        ...COMBAT_PLAN_SCENARIOS,
        ...LIVE_COMBAT_SCENARIOS,
        ...BLOCK_SCENARIOS,
        ...REACTION_SCENARIOS,
        ...MODIFIER_SCENARIOS,
        ...CARD_ACTION_SCENARIOS,
        ...INFLUENCE_SCENARIOS,
        ...INFLUENCE_VALUE_SCENARIOS,
        ...MASTER_PHASE_SCENARIOS,
    ]
        .filter(({ name }) => filters.some(filter => name.toLowerCase().includes(filter)))
        .map(({ name, run }) => {
            try {
                run()
                return { name, error: null }
            } catch (error) {
                return { name, error: error instanceof Error ? error.message : String(error) }
            } finally {
                createdGames.splice(0).forEach(gameState => deleteGameState(gameState.gameId))
            }
        })
}

registerLogger({
    captureException: error => console.error(error),
    captureMessage: message => console.warn(message),
})

await initWasmHasher()

setGameResources('cardbase', JSON.parse(readFileSync('public/assets/cardbase.json', 'utf-8')))

registerSyncMutationTrigger()

const results = runScenarios(parseFilter(process.argv.slice(2)))

if (results.length == 0) {
    console.error('No scenario matches the filter')
    process.exit(1)
}

for (const { name, error } of results) {
    console.log(`${error ? 'FAIL' : 'ok  '} ${name}${error ? `\n       ${error}` : ''}`)
}

const failures = results.filter(result => result.error)

console.log(`\n${results.length} scenarios, ${failures.length} failures`)

process.exit(failures.length > 0 ? 1 : 0)
