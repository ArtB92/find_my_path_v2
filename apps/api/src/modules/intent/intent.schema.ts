import { z } from "zod";

/** What the model fills in. Places stay free text (or "pin:A") and are mapped to the shared intent afterwards. */
export const LlmIntentSchema = z.object({
  isRouteRequest: z.boolean(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  loop: z.boolean(),
  via: z.array(z.object({ place: z.string(), kind: z.enum(["point", "area"]) })),
  distanceKm: z.number().nullable(),
  elevationGainM: z.number().nullable(),
  bike: z.enum(["road", "gravel", "trekking"]).nullable(),
  outAndBack: z.boolean(),
  avoid: z.array(z.string()),
  direction: z.enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]).nullable(),
  notes: z.array(z.string()),
});
export type LlmIntent = z.infer<typeof LlmIntentSchema>;
