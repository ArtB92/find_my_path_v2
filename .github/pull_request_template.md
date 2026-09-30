## What changes for the rider

Before:

After:

## How

## Checks

- [ ] `pnpm lint && pnpm typecheck && pnpm test`
- [ ] `pnpm test:acceptance` against the running stack (needed when reading requests, geocoding, routing or the planner change): all queries pass, each within 10 s
