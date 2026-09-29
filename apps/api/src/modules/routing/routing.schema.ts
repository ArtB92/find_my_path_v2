import { z } from "zod";

export const BrouterResponseSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: z.object({
          type: z.literal("LineString"),
          coordinates: z.array(z.array(z.number()).min(2)),
        }),
      }),
    )
    .min(1),
});
