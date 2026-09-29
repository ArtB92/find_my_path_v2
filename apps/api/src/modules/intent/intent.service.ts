import type { ParseResponse, Pin, PlaceRef, RouteIntent } from "@find-my-path/shared";
import { RouteIntentSchema } from "@find-my-path/shared";
import { DomainError } from "../../lib/errors";
import type { IntentLlmAdapter } from "./intent.adapter";

const DEFAULT_BIKE = "road";

function toPlace(text: string, pins: Pin[]): PlaceRef {
  const pin = /^pin:([A-Z])$/i.exec(text.trim());
  if (!pin) return { type: "text", text: text.trim() };
  const label = pin[1]!.toUpperCase();
  if (!pins.some((p) => p.label === label)) {
    throw new DomainError("intent_unclear", `The request mentions pin ${label}, but there is no such pin on the map.`);
  }
  return { type: "pin", label };
}

export function createIntentService({ llm }: { llm: IntentLlmAdapter | null }) {
  return {
    async parse(query: string, pins: Pin[], signal?: AbortSignal): Promise<ParseResponse> {
      if (!llm) {
        throw new DomainError("intent_unavailable", "Free-text requests are switched off on this server. Fill in the route settings instead.");
      }
      const raw = await llm.extract(query, pins, signal);
      if (!raw.isRouteRequest) {
        throw new DomainError("intent_unclear", "That doesn't look like a route request. Try “60 km loop from Versailles”.");
      }
      if (!raw.start) {
        throw new DomainError("intent_unclear", "Where should the ride start? Name a town or address, or drop a pin on the map.");
      }
      const loop = raw.loop || !raw.end;
      const intent: RouteIntent = {
        start: toPlace(raw.start, pins),
        end: loop || !raw.end ? null : toPlace(raw.end, pins),
        via: raw.via.map((v) => ({ place: toPlace(v.place, pins), kind: v.kind })),
        distanceKm: raw.distanceKm,
        elevationGainM: raw.elevationGainM,
        bike: raw.bike ?? DEFAULT_BIKE,
        outAndBack: raw.outAndBack,
      };
      const checked = RouteIntentSchema.safeParse(intent);
      if (!checked.success) {
        throw new DomainError("intent_unclear", "Some of those numbers are out of range: distance 2–400 km, climbing up to 8000 m.");
      }
      return { intent: checked.data, notes: raw.notes };
    },
  };
}

export type IntentService = ReturnType<typeof createIntentService>;
