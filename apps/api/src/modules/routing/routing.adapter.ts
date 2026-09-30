import type { Bike, LatLon, TrackPoint } from "@find-my-path/shared";
import { DomainError } from "../../lib/errors";
import { fetchWithTimeout } from "../../lib/http";
import { BrouterResponseSchema } from "./routing.schema";

/** A circle the route must not enter. */
export interface NoGoZone extends LatLon {
  radiusM: number;
}

export interface RouteOptions {
  avoid?: NoGoZone[];
  signal?: AbortSignal;
}

export interface RoutingAdapter {
  /** Rideable track through the given points, in order. */
  route(points: LatLon[], bike: Bike, options?: RouteOptions): Promise<TrackPoint[]>;
}

/** Stock BRouter profiles: all keep bikes off motorways; fastbike prefers smooth paved roads, trekking accepts good tracks. */
const BROUTER_PROFILES: Record<Bike, string> = {
  road: "fastbike",
  gravel: "trekking",
  trekking: "trekking",
};

const TIMEOUT_MS = 45_000;

export function createBrouterAdapter(baseUrl: string): RoutingAdapter {
  return {
    async route(points, bike, { avoid = [], signal } = {}) {
      const url = new URL(`${baseUrl.replace(/\/$/, "")}/brouter`);
      url.searchParams.set("lonlats", points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join("|"));
      url.searchParams.set("profile", BROUTER_PROFILES[bike]);
      url.searchParams.set("alternativeidx", "0");
      url.searchParams.set("format", "geojson");
      if (avoid.length) {
        url.searchParams.set("nogos", avoid.map((z) => `${z.lon.toFixed(6)},${z.lat.toFixed(6)},${Math.round(z.radiusM)}`).join("|"));
      }

      const res = await fetchWithTimeout(url.toString(), { timeoutMs: TIMEOUT_MS, signal, service: "The routing engine" });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.warn(`BRouter ${res.status}: ${detail.slice(0, 300)}`);
        if (/datafile .* not found/i.test(detail)) {
          throw new DomainError("upstream_unavailable", "The routing engine is missing the map data for this area.");
        }
        if (/lookup version mismatch/i.test(detail)) {
          throw new DomainError("upstream_unavailable", "The routing engine is out of date for its map data.");
        }
        if (/not mapped|island/i.test(detail)) {
          throw new DomainError("no_route", "One of the points is too far from any rideable road.");
        }
        throw new DomainError("no_route", "The routing engine couldn't connect these points.");
      }
      const body = BrouterResponseSchema.parse(await res.json());
      const coords = body.features[0]!.geometry.coordinates;
      let lastEle = 0;
      return coords.map(([lon, lat, ele]) => {
        if (ele !== undefined) lastEle = ele;
        return [lon!, lat!, lastEle];
      });
    },
  };
}

/** Straight lines densified every ~50 m, with elevation from `elevationAt`. Ignores no-go zones. For tests. */
export function createFakeRoutingAdapter(
  elevationAt: (p: LatLon) => number = () => 0,
): RoutingAdapter & { calls: LatLon[][]; avoided: NoGoZone[][] } {
  const calls: LatLon[][] = [];
  const avoided: NoGoZone[][] = [];
  return {
    calls,
    avoided,
    async route(points, _bike, { avoid = [] } = {}) {
      calls.push(points);
      avoided.push(avoid);
      const track: TrackPoint[] = [];
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const approxM = Math.hypot((b.lat - a.lat) * 111_000, (b.lon - a.lon) * 73_000);
        const steps = Math.max(1, Math.round(approxM / 50));
        for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
          const p = { lat: a.lat + ((b.lat - a.lat) * s) / steps, lon: a.lon + ((b.lon - a.lon) * s) / steps };
          track.push([p.lon, p.lat, elevationAt(p)]);
        }
      }
      return track;
    },
  };
}
