# Coding Guidelines for Succubus Club

This document provides essential guidelines for AI agents and developers working in this repository.
It covers project structure, coding standards, and commands for linting.

---

## 1. Project Overview
Succubus Club is a TCG (Trading Card Game) web platform for playing V:TES in a browser.
Multiplayer connection can be made either directly between clients through ably (Ably mode),
or with an authoritative central server ("Succubus Club Server" ==> SCS mode).

- **Root**: Configuration files (Vite, ESLint, TypeScript).
- **src/client**: Browser client: Vue 3 + Phaser 3 + Phavuer game.
- **src/server**: Server for SCS Mode: Node.js + WebSocket game server (using `ws`).
- **src/shared**: Shared logic, models, and constants used by both client and server.

## 2. General Rules
- **Line Endings**: Always use LF line endings (never CRLF).
- **Emojis**: NEVER use emojis in the codebase.

## 3. JavaScript & TypeScript
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

## 4. Vue.js (Composition API)
- **API**: Use strictly the `<script setup>` syntax with Composition API.
- **Components**:
  - Use `PascalCase` for Vue component names (e.g., `TopBar.vue`).
  - Use self-closing tags for components without content (e.g., `<UserAvatar />`).
- **Types**: Ensure proper type definitions for props and emits.

## 5. Phaser/Vue Integration
- **GameObjects**:
  - Prefer Phavuer GameObjects components (e.g., `<Image />`, `<Rectangle />`, `<Text />`) over vanilla Phaser GameObjects.
  - Phavuer components should be used within `.vue` files in `src/client/game/objects`.

## 6. CSS / SCSS
- **Syntax**: Use Sass/SCSS syntax.
- **Responsiveness**: DO NOT write responsive CSS. This app is desktop-only.
- **Layout**: Use CSS Grid or Flexbox. Avoid floats.
- **Organization**: Group styles by feature/component in the `src/client/styles` directory or within Vue SFCs.
- **Constraints**:
  - DO NOT use `border-radius` (no round borders).
  - DO NOT use `box-shadow`.
  - Avoid `!important` declarations.

## 7. Lint, Format, and Type-Check Commands
Commands are managed via `npm`. Run these from the project root.

- **Type Checking**: `npm run type:check`
- **ESLint Linting**:
  - `npm run lint:check` (Report errors)
  - `npm run lint:fix` (Auto-fix errors)
- **Prettier Formatting**:
  - `npm run format:check` (Report errors)
  - `npm run format:fix` (Auto-fix errors)

## 8. Testing
- **Test Suite**: Currently, there is no automated test suite configured in the repository.
- **Live-testing**: Do not try to start vite, SCS server, or validate in-browser rendering (playwright or such other tools).
- **Code Quality**: When changes are made, use `npm run lint:check` and `npm run format:check` to ensure correct formatting.

## 9. AI Agent Specific Tips
- **Context**: Use the `src/shared` folder to understand the game model and logic.
- **Game Objects**: Use components in `src/client/game/objects` as templates (e.g., `CardGO.vue`).
- **State Management**: Client-side, use Pinia stores located in `src/client/store` to manage the game state.

## 10. Code Style Reference
Follow the existing patterns in the codebase:
- Export shared logic to `@/shared`.

---
*End of Document*
