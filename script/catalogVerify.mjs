// Closing check after describing cards: type check, eslint and prettier on the changed files only,
// the catalog check and the scenarios, all in parallel. Run from the repo root:
//   npm run catalog:verify                     scenarios of the whole suite
//   npm run catalog:verify -- --filter "A|B"   only the scenarios whose name contains A or B
// Exits with code 1 if any job fails.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const args = process.argv.slice(2)
const filterIndex = args.indexOf('--filter')
const filter = filterIndex >= 0 ? args[filterIndex + 1] : null

const git = (...gitArgs) =>
    execFileSync('git', gitArgs, { encoding: 'utf-8' })
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
const changed = [
    ...new Set([
        ...git('diff', '--name-only', 'HEAD'),
        ...git('ls-files', '-o', '--exclude-standard'),
    ]),
].filter(path => existsSync(path))
const linted = changed.filter(path => /\.(ts|vue|mjs|js)$/.test(path))
const formatted = changed.filter(path => /\.(ts|vue|mjs|js|json|scss)$/.test(path))

const jobs = [
    { name: 'type check', args: ['node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit'] },
    { name: 'catalog', args: ['--import', 'tsx', 'script/catalogCheck.ts'] },
    {
        name: 'scenarios',
        args: [
            '--import',
            'tsx',
            'script/botScenarios.ts',
            ...(filter ? ['--filter', filter] : []),
        ],
    },
]
if (linted.length > 0) {
    jobs.push({
        name: `eslint (${linted.length} files)`,
        args: ['node_modules/eslint/bin/eslint.js', ...linted],
    })
}
if (formatted.length > 0) {
    jobs.push({
        name: `prettier (${formatted.length} files)`,
        args: ['node_modules/prettier/bin/prettier.cjs', '--check', ...formatted],
    })
}

function run(job) {
    return new Promise(resolve => {
        const startTime = performance.now()
        const child = spawn(process.execPath, job.args, { stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''
        child.stdout.on('data', chunk => (output += chunk))
        child.stderr.on('data', chunk => (output += chunk))
        child.on('close', code =>
            resolve({ job, code, output, seconds: (performance.now() - startTime) / 1000 }),
        )
    })
}

const startTime = performance.now()
const results = await Promise.all(jobs.map(run))
let failed = false
for (const { job, code, output, seconds } of results) {
    if (code == 0) {
        console.log(`ok   ${job.name} (${seconds.toFixed(1)}s)`)
    } else {
        failed = true
        const lines = output.trim().split('\n')
        const problems =
            job.name == 'scenarios' ? lines.filter(line => !line.startsWith('ok ')) : lines
        console.log(`FAIL ${job.name}\n${problems.join('\n')}`)
    }
}
console.log(`\nverify in ${((performance.now() - startTime) / 1000).toFixed(1)}s`)
process.exit(failed ? 1 : 0)
