import { DomainError } from "../../lib/errors";
import { fetchWithTimeout } from "../../lib/http";
import { BanResponseSchema, PhotonResponseSchema, type Bbox, type GeocodedPlace, type PlaceKind } from "./geocoding.schema";

export interface GeocoderAdapter {
  search(query: string, options: { bbox: Bbox; signal?: AbortSignal }): Promise<GeocodedPlace[]>;
}

const TIMEOUT_MS = 6000;

async function getJson(url: URL, service: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetchWithTimeout(url.toString(), { timeoutMs: TIMEOUT_MS, signal, service });
  if (!res.ok) throw new DomainError("upstream_unavailable", `${service} answered ${res.status}.`);
  return res.json();
}

function bboxCenter([minLon, minLat, maxLon, maxLat]: Bbox) {
  return { lon: (minLon + maxLon) / 2, lat: (minLat + maxLat) / 2 };
}

const BAN_KINDS: Record<string, PlaceKind> = {
  housenumber: "address",
  street: "street",
  locality: "poi",
  municipality: "town",
};

/** French national address base (BAN) via the Géoplateforme: best for towns and street addresses, typo tolerant. */
export function createBanGeocoder(baseUrl: string): GeocoderAdapter {
  return {
    async search(query, { bbox, signal }) {
      const url = new URL(`${baseUrl.replace(/\/$/, "")}/search`);
      const center = bboxCenter(bbox);
      url.searchParams.set("q", query);
      url.searchParams.set("index", "address");
      url.searchParams.set("limit", "10");
      url.searchParams.set("lat", String(center.lat));
      url.searchParams.set("lon", String(center.lon));
      const body = BanResponseSchema.parse(await getJson(url, "Address search", signal));
      return body.features.map((f) => ({
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        name: f.properties.label,
        kind: BAN_KINDS[f.properties.type] ?? "poi",
        score: f.properties.score,
      }));
    },
  };
}

const AREA_KEYS = new Set(["natural", "landuse", "leisure", "boundary", "place:region", "waterway"]);
const TOWN_TYPES = new Set(["city", "town", "village", "district", "locality"]);

/** Photon (OpenStreetMap): fuzzy, knows forests, valleys, parks and other named areas. */
export function createPhotonGeocoder(baseUrl: string): GeocoderAdapter {
  return {
    async search(query, { bbox, signal }) {
      const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/`);
      url.searchParams.set("q", query);
      url.searchParams.set("limit", "8");
      url.searchParams.set("lang", "fr");
      url.searchParams.set("bbox", bbox.join(","));
      const body = PhotonResponseSchema.parse(await getJson(url, "Place search", signal));
      return body.features.map((f, i) => {
        const p = f.properties;
        const [lon, lat] = p.extent
          ? [(p.extent[0] + p.extent[2]) / 2, (p.extent[1] + p.extent[3]) / 2]
          : f.geometry.coordinates;
        const kind: PlaceKind =
          p.type === "house"
            ? "address"
            : p.type === "street"
              ? "street"
              : p.osm_key && AREA_KEYS.has(p.osm_key)
                ? "area"
                : p.type && TOWN_TYPES.has(p.type)
                  ? "town"
                  : "poi";
        const label = [p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.name, p.city ?? p.county]
          .filter(Boolean)
          .join(", ");
        // Photon's extent runs from the north-west corner to the south-east one.
        const extent: Bbox | undefined = p.extent && [
          Math.min(p.extent[0], p.extent[2]),
          Math.min(p.extent[1], p.extent[3]),
          Math.max(p.extent[0], p.extent[2]),
          Math.max(p.extent[1], p.extent[3]),
        ];
        return { lon, lat, name: label || query, kind, score: 1 - i * 0.1, ...(extent && { extent }) };
      });
    },
  };
}

/** In-memory geocoder for tests: matches when the query contains the key (case-insensitive). */
export function createFakeGeocoder(places: Record<string, GeocodedPlace>): GeocoderAdapter {
  return {
    async search(query) {
      const q = query.toLowerCase();
      return Object.entries(places)
        .filter(([key]) => q.includes(key.toLowerCase()))
        .map(([, place]) => place);
    },
  };
}
