import type { TrackPoint } from "@find-my-path/shared";
import { describe, expect, it } from "vitest";
import { cumulativeKm, lngLatAt } from "./track";

const track: TrackPoint[] = [
  [2, 48, 100],
  [2, 48.01, 110],
  [2, 48.03, 120],
];
const km = cumulativeKm(track);

describe("lngLatAt", () => {
  it("returns the ends at 0 and 1", () => {
    expect(lngLatAt(track, km, 0)).toEqual([2, 48]);
    expect(lngLatAt(track, km, 1)[1]).toBeCloseTo(48.03, 6);
  });

  it("interpolates by distance, not by point index", () => {
    expect(lngLatAt(track, km, 0.5)[1]).toBeCloseTo(48.015, 6);
  });

  it("handles a single-point track", () => {
    expect(lngLatAt([[2, 48, 100]], [0], 0.4)).toEqual([2, 48]);
  });
});
