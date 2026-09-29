# find_my_path_v2

Web app that turns a natural-language request ("60 km gravel loop from Annecy, avoid main roads, one big climb") into a cycling route the user can preview on a map and download as GPX.

Features come from the owner, one at a time. Don't build ahead of the ask.

## Default stack (until the owner says otherwise)
- TypeScript everywhere, strict mode. pnpm workspaces monorepo.
- `apps/web`: Next.js (App Router, RSC by default), Tailwind CSS v4 with our own tokens, Radix primitives for behavior. Map: MapLibre GL.
- `apps/api`: Hono on Node. Feature modules, see below.
- `packages/*`: shared code only when two apps need it (`packages/shared` for types + zod schemas).
- Tests: Vitest (unit), Playwright (e2e, only for critical flows).
- LLM behind an adapter, structured output parsed with zod: a free local model via Ollama by default, Claude API (`@anthropic-ai/sdk`) as the paid option. Routing: self-hosted BRouter behind an adapter.
- Local run and future hosting: the same `docker compose` (web, api, brouter, ollama).

## Architecture rules
- Pipeline: NL query → `RouteIntent` (validated zod object) → routing adapter → track → GPX. Each step is a pure-ish module with a typed contract; the LLM never produces coordinates or GPX directly.
- Backend modules live in `apps/api/src/modules/<name>/` and expose only `index.ts`. No cross-module deep imports. External services go behind an interface in the module (`*.adapter.ts`) so they can be swapped and faked in tests.
- Validate at the edges (HTTP input, LLM output, third-party responses) with zod; trust types inside.
- Config from env via one typed `config.ts` per app. Never commit secrets; `.env*` stays local.
- Frontend: server components by default, `"use client"` only where interaction needs it. Keep map code client-only and lazy-loaded.

## UI
Aim for a calm, crafted product, not a template. Before any UI work, load the `ui-craft` skill.

## Working conventions
- Small PRs, one concern each. Conventional commit prefixes (`feat:`, `fix:`, `chore:`…).
- Before calling work done: `pnpm lint && pnpm typecheck && pnpm test` (once those scripts exist).
- New backend module: load the `backend-module` skill.
- Prefer editing existing files over adding new ones; no speculative abstractions, no dead code, no comments that restate code.
- Don't read lockfiles, build output or `node_modules`; search with ripgrep and read only the lines you need.
