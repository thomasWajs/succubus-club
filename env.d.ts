/// <reference types="vite/client" />

declare const ATLAS_TEXTURE_HASH: string
declare const ATLAS_JSON_HASH: string

interface ImportMetaEnv {
    readonly VITE_NODE_ENV: string

    readonly VITE_SENTRY_DSN?: string
    readonly SENTRY_HOST?: string
    readonly SENTRY_PROJECT_IDS?: string

    readonly VITE_FAST_TRACK_MULTIPLAYER?: string
    readonly VITE_FAST_TRACK_TRAIN_GAME?: string
    readonly VITE_DISABLE_WELCOME_MODAL?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
