# FindMyPath

Describe a bike ride in plain words ("80 km loop from Versailles with 500 m of climbing") and get a route on a map, its elevation profile, and a GPX file for Garmin, Strava or Komoot.

Coverage: Île-de-France for now; all of France later.

## Run it locally

Needs Docker. From the repo root:

```sh
docker compose up --build
```

Then open http://localhost:3000.

The first start downloads the routing data for Île-de-France (about 300 MB) and the local language model (about 2 GB). The app is up once the `api` container starts; later starts take seconds.

Optional settings (another model, Claude instead of the local model, a different port) go in a `.env` file: see `.env.example`.

## How it works

```
text ──► intent (start, finish, stops, places to avoid, direction, distance, climbing, bike)
            │  rules read common phrasings instantly; the local model (Ollama) or Claude
            │  only sees the rest; editable in "Route settings"
            ▼
places ──► coordinates        BAN address base + Photon (OpenStreetMap), typo tolerant
            ▼
planner ──► waypoints ──► BRouter (self-hosted bike routing, elevation included)
            │  loops: tries shapes in every direction (or the one asked), and loops
            │  over known climbs when climbing is asked; tunes their size to hit the
            │  distance, keeps out of avoided places, rejects roads ridden twice;
            │  stops searching after 6 s so a route comes back within 10 s
            ▼
route ──► map, elevation profile, GPX
```

- `apps/web`: Next.js page, MapLibre map, elevation profile, GPX export.
- `apps/api`: Hono API. Modules: `intent` (text to parameters), `geocoding`, `routing` (BRouter adapter), `climbs` (the climb index), `planner` (the route search).
- `packages/shared`: request and response types shared by both.
- `docker/brouter`: BRouter server image; downloads its routing tiles on first start.
- `tools/climbs` → `data/climbs`: every climb in the area (bottom, top, length, gain, grade), found offline from Overture Maps roads and Copernicus elevation. Rebuild with `docker compose run --rm climbs`.

A route that can't match the request within 10% on distance and 20% on climbing is refused with the closest match found, instead of returning something off target.

## Develop without Docker

```sh
pnpm install
pnpm dev          # web on :3000, api on :8787
pnpm lint && pnpm typecheck && pnpm test
```

`pnpm dev` expects BRouter on `localhost:17777` and Ollama on `localhost:11434` (for example `docker compose up brouter ollama`, with their ports published).
