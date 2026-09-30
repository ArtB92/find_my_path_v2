"use client";

import type { Pin, Route } from "@find-my-path/shared";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { parseQuery, planRoute, RequestError } from "@/lib/api";
import { emptyForm, formToIntent, intentToForm, type RouteForm } from "@/lib/form";
import { formatKm, formatM, ridingTime } from "@/lib/format";
import { routeName, toGpx } from "@/lib/gpx";
import { ElevationProfile } from "./elevation-profile";
import { RouteFormFields } from "./route-form";

const RouteMap = dynamic(() => import("./route-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-line/40" />,
});

type Phase = "idle" | "reading" | "routing";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const primaryButton =
  "brand-fill rounded-md px-4 py-2.5 text-sm font-medium shadow-sm transition-[filter,opacity] duration-150 ease-out hover:brightness-110 active:brightness-95 disabled:opacity-50 disabled:hover:brightness-100";

function download(route: Route) {
  const name = routeName(route);
  const url = URL.createObjectURL(new Blob([toGpx(route, name)], { type: "application/gpx+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}.gpx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Planner() {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<RouteForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [pins, setPins] = useState<Pin[]>([]);
  const [addingPin, setAddingPin] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [route, setRoute] = useState<Route | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  async function run(fromQuery: boolean) {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setError(null);
    try {
      let nextForm = form;
      let parseNotes: string[] = [];
      if (fromQuery) {
        setPhase("reading");
        const parsed = await parseQuery(query, pins, controller.signal);
        nextForm = intentToForm(parsed.intent);
        parseNotes = parsed.notes;
        setForm(nextForm);
      }
      const intent = formToIntent(nextForm);
      if (typeof intent === "string") {
        setShowForm(true);
        throw new RequestError(intent);
      }
      setPhase("routing");
      const planned = await planRoute(intent, pins, controller.signal);
      setRoute(planned);
      setHoverIndex(null);
      setNotes([...parseNotes, ...planned.notes]);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof RequestError ? err.message : "The route service is not reachable. Is the API running?");
      if (fromQuery && err instanceof RequestError) setShowForm(true);
    } finally {
      if (inFlight.current === controller) setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  const nextLetter = LETTERS.split("").find((l) => !pins.some((p) => p.label === l));

  return (
    <main className="flex h-dvh flex-col-reverse md:flex-row">
      <aside className="flex max-h-[60dvh] w-full shrink-0 flex-col overflow-y-auto border-line bg-paper md:max-h-none md:w-[400px] md:border-r">
        <div className="flex flex-col gap-6 p-5 md:p-6">
          <header className="border-b border-line pb-5">
            <div className="flex items-center gap-3">
              <svg viewBox="0 0 32 32" aria-hidden="true" className="size-9 shrink-0">
                <rect width="32" height="32" rx="7" fill="url(#logo-gradient)" />
                <defs>
                  <linearGradient id="logo-gradient" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="var(--brand-from)" />
                    <stop offset="1" stopColor="var(--brand-to)" />
                  </linearGradient>
                </defs>
                <path d="M7 22c4-9 7 2 11-6s5-6 7-4" fill="none" stroke="var(--brand-ink)" strokeWidth={3} strokeLinecap="round" />
                <circle cx="25" cy="12" r="2.5" fill="var(--brand-ink)" />
              </svg>
              <h1 className="brand-text font-display text-xl leading-none font-semibold tracking-tight">FindMyPath</h1>
            </div>
            <p className="mt-3 text-sm text-ink-2">Describe the ride. Get a route you can load on your bike computer.</p>
          </header>

          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim().length >= 3) void run(true);
            }}
          >
            <label htmlFor="query" className="text-xs font-medium text-ink-2">
              Your ride
            </label>
            <textarea
              id="query"
              rows={3}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="80 km loop from Versailles with 500 m of climbing"
              className="resize-none rounded-md border border-line bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-3 focus-visible:border-brand"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy || query.trim().length < 3}
                className={primaryButton}
              >
                {phase === "reading" ? "Reading…" : phase === "routing" ? "Finding the route…" : "Find a route"}
              </button>
              <button
                type="button"
                aria-pressed={addingPin}
                disabled={!nextLetter}
                onClick={() => setAddingPin((v) => !v)}
                className="rounded-md border border-line px-3 py-2.5 text-sm text-ink-2 transition-colors duration-150 hover:border-ink-3 disabled:opacity-50 aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand"
              >
                {addingPin ? "Click the map…" : `Add pin ${nextLetter ?? ""}`}
              </button>
            </div>
            {pins.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Pins">
                {pins.map((p) => (
                  <li key={p.label} className="flex items-center gap-1 rounded-sm border border-line bg-surface py-0.5 pr-1 pl-2 text-sm">
                    <span className="font-mono text-xs">Pin {p.label}</span>
                    <button
                      type="button"
                      aria-label={`Remove pin ${p.label}`}
                      className="rounded-sm px-1 text-ink-3 hover:text-ink"
                      onClick={() => setPins(pins.filter((x) => x.label !== p.label))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {pins.length > 0 && <p className="text-xs text-ink-3">Refer to pins in your ride: “loop from pin A through pin B”.</p>}
          </form>

          {error && (
            <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
              {error}
            </p>
          )}

          <section aria-live="polite" className="flex flex-col gap-4">
            {phase === "routing" && !route && <StatsSkeleton />}
            {route && (
              <div className={`flex flex-col gap-4 transition-opacity duration-200 ${phase === "routing" ? "opacity-50" : ""}`}>
                {route.missed && (
                  <p role="status" className="border-l-2 border-warn pl-3 text-sm text-warn">
                    {route.missed}
                  </p>
                )}
                <dl className="grid grid-cols-3 gap-3">
                  <Stat label="Distance" value={formatKm(route.distanceM)} target={route.targets.distanceKm !== null ? `${route.targets.distanceKm} km` : null} />
                  <Stat label="Climbing" value={formatM(route.ascentM)} target={route.targets.elevationGainM !== null ? `${route.targets.elevationGainM} m` : null} />
                  <Stat label="Riding time" value={ridingTime(route.distanceM, route.ascentM, route.bike)} />
                </dl>
                <div>
                  <h2 className="mb-2 text-xs font-medium text-ink-2">Elevation</h2>
                  <ElevationProfile track={route.track} hoverIndex={hoverIndex} onHover={setHoverIndex} />
                </div>
                {notes.length > 0 && (
                  <ul className="flex flex-col gap-1 text-sm text-ink-2">
                    {notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => download(route)}
                  className={`self-start ${primaryButton}`}
                >
                  Download GPX
                </button>
              </div>
            )}
          </section>

          <details open={showForm} onToggle={(e) => setShowForm(e.currentTarget.open)} className="border-t border-line pt-4">
            <summary className="cursor-pointer text-sm font-medium text-ink">Route settings</summary>
            <div className="pt-4">
              <RouteFormFields form={form} onChange={setForm} onSubmit={() => void run(false)} busy={busy} />
            </div>
          </details>
        </div>
      </aside>

      <div className="relative min-h-[40dvh] flex-1">
        <RouteMap
          route={route}
          pins={pins}
          addingPin={addingPin}
          hoverIndex={hoverIndex}
          onAddPin={(lat, lon) => {
            if (nextLetter) setPins([...pins, { label: nextLetter, lat, lon }]);
            setAddingPin(false);
          }}
          onMovePin={(label, lat, lon) => setPins((ps) => ps.map((p) => (p.label === label ? { ...p, lat, lon } : p)))}
        />
      </div>
    </main>
  );
}

function Stat({ label, value, target }: { label: string; value: string; target?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-2">{label}</dt>
      <dd className="font-mono text-lg font-medium tabular-nums">{value}</dd>
      {target && <dd className="font-mono text-xs text-ink-3">asked {target}</dd>}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="Finding the route">
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-sm bg-line/60" />
        ))}
      </div>
      <div className="h-[150px] animate-pulse rounded-sm bg-line/60" />
    </div>
  );
}
