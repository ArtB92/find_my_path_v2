import type { TrackPoint } from "@find-my-path/shared";
import { describe, expect, it } from "vitest";
import { destination, elevationStats, haversineM, overlapRatio, trackLengthM, trimSpurs } from "./planner.geometry";

const origin = { lat: 48.8, lon: 2.1 };

function line(points: { lat: number; lon: number }[], stepM = 40): TrackPoint[] {
  const track: TrackPoint[] = [];
  points.slice(1).forEach((b, i) => {
    const a = points[i]!;
    const steps = Math.max(1, Math.round(haversineM(a, b) / stepM));
    for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
      track.push([a.lon + ((b.lon - a.lon) * s) / steps, a.lat + ((b.lat - a.lat) * s) / steps, 0]);
    }
  });
  return track;
}

describe("haversineM / destination", () => {
  it("round-trips a known distance", () => {
    const p = destination(origin, 90, 10_000);
    expect(haversineM(origin, p)).toBeCloseTo(10_000, -1);
  });
});

describe("overlapRatio", () => {
  it("is close to 1 for an out-and-back and close to 0 for a square loop", () => {
    const far = destination(origin, 45, 5000);
    expect(overlapRatio(line([origin, far, origin]))).toBeGreaterThan(0.9);

    const b = destination(origin, 90, 5000);
    const c = destination(b, 0, 5000);
    const d = destination(origin, 0, 5000);
    expect(overlapRatio(line([origin, b, c, d, origin]))).toBeLessThan(0.05);
  });

  it("leaves out the part of the track inside the area to ignore", () => {
    const far = destination(origin, 45, 5000);
    expect(overlapRatio(line([origin, far, origin]), { ignore: { ...origin, radiusM: 6000 } })).toBe(0);
  });
});

describe("trimSpurs", () => {
  const b = destination(origin, 90, 5000);
  const spurTip = destination(b, 0, 800);
  const c = destination(b, 90, 5000);
  const withSpur = line([origin, b, spurTip, b, c]);

  it("removes a dead-end detour and keeps the ride continuous", () => {
    const trimmed = trimSpurs(withSpur, { keep: [] });
    expect(trackLengthM(trimmed)).toBeCloseTo(10_000, -2);
    expect(trimmed.at(-1)).toEqual(withSpur.at(-1));
  });

  it("keeps a detour that leads to a place the rider asked for", () => {
    const trimmed = trimSpurs(withSpur, { keep: [spurTip] });
    expect(trackLengthM(trimmed)).toBeCloseTo(trackLengthM(withSpur), -1);
  });

  it("never cuts the loop itself", () => {
    const e = destination(origin, 0, 3000);
    const loop = line([origin, b, destination(b, 0, 3000), e, origin]);
    expect(trimSpurs(loop, { keep: [] })).toHaveLength(loop.length);
  });
});

describe("elevationStats", () => {
  it("ignores noise below the threshold", () => {
    const noisy: TrackPoint[] = [0, 2, 0, 3, 1, 2, 0].map((e, i) => [2 + i * 0.001, 48, 100 + e]);
    expect(elevationStats(noisy)).toEqual({ ascentM: 0, descentM: 0 });
  });

  it("counts real climbs and descents", () => {
    const hill: TrackPoint[] = [100, 120, 150, 130, 90].map((e, i) => [2 + i * 0.001, 48, e]);
    expect(elevationStats(hill)).toEqual({ ascentM: 50, descentM: 60 });
  });
});
