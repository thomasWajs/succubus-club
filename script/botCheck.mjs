// Runs the bot scenarios and several harness configurations in parallel. Run from the repo root:
//   npm run bot:check            quick tier (after each step): scenarios + 15 games at 2 to 5 players
//   npm run bot:check -- --full  full tier (end of a phase): scenarios + 100 games at 2 to 5 players
//   npm run bot:check -- --filter text   only the scenarios whose name contains the text, no harness
// Exits with code 1 if any job fails.
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const full = args.includes('--full')
const filterIndex = args.indexOf('--filter')
const filter = filterIndex >= 0 ? args[filterIndex + 1] : null

const games = full ? 100 : 15
const harness = (players, agents, deck = 'govern') => ({
    name: `harness ${players}p ${agents}${deck == 'govern' ? '' : ` ${deck}`}`,
    args: [
        'script/botHarness.mjs',
        '--games',
        String(games),
        '--players',
        String(players),
        '--agents',
        agents,
        '--deck',
        deck,
    ],
})

const jobs =
    filter ?
        [{ name: 'scenarios', args: ['script/botScenarios.ts', '--filter', filter] }]
    :   [
            { name: 'scenarios', args: ['script/botScenarios.ts'] },
            { name: 'catalog', args: ['script/catalogCheck.ts'] },
            harness(2, 'govern,random'),
            harness(3, 'govern,random'),
            harness(4, 'govern,random'),
            harness(5, 'govern'),
            harness(3, 'random', 'malkav'),
            harness(3, 'random', 'brujah'),
            harness(3, 'random', 'attach'),
            harness(3, 'random', 'postblock'),
            ...(full ? [harness(4, 'random')] : []),
        ]

function run(job) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, ['--import', 'tsx', ...job.args], {
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        let output = ''
        child.stdout.on('data', chunk => (output += chunk))
        child.stderr.on('data', chunk => (output += chunk))
        child.on('close', code => resolve({ job, code, output }))
    })
}

const startTime = performance.now()
const results = await Promise.all(jobs.map(run))
let failed = false
for (const { job, code, output } of results) {
    const lines = output.trim().split('\n')
    if (code == 0) {
        console.log(
            `ok   ${job.name}: ${lines.findLast(line => /scenarios|games of|cards checked/.test(line))}`,
        )
    } else {
        failed = true
        const problems = lines.filter(line => !line.startsWith('ok ') && !line.startsWith('game '))
        console.log(`FAIL ${job.name}\n${problems.join('\n')}`)
    }
}
console.log(
    `\n${full ? 'full' : 'quick'} check in ${((performance.now() - startTime) / 1000).toFixed(1)}s`,
)
process.exit(failed ? 1 : 0)
