import type { LatLon, TrackPoint } from "@find-my-path/shared";

const EARTH_RADIUS_M = 6_371_008;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const pointOf = (p: TrackPoint): LatLon => ({ lon: p[0], lat: p[1] });

/**
 * Local flat projection in metres around an origin. Accurate to well under 1% over the
 * ~100 km a ride spans, which is all the shape maths needs.
 */
export function localPlane(origin: LatLon) {
  const mPerDegLat = (Math.PI * EARTH_RADIUS_M) / 180;
  const mPerDegLon = mPerDegLat * Math.cos(rad(origin.lat));
  return {
    toXY: (p: LatLon) => ({ x: (p.lon - origin.lon) * mPerDegLon, y: (p.lat - origin.lat) * mPerDegLat }),
    toLatLon: ({ x, y }: { x: number; y: number }): LatLon => ({
      lon: origin.lon + x / mPerDegLon,
      lat: origin.lat + y / mPerDegLat,
    }),
  };
}

/** Compass bearing from `from` to `to` (0 = north, 90 = east), on a local flat plane. */
export function bearingDeg(from: LatLon, to: LatLon): number {
  const { x, y } = localPlane(from).toXY(to);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

/** Smallest angle between two compass bearings, 0 to 180. */
export const angleDiffDeg = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** Point reached from `from` after `distanceM` along compass bearing `bearingDeg` (0 = north, 90 = east). */
export function destination(from: LatLon, bearingDeg: number, distanceM: number): LatLon {
  const plane = localPlane(from);
  const b = rad(bearingDeg);
  return plane.toLatLon({ x: Math.sin(b) * distanceM, y: Math.cos(b) * distanceM });
}

export function pathLengthM(points: LatLon[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1]!, points[i]!);
  return total;
}

export function trackLengthM(track: TrackPoint[]): number {
  return pathLengthM(track.map(pointOf));
}

/**
 * Climb and descent with a hysteresis filter, so DEM noise on flat ground doesn't add up to
 * phantom metres. The threshold is in the range cycling apps use for DEM-based profiles.
 */
export function elevationStats(track: TrackPoint[], thresholdM = 5): { ascentM: number; descentM: number } {
  let ascentM = 0;
  let descentM = 0;
  let ref = track[0]?.[2] ?? 0;
  for (const [, , ele] of track) {
    const diff = ele - ref;
    if (diff >= thresholdM) {
      ascentM += diff;
      ref = ele;
    } else if (diff <= -thresholdM) {
      descentM -= diff;
      ref = ele;
    }
  }
  return { ascentM: Math.round(ascentM), descentM: Math.round(descentM) };
}

/** Hash grid over lat/lon for "anything within ~r metres" lookups. */
function createGrid(cellM: number, lat: number) {
  const cellLat = cellM / 111_320;
  const cellLon = cellM / (111_320 * Math.cos(rad(lat)));
  const cells = new Map<string, number[]>();
  const keyOf = (p: LatLon, dx = 0, dy = 0) =>
    `${Math.floor(p.lon / cellLon) + dx}:${Math.floor(p.lat / cellLat) + dy}`;
  return {
    add(p: LatLon, id: number) {
      const key = keyOf(p);
      const list = cells.get(key);
      if (list) list.push(id);
      else cells.set(key, [id]);
    },
    near(p: LatLon): number[] {
      const out: number[] = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const list = cells.get(keyOf(p, dx, dy));
          if (list) out.push(...list);
        }
      }
      return out;
    },
  };
}

/** Evenly spaced samples along the track, with their distance from the start. */
function resample(track: TrackPoint[], stepM: number): { p: LatLon; along: number }[] {
  const out: { p: LatLon; along: number }[] = [];
  if (track.length === 0) return out;
  out.push({ p: pointOf(track[0]!), along: 0 });
  let along = 0;
  let nextAt = stepM;
  for (let i = 1; i < track.length; i++) {
    const a = pointOf(track[i - 1]!);
    const b = pointOf(track[i]!);
    const seg = haversineM(a, b);
    while (seg > 0 && nextAt <= along + seg) {
      const f = (nextAt - along) / seg;
      out.push({ p: { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f }, along: nextAt });
      nextAt += stepM;
    }
    along += seg;
  }
  return out;
}

/**
 * Share of the track ridden twice (0 = every road once, ~1 = pure out-and-back). Two samples
 * count as the same road when they're within `nearM` but far apart along the ride, so ordinary
 * crossings only add a few samples.
 */
export function overlapRatio(track: TrackPoint[], { stepM = 25, nearM = 25, minGapM = 400 } = {}): number {
  const samples = resample(track, stepM);
  if (samples.length < 2) return 0;
  const grid = createGrid(nearM, samples[0]!.p.lat);
  samples.forEach((s, i) => grid.add(s.p, i));
  let repeated = 0;
  for (const s of samples) {
    const twice = grid
      .near(s.p)
      .some((j) => Math.abs(samples[j]!.along - s.along) > minGapM && haversineM(samples[j]!.p, s.p) <= nearM);
    if (twice) repeated++;
  }
  return repeated / samples.length;
}

interface TrimOptions {
  /** Points the rider asked to reach: a spur leading to one of them is kept. */
  keep: LatLon[];
  /** Longest detour (out and back, in metres) removed. */
  maxDetourM?: number;
  /** Vertices closer than this are treated as the same spot on the road. */
  sameSpotM?: number;
}

/**
 * Removes dead-end detours: stretches where the track leaves a spot and comes back to it
 * shortly after (typically a shaping waypoint that landed on a cul-de-sac). The result is still
 * a continuous ride, just without the pointless out-and-back.
 */
export function trimSpurs(track: TrackPoint[], { keep, maxDetourM = 6000, sameSpotM = 12 }: TrimOptions): TrackPoint[] {
  if (track.length < 3) return track;
  const limitM = Math.min(maxDetourM, 0.3 * trackLengthM(track));
  const keepRadiusM = 150;

  const kept: TrackPoint[] = [];
  const keptAlong: number[] = [];
  const keptOrig: number[] = [];
  const posOfOrig = new Map<number, number>();
  const grid = createGrid(sameSpotM, track[0]![1]);

  const touchesKept = (fromPos: number) => {
    for (let i = fromPos; i < kept.length; i++) {
      const p = pointOf(kept[i]!);
      if (keep.some((k) => haversineM(k, p) <= keepRadiusM)) return true;
    }
    return false;
  };

  track.forEach((tp, orig) => {
    const p = pointOf(tp);
    const last = kept.length - 1;
    const alongHere = last < 0 ? 0 : keptAlong[last]! + haversineM(pointOf(kept[last]!), p);

    let target = -1;
    for (const candidate of grid.near(p)) {
      const pos = posOfOrig.get(candidate);
      if (pos === undefined || (target !== -1 && pos >= target)) continue;
      const detour = alongHere - keptAlong[pos]!;
      if (detour < 30 || detour > limitM) continue;
      if (haversineM(pointOf(kept[pos]!), p) > sameSpotM) continue;
      if (touchesKept(pos + 1)) continue;
      target = pos;
    }

    if (target !== -1) {
      for (let i = target + 1; i < kept.length; i++) posOfOrig.delete(keptOrig[i]!);
      kept.length = keptAlong.length = keptOrig.length = target + 1;
      return;
    }
    kept.push(tp);
    keptAlong.push(alongHere);
    keptOrig.push(orig);
    posOfOrig.set(orig, kept.length - 1);
    grid.add(p, orig);
  });

  // The final vertex (a loop's return to the start, or the destination) must survive.
  const lastTp = track[track.length - 1]!;
  if (kept[kept.length - 1] !== lastTp) kept.push(lastTp);
  return kept;
}
