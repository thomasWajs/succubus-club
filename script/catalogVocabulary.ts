// Prints the vocabulary the card catalog is written in, so a card can be described without
// reading types.ts and builders.ts in full: the plays, conditions and effects ( from
// src/shared/cardImpl/catalog/types.ts ), the events ( src/shared/state/events.ts ) and the
// builders ( catalog/builders.ts ), each with the comment above it and the cards that use it.
//
// Run from the repo root:
//   npm run catalog:vocab                    everything
//   npm run catalog:vocab -- lock            only the entries mentioning the text ( name, fields, comment )
//   npm run catalog:vocab -- --cards         the cards already in the catalog, with their kinds
//
// The usage counts are by name over the whole catalog: 'intercept' is the same name in modifiers,
// reactions and attached cards, so the three show the same count. For the builders they are
// approximate ( a word match in the card files ).

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { CARD_DEFS } from '@/shared/cardImpl/catalog/index.ts'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const CATALOG_DIR = resolve(ROOT, 'src/shared/cardImpl/catalog')
const EVENTS_FILE = resolve(ROOT, 'src/shared/state/events.ts')
const DISCRIMINANTS = ['type', 'kind', 'activate']
// The events are not in the cards under a discriminant but as the `on` of a trigger
const USAGE_PROPERTIES = [...DISCRIMINANTS, 'on']
const EXAMPLES = 3

type Source = { file: ts.SourceFile; lines: string[] }
type Alias = { node: ts.TypeAliasDeclaration; source: Source }
type Variant = { discriminant: string; key: string; fields: string[]; comment: string }
type Entry = { family: string; text: string; usage: string }

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

function readSource(path: string): Source {
    const text = readFileSync(path, 'utf8')
    return {
        file: ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true),
        lines: text.split('\n'),
    }
}

// The comment lines directly above the line a node starts on
function commentAbove(source: Source, node: ts.Node): string {
    const line = source.file.getLineAndCharacterOfPosition(node.getStart()).line
    const parts: string[] = []
    for (let i = line - 1; i >= 0; i--) {
        const text = source.lines[i].trim()
        if (!text.startsWith('//')) {
            break
        }
        parts.unshift(text.replace(/^\/\/\s?/, ''))
    }
    return parts.join(' ')
}

function loadAliases(source: Source): Map<string, Alias> {
    const aliases = new Map<string, Alias>()
    for (const statement of source.file.statements) {
        if (ts.isTypeAliasDeclaration(statement)) {
            aliases.set(statement.name.text, { node: statement, source })
        }
    }
    return aliases
}

function literalValue(node: ts.TypeNode | undefined): string | null {
    return node && ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal) ?
            node.literal.text
        :   null
}

function literalVariant(
    node: ts.TypeLiteralNode,
    source: Source,
    fallback: ts.Node | null,
): Variant {
    const variant: Variant = {
        discriminant: '',
        key: '',
        fields: [],
        comment: commentAbove(source, node) || (fallback ? commentAbove(source, fallback) : ''),
    }
    for (const member of node.members) {
        if (!ts.isPropertySignature(member) || !member.type) {
            continue
        }
        const name = member.name.getText()
        const value = literalValue(member.type)
        if (!variant.key && value !== null && DISCRIMINANTS.includes(name)) {
            variant.discriminant = name
            variant.key = value
            continue
        }
        variant.fields.push(
            `${name}${member.questionToken ? '?' : ''}: ${squash(member.type.getText())}`,
        )
    }
    return variant
}

function merge(a: Variant, b: Variant): Variant {
    return {
        discriminant: a.discriminant || b.discriminant,
        key: a.key || b.key,
        fields: [...a.fields, ...b.fields],
        // The comment of the part that names the shape, not that of a shared set of fields
        comment:
            b.key ? b.comment
            : a.key ? a.comment
            : a.comment || b.comment,
    }
}

// The variants a type is made of: the members of a union, the literals behind a reference, the
// merge of an intersection. `visited` gets the aliases reached on the way.
function expand(
    node: ts.TypeNode,
    source: Source,
    fallback: ts.Node | null,
    aliases: Map<string, Alias>,
    visited: Set<string>,
): Variant[] {
    if (ts.isParenthesizedTypeNode(node)) {
        return expand(node.type, source, fallback, aliases, visited)
    }
    if (ts.isUnionTypeNode(node)) {
        return node.types.flatMap(type => expand(type, source, null, aliases, visited))
    }
    if (ts.isTypeLiteralNode(node)) {
        return [literalVariant(node, source, fallback)]
    }
    if (ts.isLiteralTypeNode(node)) {
        return [{ discriminant: '', key: node.getText(), fields: [], comment: '' }]
    }
    if (ts.isTypeReferenceNode(node)) {
        const name = node.typeName.getText()
        const alias = aliases.get(name)
        if (!alias || alias.node.typeParameters) {
            return []
        }
        visited.add(name)
        return expand(alias.node.type, alias.source, alias.node, aliases, visited)
    }
    if (ts.isIntersectionTypeNode(node)) {
        const empty: Variant = { discriminant: '', key: '', fields: [], comment: '' }
        return node.types
            .map(type => expand(type, source, fallback, aliases, visited))
            .reduce<
                Variant[]
            >((merged, part) => merged.flatMap(a => part.map(b => merge(a, b))), [empty])
    }
    return []
}

// How many cards use each discriminant value, and which ones
function countUsage(): Map<string, Set<string>> {
    const usage = new Map<string, Set<string>>()
    const walk = (value: unknown, card: string): void => {
        if (Array.isArray(value)) {
            value.forEach(item => walk(item, card))
        } else if (typeof value == 'object' && value !== null) {
            const record = value as Record<string, unknown>
            for (const property of USAGE_PROPERTIES) {
                const found = record[property]
                if (typeof found == 'string') {
                    const key = `${property}=${found}`
                    usage.set(key, (usage.get(key) ?? new Set()).add(card))
                }
            }
            Object.values(record).forEach(item => walk(item, card))
        }
    }
    for (const def of CARD_DEFS) {
        walk(def, def.name)
    }
    return usage
}

function describeUsage(cards: Set<string> | undefined): string {
    if (!cards || cards.size == 0) {
        return 'unused'
    }
    const examples = [...cards].slice(0, EXAMPLES).join(', ')
    return `${cards.size} card${cards.size > 1 ? 's' : ''}: ${examples}${cards.size > EXAMPLES ? ', ...' : ''}`
}

function describeVariant(
    variant: Variant,
    usage: Map<string, Set<string>>,
    usageProperty: string | undefined,
): Entry {
    const fields = variant.fields.length > 0 ? ` { ${variant.fields.join('; ')} }` : ''
    const property = usageProperty ?? variant.discriminant
    const used = property ? describeUsage(usage.get(`${property}=${variant.key}`)) : ''
    return {
        family: '',
        text: `${variant.key}${fields}`,
        usage: [variant.comment, used].filter(Boolean).join('   '),
    }
}

// The families ( unions of data shapes ) and records of one file of types
function typeEntries(
    aliases: Map<string, Alias>,
    only: string[] | null,
    usage: Map<string, Set<string>>,
    usageProperty?: string,
): Entry[] {
    const expansions = new Map<string, Variant[]>()
    const reached = new Set<string>()
    for (const [name, alias] of aliases) {
        if (only && !only.includes(name)) {
            continue
        }
        const visited = new Set<string>()
        const variants = expand(alias.node.type, alias.source, alias.node, aliases, visited)
        if (variants.length > 0) {
            expansions.set(name, variants)
            visited.forEach(other => reached.add(other))
        }
    }

    const entries: Entry[] = []
    for (const [name, variants] of expansions) {
        // A record reached through a family is printed there
        if (reached.has(name) && variants.length == 1) {
            continue
        }
        const alias = aliases.get(name)
        const type = alias?.node.type
        if (alias && type && ts.isIntersectionTypeNode(type) && variants.length > 1) {
            entries.push({ family: name, text: `${name} = ${squash(type.getText())}`, usage: '' })
            continue
        }
        const discriminant = variants.find(variant => variant.discriminant)?.discriminant
        const family = discriminant ? `${name} ( by ${discriminant} )` : name
        for (const variant of variants) {
            const entry = describeVariant(variant, usage, usageProperty)
            const text = variant.key ? entry.text : `${name}${entry.text}`
            entries.push({ ...entry, text, family })
        }
    }
    return entries
}

function stripImportsAndComments(text: string): string {
    return text.replace(/import\s*\{[^}]*\}\s*from[^\n]*\n/g, '').replace(/^\s*\/\/.*$/gm, '')
}

function builderEntries(): Entry[] {
    const source = readSource(resolve(CATALOG_DIR, 'builders.ts'))
    const cardsDir = resolve(CATALOG_DIR, 'cards')
    const cardsText = readdirSync(cardsDir)
        .filter(file => file.endsWith('.ts'))
        .map(file => stripImportsAndComments(readFileSync(resolve(cardsDir, file), 'utf8')))
        .join('\n')
    const count = (name: string, call: boolean) =>
        (cardsText.match(new RegExp(`\\b${name}${call ? '\\(' : '\\b'}`, 'g')) ?? []).length

    const entries: Entry[] = []
    for (const statement of source.file.statements) {
        const comment = commentAbove(source, statement)
        let name = ''
        let text = ''
        let call = false
        if (ts.isFunctionDeclaration(statement) && statement.name) {
            name = statement.name.text
            call = true
            const returns = statement.type ? `: ${squash(statement.type.getText())}` : ''
            text = `${name}(${statement.parameters.map(parameter => squash(parameter.getText())).join(', ')})${returns}`
        } else if (ts.isVariableStatement(statement)) {
            const declaration = statement.declarationList.declarations[0]
            if (!declaration || !ts.isIdentifier(declaration.name)) {
                continue
            }
            name = declaration.name.text
            text = declaration.type ? `${name}: ${squash(declaration.type.getText())}` : name
        } else {
            continue
        }
        if (name == 'defineCard' || name == 'defineCrypt') {
            entries.push({ family: 'Builders', text, usage: comment })
            continue
        }
        const used = count(name, call)
        entries.push({
            family: 'Builders',
            text,
            usage: [comment, used > 0 ? `${used} use${used > 1 ? 's' : ''} in the cards` : 'unused']
                .filter(Boolean)
                .join('   '),
        })
    }
    return entries
}

function printCards(): void {
    const rows = CARD_DEFS.map(def => {
        const kinds = [...new Set(def.plays.map(play => play.kind))]
        return `${def.name} (${def.id}) ${def.crypt ? 'crypt' : kinds.join('+')}`
    }).sort((a, b) => a.localeCompare(b))
    console.log(rows.join('\n'))
    console.log(`${rows.length} cards`)
}

function printEntries(entries: Entry[], filter: string): void {
    const wanted = filter.toLowerCase()
    let family = ''
    let printed = 0
    for (const entry of entries) {
        const haystack = `${entry.family} ${entry.text} ${entry.usage}`.toLowerCase()
        if (wanted && !haystack.includes(wanted)) {
            continue
        }
        if (entry.family != family) {
            family = entry.family
            console.log(`\n== ${family} ==`)
        }
        console.log(`  ${entry.text}`)
        if (entry.usage) {
            console.log(`      ${entry.usage}`)
        }
        printed++
    }
    if (printed == 0) {
        console.log(`Nothing in the vocabulary mentions '${filter}'`)
    }
}

const args = process.argv.slice(2)
if (args.includes('--cards')) {
    printCards()
} else {
    const usage = countUsage()
    const typesAliases = loadAliases(readSource(resolve(CATALOG_DIR, 'types.ts')))
    const eventAliases = loadAliases(readSource(EVENTS_FILE))
    const entries = [
        ...typeEntries(typesAliases, null, usage),
        ...typeEntries(eventAliases, ['GameEvent'], usage, 'on').map(entry => ({
            ...entry,
            family: 'Events ( announced by the engine, the `on` of a Trigger )',
        })),
        ...builderEntries(),
    ]
    printEntries(entries, args.filter(arg => !arg.startsWith('--')).join(' '))
}
