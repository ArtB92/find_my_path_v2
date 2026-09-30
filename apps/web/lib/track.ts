import type { TrackPoint } from "@find-my-path/shared";

/** Running distance in km at each point, flat-earth approximation (fine at route scale). */
export function cumulativeKm(track: TrackPoint[]): number[] {
  const out = [0];
  for (let i = 1; i < track.length; i++) {
    const [lon1, lat1] = track[i - 1]!;
    const [lon2, lat2] = track[i]!;
    const dx = (lon2 - lon1) * 111.32 * Math.cos((lat1 * Math.PI) / 180);
    const dy = (lat2 - lat1) * 110.57;
    out.push(out[i - 1]! + Math.hypot(dx, dy));
  }
  return out;
}

/** Index of the last value <= x in a sorted array. */
export function bisect(values: number[], x: number) {
  let lo = 0;
  let hi = values.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (values[mid]! <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** [lon, lat] at a fraction (0..1) of the track's length. */
export function lngLatAt(track: TrackPoint[], km: number[], fraction: number): [number, number] {
  const d = fraction * (km.at(-1) ?? 0);
  const i = bisect(km, d);
  const a = track[i]!;
  const b = track[Math.min(i + 1, track.length - 1)]!;
  const span = km[i + 1] !== undefined ? km[i + 1]! - km[i]! : 0;
  const t = span > 0 ? (d - km[i]!) / span : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
