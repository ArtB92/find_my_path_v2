import { z } from "zod";

export const LatLonSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type LatLon = z.infer<typeof LatLonSchema>;

/** A point the rider dropped on the map, referenced from the query as "pin A". */
export const PinSchema = LatLonSchema.extend({
  label: z.string().regex(/^[A-Z]$/),
});
export type Pin = z.infer<typeof PinSchema>;

export const PlaceRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("pin"), label: z.string().regex(/^[A-Z]$/) }),
]);
export type PlaceRef = z.infer<typeof PlaceRefSchema>;

export const BikeSchema = z.enum(["road", "gravel", "trekking"]);
export type Bike = z.infer<typeof BikeSchema>;

export const ViaSchema = z.object({
  place: PlaceRefSchema,
  /** A point must be reached exactly; an area only needs to be crossed. */
  kind: z.enum(["point", "area"]),
});
export type Via = z.infer<typeof ViaSchema>;

export const RouteIntentSchema = z.object({
  start: PlaceRefSchema,
  /** null means a loop back to the start. */
  end: PlaceRefSchema.nullable(),
  via: z.array(ViaSchema).max(8),
  distanceKm: z.number().min(2).max(400).nullable(),
  elevationGainM: z.number().min(0).max(8000).nullable(),
  bike: BikeSchema,
  /** Rider explicitly accepts riding out and back on the same roads. */
  outAndBack: z.boolean(),
});
export type RouteIntent = z.infer<typeof RouteIntentSchema>;

export const ParseRequestSchema = z.object({
  query: z.string().trim().min(3).max(1000),
  pins: z.array(PinSchema).max(26),
});
export type ParseRequest = z.infer<typeof ParseRequestSchema>;

export const ParseResponseSchema = z.object({
  intent: RouteIntentSchema,
  /** Parts of the request the planner can't honour, in the rider's words. */
  notes: z.array(z.string()),
});
export type ParseResponse = z.infer<typeof ParseResponseSchema>;

export const PlanRequestSchema = z.object({
  intent: RouteIntentSchema,
  pins: z.array(PinSchema).max(26),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

/** [lon, lat, elevation in metres] */
export type TrackPoint = [number, number, number];

export interface RouteWaypoint extends LatLon {
  name: string;
  role: "start" | "end" | "via";
}

export interface RouteTargets {
  distanceKm: number | null;
  elevationGainM: number | null;
}

export interface Route {
  track: TrackPoint[];
  distanceM: number;
  ascentM: number;
  descentM: number;
  waypoints: RouteWaypoint[];
  targets: RouteTargets;
  bike: Bike;
  isLoop: boolean;
  notes: string[];
}

export const ErrorCodeSchema = z.enum([
  "bad_request",
  "place_not_found",
  "outside_service_area",
  "no_route",
  "target_unreachable",
  "intent_unclear",
  "upstream_unavailable",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export interface ApiError {
  error: { code: ErrorCode; message: string };
}
