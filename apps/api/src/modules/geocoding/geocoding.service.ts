import { createCache } from "../../lib/cache";
import { DomainError } from "../../lib/errors";
import type { GeocoderAdapter } from "./geocoding.adapter";
import type { Bbox, GeocodedPlace } from "./geocoding.schema";

interface Deps {
  ban: GeocoderAdapter;
  photon: GeocoderAdapter;
  serviceArea: { bbox: Bbox; name: string };
}

export interface ResolveOptions {
  /** Named areas (forests, valleys) are better served by OSM than the address base. */
  preferArea?: boolean;
  signal?: AbortSignal;
}

/** Below this, a BAN hit is more likely a wrong street than the place the rider meant. */
const BAN_MIN_SCORE = 0.55;

export function isInBbox({ lat, lon }: { lat: number; lon: number }, [minLon, minLat, maxLon, maxLat]: Bbox) {
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

export function createGeocodingService({ ban, photon, serviceArea }: Deps) {
  const cached = createCache<GeocodedPlace>(500);

  async function lookup(text: string, preferArea: boolean, signal?: AbortSignal): Promise<GeocodedPlace> {
    const [banRes, photonRes] = await Promise.allSettled([
      ban.search(text, { bbox: serviceArea.bbox, signal }),
      photon.search(text, { bbox: serviceArea.bbox, signal }),
    ]);
    if (banRes.status === "rejected" && photonRes.status === "rejected") throw banRes.reason;

    const banAll = banRes.status === "fulfilled" ? banRes.value : [];
    const photonAll = photonRes.status === "fulfilled" ? photonRes.value : [];
    const banHit = banAll.find((p) => isInBbox(p, serviceArea.bbox));
    const photonHit = photonAll.find((p) => isInBbox(p, serviceArea.bbox));

    const goodBan = banHit && banHit.score >= BAN_MIN_SCORE ? banHit : undefined;
    const pick = preferArea ? (photonHit ?? goodBan ?? banHit) : (goodBan ?? photonHit ?? banHit);
    if (pick) return pick;

    if (banAll.length > 0 || photonAll.length > 0) {
      throw new DomainError("outside_service_area", `"${text}" is outside ${serviceArea.name}, the only area supported for now.`);
    }
    throw new DomainError("place_not_found", `We couldn't find "${text}" in ${serviceArea.name}.`);
  }

  return {
    resolve(text: string, { preferArea = false, signal }: ResolveOptions = {}): Promise<GeocodedPlace> {
      const key = `${preferArea ? "area" : "any"}:${text.trim().toLowerCase()}`;
      return cached(key, () => lookup(text.trim(), preferArea, signal));
    },

    assertInServiceArea(point: { lat: number; lon: number }, name: string) {
      if (!isInBbox(point, serviceArea.bbox)) {
        throw new DomainError("outside_service_area", `${name} is outside ${serviceArea.name}, the only area supported for now.`);
      }
    },
  };
}

export type GeocodingService = ReturnType<typeof createGeocodingService>;
