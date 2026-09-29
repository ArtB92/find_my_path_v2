// MapLibre runs its tile worker from a separate module file, which bundlers don't emit.
// Serve the package's own worker (and the chunk it imports) from /maplibre instead.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const dist = path.join(path.dirname(createRequire(import.meta.url).resolve("maplibre-gl/package.json")), "dist");
const out = path.join(import.meta.dirname, "..", "public", "maplibre");
mkdirSync(out, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(path.join(dist, file), path.join(out, file));
