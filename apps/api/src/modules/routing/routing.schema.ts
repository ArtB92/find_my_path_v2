import { z } from "zod";

export const BrouterResponseSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({
          type: z.literal("LineString"),
          coordinates: z.array(z.array(z.number()).min(2)),
        }),
        /** A header row, then one row per stretch of road, with the tags of its end node. */
        properties: z.object({ messages: z.array(z.array(z.string())).optional() }).optional(),
      }),
    )
    .min(1),
});
