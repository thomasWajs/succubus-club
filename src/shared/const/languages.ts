// The official chat languages. Each lobby chat channel is keyed by `code`.
// `shortName` is the compact tab label, `fullName` the description underneath.

export interface ChatLanguage {
    code: string
    shortName: string
    fullName: string
}

export const CHAT_LANGUAGES: ChatLanguage[] = [
    { code: 'en', shortName: 'EN', fullName: 'English' },
    { code: 'es', shortName: 'ES', fullName: 'Español' },
    { code: 'pt', shortName: 'PT/BR', fullName: 'Portuguese / Brazilian' },
    { code: 'fr', shortName: 'FR', fullName: 'Français' },
    { code: 'de', shortName: 'DE', fullName: 'Deutsch' },
    { code: 'it', shortName: 'IT', fullName: 'Italiano' },
    { code: 'fi', shortName: 'FI', fullName: 'Suomi' },
    { code: 'se', shortName: 'SE', fullName: 'Svensk' },
    { code: 'pl', shortName: 'PL', fullName: 'Polski' },
    { code: 'no', shortName: 'NO', fullName: 'Norsk' },
    { code: 'ne', shortName: 'NE', fullName: 'Nederlandse' },
]

export const DEFAULT_CHAT_LANGUAGE = 'en'
