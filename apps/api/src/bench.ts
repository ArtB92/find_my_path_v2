/**
 * Times real requests end to end against a running app (docker compose up), to check the
 * 10-second promise on your own machine: pnpm bench [base URL, default http://localhost:3000/api]
 */
import type { ApiError, ParseResponse, Route } from "@find-my-path/shared";

const BASE = process.argv[2] ?? "http://localhost:3000/api";
const LIMIT_MS = 10_000;
const QUERIES = [
  "From Paris to Versailles",
  "From Versailles to Rambouillet via Saclay and Chevreuse",
  "80 km loop from Versailles",
  "80 km loop from Versailles with 500 m of climbing",
  "60 km loop from Versailles through the vallée de Chevreuse",
  "Build a nice loop start and from Asnières, about 100km long, going through Versailles",
  "build a route from Versailles to Paris, going through Poissy, avoiding Chatou",
  "build a loop from Asnières, going towards south west",
  "100 km loop from Asnières with 900 m of climbing",
  "je veux faire une boucle de 70 bornes depuis Rambouillet avec pas mal de dénivelé",
  "I want a hilly ride of about 2h30 from Meudon",
];

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as T | ApiError;
  if (!res.ok) throw new Error((json as ApiError).error.message);
  return json as T;
}

let failures = 0;
for (const query of QUERIES) {
  const started = performance.now();
  let line: string;
  try {
    const { intent } = await post<ParseResponse>("intent", { query, pins: [] });
    const parsedMs = performance.now() - started;
    const route = await post<Route>("routes", { intent, pins: [] });
    const totalMs = performance.now() - started;
    if (totalMs > LIMIT_MS) failures++;
    line = `${totalMs > LIMIT_MS ? "SLOW" : "ok  "} ${(totalMs / 1000).toFixed(1)} s (reading ${(parsedMs / 1000).toFixed(1)} s)  ${(route.distanceM / 1000).toFixed(0)} km, ${route.ascentM} m up`;
  } catch (err) {
    failures++;
    line = `FAIL ${((performance.now() - started) / 1000).toFixed(1)} s  ${(err as Error).message}`;
  }
  console.log(`${line}\n     ${query}`);
}
console.log(`\n${QUERIES.length - failures}/${QUERIES.length} routes within ${LIMIT_MS / 1000} s`);
process.exitCode = failures ? 1 : 0;
