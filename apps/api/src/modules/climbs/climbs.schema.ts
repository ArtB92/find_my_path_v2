import { z } from "zod";

/** One climb from the index built by tools/climbs: `path` runs bottom to top, as [lon, lat]. */
export const ClimbSchema = z.object({
  id: z.number().int(),
  name: z.string().nullable(),
  path: z.array(z.tuple([z.number(), z.number()])).min(2),
  bottomEle: z.number(),
  topEle: z.number(),
  lengthM: z.number().positive(),
  gainM: z.number().positive(),
  avgGrade: z.number(),
  maxGrade: z.number(),
  roadClass: z.string(),
  paved: z.boolean(),
});
export type Climb = z.infer<typeof ClimbSchema>;

export const ClimbFileSchema = z.object({ climbs: z.array(ClimbSchema) });
