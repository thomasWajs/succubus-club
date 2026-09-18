// Type declarations for the plain-.mjs share helper, so type-checked client code can
// import from it ( mirrors src/shared/version.d.mts for version.mjs ). Only the exports
// the client consumes are declared here ; the Vercel api/*.mjs functions import the .mjs
// directly and are not type-checked.

export interface ShareTranslations {
    title: string
    description: string
    weekly: string
    biweekly: string
    monthly: string
    language: string
}

export function getTranslations(code: string): ShareTranslations

export function localeFor(code: string): string
