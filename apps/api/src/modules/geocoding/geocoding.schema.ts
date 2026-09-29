import { z } from "zod";

export type PlaceKind = "address" | "street" | "town" | "area" | "poi";

export interface GeocodedPlace {
  lat: number;
  lon: number;
  name: string;
  kind: PlaceKind;
  /** 0..1, provider confidence where available. */
  score: number;
}

/** [minLon, minLat, maxLon, maxLat] */
export type Bbox = [number, number, number, number];

const PointGeometry = z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number(), z.number()]) });

export const BanResponseSchema = z.object({
  features: z.array(
    z.object({
      geometry: PointGeometry,
      properties: z.object({
        label: z.string(),
        score: z.number(),
        type: z.string(),
        context: z.string().optional(),
      }),
    }),
  ),
});

export const PhotonResponseSchema = z.object({
  features: z.array(
    z.object({
      geometry: PointGeometry,
      properties: z.object({
        name: z.string().optional(),
        type: z.string().optional(),
        osm_key: z.string().optional(),
        osm_value: z.string().optional(),
        street: z.string().optional(),
        housenumber: z.string().optional(),
        city: z.string().optional(),
        county: z.string().optional(),
        extent: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
      }),
    }),
  ),
});
