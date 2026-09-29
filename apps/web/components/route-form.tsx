"use client";

import type { Bike } from "@find-my-path/shared";
import * as Switch from "@radix-ui/react-switch";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import type { ReactNode } from "react";
import type { RouteForm } from "@/lib/form";

interface Props {
  form: RouteForm;
  onChange: (form: RouteForm) => void;
  onSubmit: () => void;
  busy: boolean;
}

const BIKES: { value: Bike; label: string }[] = [
  { value: "road", label: "Road" },
  { value: "gravel", label: "Gravel" },
  { value: "trekking", label: "Hybrid" },
];

const inputClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus-visible:border-ink-2";

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-ink-2">
        {label}
      </label>
      {children}
    </div>
  );
}

export function RouteFormFields({ form, onChange, onSubmit, busy }: Props) {
  const set = <K extends keyof RouteForm>(key: K, value: RouteForm[K]) => onChange({ ...form, [key]: value });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Field label="Start" id="start">
        <input id="start" className={inputClass} value={form.start} onChange={(e) => set("start", e.target.value)} placeholder="Town, address or Pin A" />
      </Field>
      <label className="flex items-center justify-between text-sm text-ink">
        Loop back to the start
        <Switch.Root
          checked={form.loop}
          onCheckedChange={(v) => set("loop", v)}
          className="relative h-5 w-9 rounded-full bg-line transition-colors duration-150 data-[state=checked]:bg-moss"
        >
          <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-surface shadow transition-transform duration-150 ease-out data-[state=checked]:translate-x-[18px]" />
        </Switch.Root>
      </label>
      {!form.loop && (
        <Field label="Finish" id="end">
          <input id="end" className={inputClass} value={form.end} onChange={(e) => set("end", e.target.value)} placeholder="Town, address or Pin B" />
        </Field>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-ink-2">Pass through</legend>
        {form.via.map((v, i) => (
          <div key={i} className="flex gap-2">
            <input
              aria-label={`Stop ${i + 1}`}
              className={inputClass}
              value={v.text}
              onChange={(e) => set("via", form.via.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
              placeholder="Place, area or Pin B"
            />
            <select
              aria-label={`Stop ${i + 1} type`}
              className="rounded-md border border-line bg-surface px-2 text-sm text-ink"
              value={v.kind}
              onChange={(e) => set("via", form.via.map((x, j) => (j === i ? { ...x, kind: e.target.value as "point" | "area" } : x)))}
            >
              <option value="point">Point</option>
              <option value="area">Area</option>
            </select>
            <button
              type="button"
              className="rounded-md px-2 text-sm text-ink-2 hover:bg-line"
              aria-label={`Remove stop ${i + 1}`}
              onClick={() => set("via", form.via.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="self-start text-sm font-medium text-moss underline-offset-4 hover:underline"
          onClick={() => set("via", [...form.via, { text: "", kind: "point" }])}
        >
          Add a stop
        </button>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Distance (km)" id="distance">
          <input id="distance" inputMode="decimal" className={`${inputClass} font-mono`} value={form.distanceKm} onChange={(e) => set("distanceKm", e.target.value)} placeholder="Any" />
        </Field>
        <Field label="Climbing (m)" id="climb">
          <input id="climb" inputMode="numeric" className={`${inputClass} font-mono`} value={form.elevationGainM} onChange={(e) => set("elevationGainM", e.target.value)} placeholder="Any" />
        </Field>
      </div>

      <div className="flex flex-col gap-1">
        <span id="bike-label" className="text-xs font-medium text-ink-2">
          Bike
        </span>
        <ToggleGroup.Root
          type="single"
          aria-labelledby="bike-label"
          value={form.bike}
          onValueChange={(v) => v && set("bike", v as Bike)}
          className="grid grid-cols-3 rounded-md border border-line bg-surface p-0.5"
        >
          {BIKES.map((b) => (
            <ToggleGroup.Item
              key={b.value}
              value={b.value}
              className="rounded-sm py-1.5 text-sm text-ink-2 transition-colors duration-150 ease-out data-[state=on]:bg-ink data-[state=on]:text-paper"
            >
              {b.label}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={form.outAndBack} onChange={(e) => set("outAndBack", e.target.checked)} className="size-4 accent-[var(--moss)]" />
        Riding back the same way is fine
      </label>

      <button type="submit" disabled={busy} className="rounded-md border border-ink px-4 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:bg-ink hover:text-paper disabled:opacity-50">
        Update route
      </button>
    </form>
  );
}
