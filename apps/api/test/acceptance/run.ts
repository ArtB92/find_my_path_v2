/**
 * Runs every acceptance query against a running app and checks what was read, the route, and the
 * 10-second promise. Needs the real stack: docker compose up (or pnpm dev with BRouter and Ollama).
 *   pnpm test:acceptance [base URL, default http://localhost:3000/api] [text filter]
 */
import type { ApiError, Compass, LatLon, ParseResponse, PlaceRef, Route, RouteIntent } from "@find-my-path/shared";
import { CASES, type AcceptanceCase } from "./queries";

const BASE = process.argv[2] ?? "http://localhost:3000/api";
const FILTER = process.argv[3]?.toLowerCase();
const LIMIT_MS = 10_000;
const TOLERANCE = { distance: 0.1, elevation: 0.2, elevationMinM: 60 };
const COMPASS_DEG: Record<Compass, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

class RequestFailed extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as T | ApiError;
  if (!res.ok) throw new RequestFailed((json as ApiError).error.code, (json as ApiError).error.message);
  return json as T;
}

function haversineKm(a: LatLon, b: LatLon) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

const closestKm = (route: Route, p: LatLon) => Math.min(...route.track.map(([lon, lat]) => haversineKm(p, { lat, lon })));
const placeText = (ref: PlaceRef | null) => (ref === null ? null : ref.type === "pin" ? `pin:${ref.label}` : ref.text);
const has = (text: string | null, name: string) => text !== null && text.toLowerCase().includes(name.toLowerCase());

function checkReading(intent: RouteIntent, reads: NonNullable<AcceptanceCase["reads"]>): string[] {
  const problems: string[] = [];
  const expect = (ok: boolean, what: string, got: unknown) => ok || problems.push(`read ${what} as ${JSON.stringify(got)}`);
  if (reads.start !== undefined) expect(has(placeText(intent.start), reads.start), "start", placeText(intent.start));
  if (reads.end !== undefined) expect(reads.end === null ? intent.end === null : has(placeText(intent.end), reads.end), "end", placeText(intent.end));
  const vias = intent.via.map((v) => placeText(v.place));
  for (const name of reads.via ?? []) expect(vias.some((v) => has(v, name)), `via ${name}`, vias);
  const avoided = intent.avoid.map(placeText);
  for (const name of reads.avoid ?? []) expect(avoided.some((a) => has(a, name)), `avoid ${name}`, avoided);
  for (const key of ["distanceKm", "elevationGainM", "direction", "bike", "outAndBack"] as const) {
    if (reads[key] !== undefined) expect(intent[key] === reads[key], key, intent[key]);
  }
  return problems;
}

function checkRoute(route: Route, c: AcceptanceCase): string[] {
  const problems: string[] = [];
  const { distanceKm, elevationGainM } = route.targets;
  if (route.missed && !c.mayMiss) problems.push(`missed the request: ${route.missed}`);
  if (!c.mayMiss && distanceKm !== null && Math.abs(route.distanceM / 1000 - distanceKm) > TOLERANCE.distance * distanceKm) {
    problems.push(`${(route.distanceM / 1000).toFixed(0)} km instead of ${distanceKm} km`);
  }
  if (!c.mayMiss && elevationGainM !== null && Math.abs(route.ascentM - elevationGainM) > Math.max(TOLERANCE.elevation * elevationGainM, TOLERANCE.elevationMinM)) {
    problems.push(`${route.ascentM} m of climbing instead of ${elevationGainM} m`);
  }
  for (const p of c.passes ?? []) {
    const km = closestKm(route, p);
    if (km > (p.nearKm ?? 1.5)) problems.push(`passes ${km.toFixed(1)} km from ${p.name}`);
  }
  for (const p of c.avoids ?? []) {
    const km = closestKm(route, p);
    if (km < 1) problems.push(`goes within ${km.toFixed(1)} km of ${p.name}`);
  }
  if (c.heads) {
    const start = route.waypoints[0]!;
    const far = route.track.reduce((a, b) => (haversineKm(start, { lat: b[1], lon: b[0] }) > haversineKm(start, { lat: a[1], lon: a[0] }) ? b : a));
    const x = (far[0] - start.lon) * Math.cos((start.lat * Math.PI) / 180);
    const bearing = ((Math.atan2(x, far[1] - start.lat) * 180) / Math.PI + 360) % 360;
    const off = Math.abs(((bearing - COMPASS_DEG[c.heads] + 540) % 360) - 180);
    if (off > 60) problems.push(`heads ${bearing.toFixed(0)}° instead of ${c.heads}`);
  }
  return problems;
}

async function run(c: AcceptanceCase): Promise<{ ok: boolean; line: string }> {
  const pins = c.pins ?? [];
  const started = performance.now();
  const seconds = () => ((performance.now() - started) / 1000).toFixed(1);
  let problems: string[] = [];
  let summary = "";
  try {
    const { intent } = await post<ParseResponse>("intent", { query: c.query, pins });
    problems = c.reads ? checkReading(intent, c.reads) : [];
    const route = await post<Route>("routes", { intent, pins });
    summary = `${(route.distanceM / 1000).toFixed(0)} km, ${route.ascentM} m up${route.missed ? " (closest found)" : ""}`;
    problems.push(...checkRoute(route, c));
    if (c.fails) problems.push(`expected ${c.fails}, got a route`);
  } catch (err) {
    if (!(err instanceof RequestFailed)) throw err;
    summary = `${err.code}: ${err.message}`;
    if (err.code !== c.fails) problems.push(c.fails ? `expected ${c.fails}` : "no route");
  }
  if (performance.now() - started > LIMIT_MS) problems.push(`took more than ${LIMIT_MS / 1000} s`);
  const ok = problems.length === 0;
  return { ok, line: `${ok ? "ok  " : "FAIL"} ${seconds().padStart(4)} s  ${c.query}\n            ${summary}${ok ? "" : `\n            ✗ ${problems.join("\n            ✗ ")}`}` };
}

const cases = CASES.filter((c) => !FILTER || c.query.toLowerCase().includes(FILTER));
let failures = 0;
for (const c of cases) {
  const { ok, line } = await run(c);
  if (!ok) failures++;
  console.log(line);
}
console.log(`\n${cases.length - failures}/${cases.length} acceptance queries pass`);
process.exitCode = failures ? 1 : 0;
