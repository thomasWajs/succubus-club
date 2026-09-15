import { acceptHMRUpdate, defineStore } from 'pinia'
import { CHAT_LANGUAGES, DEFAULT_CHAT_LANGUAGE } from '@/shared/const/languages.ts'

// The player's preferred language, shared by the lobby chat tabs and the player
// availability calendar. Persisted to localStorage so it survives reloads : both
// features read and write the same key, so switching language in one reflects in
// the other.

const LANGUAGE_STORAGE_KEY = 'lobby-chat-language'

function loadStoredLanguage(): string {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored && CHAT_LANGUAGES.some(language => language.code === stored)) {
        return stored
    }
    return DEFAULT_CHAT_LANGUAGE
}

export const useLanguagePreferenceStore = defineStore('languagePreference', {
    state: () => ({
        language: loadStoredLanguage(),
    }),
    actions: {
        setLanguage(language: string) {
            if (!CHAT_LANGUAGES.some(entry => entry.code === language)) {
                return
            }
            this.language = language
            localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
        },
    },
})

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useLanguagePreferenceStore, import.meta.hot))
}
