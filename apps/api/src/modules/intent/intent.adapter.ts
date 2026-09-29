import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Pin } from "@find-my-path/shared";
import { DomainError } from "../../lib/errors";
import { z } from "zod";
import { fetchWithTimeout } from "../../lib/http";
import { LlmIntentSchema, type LlmIntent } from "./intent.schema";

export interface IntentLlmAdapter {
  extract(query: string, pins: Pin[], signal?: AbortSignal): Promise<LlmIntent>;
}

const TIMEOUT_MS = 30_000;
/** Routes must come back within 10 s, so a slow local model is cut short and the rules' reading used instead. */
const LOCAL_TIMEOUT_MS = 5000;

export function systemPrompt(serviceAreaName: string) {
  return `You turn a cyclist's request into route parameters for FindMyPath, a route planner that currently covers ${serviceAreaName}, France. Requests may be in French or English.

Fill the fields as follows.
- Places (start, end, via): write each one as a clean geocoder query with the correct spelling, fixing typos ("Versaille" -> "Versailles") and completing ambiguous names with the one in ${serviceAreaName} ("Asnières" -> "Asnières-sur-Seine"). Keep street addresses with their town ("12 rue de Bretagne, Asnières-sur-Seine").
- Map pins: the rider may refer to pins dropped on the map ("A", "point B", "pin C", "here" or "from my pin" when there is only one). Write those as "pin:A". Only use pins from the list you are given.
- loop: true when the ride returns to its start: "loop", "boucle", "round trip", same start and end, or no destination at all. Then end is null.
- via: places to pass through, in riding order. kind "area" for regions, forests, valleys, parks, "this area" ("vallée de Chevreuse", "forêt de Rambouillet"); kind "point" for towns, addresses, pins and specific spots.
- distanceKm: total distance asked for ("around 80 km"), otherwise null.
- elevationGainM: total climbing asked for ("500 m elevation", "500 D+", "dénivelé"), otherwise null. "One big climb" or "hilly" without a number: null, and add a note.
- bike: road ("vélo de route"), gravel, trekking (VTC, hybrid, city bike); null when not said.
- outAndBack: true only when the rider explicitly wants to go and come back the same way ("aller-retour").
- notes: short phrases, in the rider's language, for anything asked that these fields cannot express. Avoiding main roads, motorways and traffic is always handled, so never note it.
- isRouteRequest: false when the message is not asking for a bike route; leave the rest empty then.`;
}

function userMessage(query: string, pins: Pin[]) {
  const pinList = pins.length ? pins.map((p) => `pin:${p.label} at ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`).join("\n") : "none";
  return `Pins on the map:\n${pinList}\n\nRequest:\n${query}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const OllamaResponseSchema = z.object({ message: z.object({ content: z.string() }) });

/** Free, local model served by Ollama, constrained to the intent JSON schema. */
export function createOllamaIntentAdapter({
  baseUrl,
  model,
  serviceAreaName,
}: {
  baseUrl: string;
  model: string;
  serviceAreaName: string;
}): IntentLlmAdapter {
  const system = systemPrompt(serviceAreaName);
  const format = z.toJSONSchema(LlmIntentSchema);

  return {
    async extract(query, pins, signal) {
      const res = await fetchWithTimeout(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
        timeoutMs: LOCAL_TIMEOUT_MS,
        signal,
        service: "The local language model",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            format,
            options: { temperature: 0 },
            messages: [
              { role: "system", content: system },
              { role: "user", content: userMessage(query, pins) },
            ],
          }),
        },
      });
      if (!res.ok) {
        throw new DomainError("upstream_unavailable", `The local language model isn't ready (it may still be downloading ${model}).`);
      }
      const content = OllamaResponseSchema.parse(await res.json()).message.content;
      const parsed = LlmIntentSchema.safeParse(parseJson(content));
      if (!parsed.success) {
        throw new DomainError("intent_unclear", "We couldn't understand that request. Try naming a start and a distance.");
      }
      return parsed.data;
    },
  };
}

export function createClaudeIntentAdapter({
  apiKey,
  model,
  serviceAreaName,
}: {
  apiKey: string;
  model: string;
  serviceAreaName: string;
}): IntentLlmAdapter {
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  const system = systemPrompt(serviceAreaName);

  return {
    async extract(query, pins, signal) {
      try {
        const response = await client.beta.messages.parse(
          {
            model,
            max_tokens: 4000,
            system,
            messages: [{ role: "user", content: userMessage(query, pins) }],
            output_config: { effort: "low", format: zodOutputFormat(LlmIntentSchema) },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          },
          { signal },
        );
        if (response.stop_reason === "refusal" || !response.parsed_output) {
          throw new DomainError("intent_unclear", "We couldn't understand that request. Try naming a start and a distance.");
        }
        return response.parsed_output;
      } catch (err) {
        if (err instanceof DomainError || signal?.aborted) throw err;
        throw new DomainError("upstream_unavailable", "The language model is not reachable right now.", { cause: err });
      }
    },
  };
}

export function createFakeIntentAdapter(answer: (query: string) => LlmIntent): IntentLlmAdapter {
  return { extract: async (query) => answer(query) };
}
