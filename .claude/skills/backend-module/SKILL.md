---
name: backend-module
description: How to add or change a feature module in apps/api. Load before creating a module, an adapter to an external service, or a new endpoint.
---

# Backend module

Layout (`apps/api/src/modules/<name>/`):
- `index.ts`: the only public surface. Exports the service factory, route registration, and types.
- `<name>.schema.ts`: zod schemas for inputs/outputs; export inferred types.
- `<name>.service.ts`: business logic. Takes dependencies as arguments (`createXService({ routing, llm })`), no global singletons, no `process.env`.
- `<name>.routes.ts`: Hono routes. Parse input with the schema, call the service, map errors to HTTP. No logic here.
- `<name>.adapter.ts` (optional): interface + implementation for an external service (routing engine, LLM, elevation API). Keep a fake for tests.
- `<name>.test.ts`: Vitest, against the service with fake adapters.

Rules:
- Modules talk through each other's `index.ts` only; shared types that cross apps go to `packages/shared`.
- Errors: throw typed domain errors from services; routes translate them. Never leak provider errors or stack traces to clients.
- Every external call has a timeout and is abortable; cache pure, expensive lookups (geocoding, elevation) by input key.
- Wire the module in `apps/api/src/app.ts`, with dependencies built from `config.ts`.
