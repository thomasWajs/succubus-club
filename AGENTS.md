# Coding Guidelines for Succubus Club

This document provides essential guidelines for AI agents and developers working in this repository.
It covers project structure, coding standards, and commands for linting.

---

## 1. Project Overview
Succubus Club is a TCG (Trading Card Game) web platform for playing V:TES in a browser.
Multiplayer connection can be made either directly between clients through ably (Ably mode),
or with an authoritative central server ("Succubus Club Server" ==> SCS mode).

## 2. Architecture & Data Flow

### Game State & Mutations (`src/shared/state`)
- `gameState.ts` holds the authoritative game state. NEVER mutate it directly.
- All state changes go through `GameMutation` subclasses in `gameMutations.ts`. Trigger them via the mutation trigger registry (`getMutationTrigger().act(...)` / `.actSelf(...)` from `@/shared/registries.ts`), never by writing to state fields.
- `src/shared` must stay environment-agnostic (it runs on both client and server). It reaches the outside world only through the registries in `registries.ts` (logger, game resources, game state, mutation trigger), which the client and server each register at startup.

### Client State Layer
- `src/client/state/` adapts the shared state for the browser (e.g. `applyMutationLocally` in `gameMutations.ts`, `setup.ts`).
- `src/client/store/` holds the reactive Pinia stores (`gameState.ts`, `history.ts`, `multiplayer.ts`, `core.ts`, `bus.ts`). Read reactive state from the stores, but change game state through mutations, not by writing to stores directly.

### Multiplayer (`src/client/multiplayer`)
- Two interchangeable transports implement the `Communication` interface (`communication/index.ts`):
  - `communication/ably.ts` — Ably mode: peer-to-peer between clients, with client-side `encryption.ts`.
  - `communication/scs.ts` — SCS mode: authoritative "Succubus Club Server" (`src/server`).
- `sync.ts` broadcasts/receives `GameMutation`s and keeps clients consistent (vector/Lamport clocks, resync). Gameplay code should emit mutations and let this layer handle transport, not talk to Ably/SCS directly.

## 3. General Rules
- **Line Endings**: Always use LF line endings (never CRLF).
- **Emojis**: NEVER use emojis in the codebase.

## 4. JavaScript & TypeScript
- **Semicolons**: DO NOT use semicolons at the end of statements.
- **Variables**: Prefer `const` over `let`. Avoid `var`.
- **Types**:
  - NEVER use the `any` type. Define proper interfaces or types.
  - NEVER use the non-null assertion operator `!`. Use proper null checks.
- **Naming**:
  - Use `camelCase` for TypeScript files and variable names.
  - Use `PascalCase` for classes and interfaces.
- **Imports**:
  - Use absolute paths with the `@` alias (pointing to `src/`).
  - Use `.ts` or `.vue` extensions in imports where appropriate.
  - Example: `import { Card } from '@/shared/model/Card.ts'`
- **Shared logic**: Export logic used by both client and server to `@/shared`.

## 5. Vue.js (Composition API)
- **API**: Use strictly the `<script setup>` syntax with Composition API.
- **Components**:
  - Use `PascalCase` for Vue component names (e.g., `TopBar.vue`).
  - Use self-closing tags for components without content (e.g., `<UserAvatar />`).
- **Types**: Ensure proper type definitions for props and emits.

## 6. Phaser/Vue Integration
- **GameObjects**:
  - Prefer Phavuer GameObjects components (e.g., `<Image />`, `<Rectangle />`, `<Text />`) over vanilla Phaser GameObjects.
  - Phavuer components should be used within `.vue` files in `src/client/game/objects`.

## 7. CSS / SCSS
- **Syntax**: Use Sass/SCSS syntax.
- **Reuse**: Always try to re-use existing styling by harnessing `src/client/styles/_mixins.scss`, `src/client/styles/_variables.scss`, and `src/client/styles/_base.scss`. Extract common styles into those files where needed.
- **Responsiveness**: DO NOT write responsive CSS. This app is desktop-only.
- **Layout**: Use CSS Grid or Flexbox. Avoid floats.
- **Organization**: Group styles by feature/component in the `src/client/styles` directory or within Vue SFCs.
- **Constraints**:
  - DO NOT use `border-radius` on rectangles (no round borders).
  - DO NOT use `box-shadow`.
  - Avoid `!important` declarations.

## 8. Testing
- **Test Suite**: Currently, there is no automated test suite configured in the repository.
- **Live-testing**: Do not try to start vite, SCS server, or validate in-browser rendering (playwright or such other tools).
- **Code Quality**: When changes are made, use `npm run lint:check` and `npm run format:check` to ensure correct formatting.

---
*End of Document*
