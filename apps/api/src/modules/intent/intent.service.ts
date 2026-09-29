import type { ParseResponse, Pin, PlaceRef, RouteIntent } from "@find-my-path/shared";
import { RouteIntentSchema } from "@find-my-path/shared";
import { DomainError } from "../../lib/errors";
import type { IntentLlmAdapter } from "./intent.adapter";
import { parseWithRules } from "./intent.rules";
import type { LlmIntent } from "./intent.schema";

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
  /**
   * Common requests are read instantly by rules. The language model only gets the ones with words the rules
   * didn't understand, and if it can't answer in time, the rules' reading is used with a note.
   */
  async function read(query: string, pins: Pin[], signal?: AbortSignal): Promise<LlmIntent> {
    const quick = parseWithRules(query, pins);
    if (quick?.complete || (quick && !llm)) return quick.intent;
    if (!llm) {
      throw new DomainError("intent_unclear", "Where should the ride start? Try “60 km loop from Versailles”, or fill in the route settings.");
    }
    try {
      return await llm.extract(query, pins, signal);
    } catch (err) {
      if (!quick || !(err instanceof DomainError) || err.code !== "upstream_unavailable") throw err;
      console.warn(`intent: ${err.message} Using the quick reading instead.`);
      return { ...quick.intent, notes: ["Part of your request wasn't understood, so this route may not follow all of it."] };
    }
  }

  return {
    async parse(query: string, pins: Pin[], signal?: AbortSignal): Promise<ParseResponse> {
      const raw = await read(query, pins, signal);
      if (!raw.isRouteRequest) {
        throw new DomainError("intent_unclear", "That doesn't look like a route request. Try “60 km loop from Versailles”.");
      }
      if (!raw.start) {
        throw new DomainError("intent_unclear", "Where should the ride start? Name a town or address, or drop a pin on the map.");
      }
      // "Aller-retour de Paris à Versailles": ride to the destination and back, so it becomes a loop through it.
      const via = raw.outAndBack && raw.end ? [...raw.via, { place: raw.end, kind: "point" as const }] : raw.via;
      const loop = raw.loop || raw.outAndBack || !raw.end;
      const intent: RouteIntent = {
        start: toPlace(raw.start, pins),
        end: loop || !raw.end ? null : toPlace(raw.end, pins),
        via: via.map((v) => ({ place: toPlace(v.place, pins), kind: v.kind })),
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
