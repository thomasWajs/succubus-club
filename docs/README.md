# Succubus Club Knowledge Base

This directory documents the project architecture, runtime flows, and development practices for current and future contributors.

## Contents

- [Architecture Overview](./architecture.md): application structure, frameworks, runtime modes, and key module responsibilities.
- [Runtime Flows](./runtime-flows.md): startup, game launch, multiplayer synchronization, persistence, and deployment flows.
- [Harness and Spec-Driven Development](./harness-and-spec-development.md): practical guidance for adding test harnesses and evolving the project toward executable specs.

## How To Use These Docs

Start with the architecture overview when onboarding or planning a cross-cutting change. Use the runtime-flow diagrams when changing multiplayer, persistence, or game-state mutation behavior. Use the harness guide before introducing tests, scenario runners, or new spec documents.

These docs describe the code as it exists today. When changing architecture or runtime contracts, update the relevant diagram and the related source references in the same change.
