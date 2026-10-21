# Coding Guidelines for Succubus Club

This document provides essential guidelines for AI agents and developers working in this repository.
It covers project structure, coding standards, and commands for linting.

---

## 1. Project Overview
Succubus Club is a TCG (Trading Card Game) web platform for playing V:TES in a browser.
This is its bots-only edition: one player against bots, every game run by the zero-vtes
rules engine on its server (`VITE_ENGINE_SERVER`, default `https://engine.krcg.org`), which
the client reads through the engine's protocol only (`src/client/engine/`). Decks and
preferences stay in the browser (IndexedDB).

- **Root**: Configuration files (Vite, ESLint, TypeScript).
- **src/client**: Browser client: Vue 3 + Phaser 3 + Phavuer game.
- **src/shared**: Game logic, models, and constants.

## 2. Architecture & Data Flow

### Game State & Mutations (`src/shared/state`)
- `gameState.ts` holds the authoritative game state. NEVER mutate it directly.
- All state changes go through `GameMutation` subclasses in `gameMutations.ts`. Trigger them via the mutation trigger registry (`getMutationTrigger().act(...)` / `.actSelf(...)` from `@/shared/registries.ts`), never by writing to state fields.
- `src/shared` stays environment-agnostic. It reaches the outside world only through the registries in `registries.ts` (logger, game resources, game state, mutation trigger), which the client registers at startup.
- In an engine game the table changes only through the engine: the user's moves are read as decisions (`src/client/engine/gestures.ts`), and the engine's answers are projected onto the table as mutations (`src/client/engine/driver.ts`).

### Client State Layer
- `src/client/state/` adapts the shared state for the browser (e.g. `dispatchMutation` in `gameMutations.ts`, `setup.ts`).
- `src/client/store/` holds the reactive Pinia stores (`gameState.ts`, `history.ts`, `engine.ts`, `core.ts`, `bus.ts`). Read reactive state from the stores, but change game state through mutations, not by writing to stores directly.

### Client Layout (`src/client`)
- `game/scenes/` — Phaser scenes (`Tabletop.vue`, `Preloader.vue`).
- `game/objects/` — Phavuer game objects on the tabletop (`CardGO.vue`, `RegionGO.vue`, ...).
- `ui/components/` — reusable UI components (modals, bars, avatars).
- `ui/screen/` — full screens (`MainMenu.vue`, `Game.vue`, `about/`).
- `ui/ingame/` — in-game UI overlays (right column, menus, buttons).
- `ui/context/` — context menus and floating actions.
- `engine/` — the engine client: the server's protocol (`api.ts`, `host.ts`), the driver, the table as its interface.
- `gateway/` — local storage (decks, preferences) and deck import.

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

## 8. Lint, Format, and Type-Check Commands
Commands are managed via `npm`. Run these from the project root.

- **Type Checking**: `npm run type:check`
- **ESLint Linting**:
  - `npm run lint:check` (Report errors)
  - `npm run lint:fix` (Auto-fix errors)
- **Prettier Formatting**:
  - `npm run format:check` (Report errors)
  - `npm run format:fix` (Auto-fix errors)

## 9. Testing
- **Test Suite**: Currently, there is no automated test suite configured in the repository.
- **Live-testing**: Do not try to start vite or validate in-browser rendering (playwright or such other tools).
- **Code Quality**: When changes are made, use `npm run lint:check` and `npm run format:check` to ensure correct formatting.

## 10. AI Agent Specific Tips
- **Context**: Use the `src/shared` folder to understand the game model and logic.
- **Game Objects**: Use components in `src/client/game/objects` as templates (e.g., `CardGO.vue`).
- **State Management**: Client-side, use Pinia stores located in `src/client/store` to manage the game state.

## 11. Code Style Reference
Follow the existing patterns in the codebase:
- Export shared logic to `@/shared`.

---
*End of Document*
