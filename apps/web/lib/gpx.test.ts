import type { Route } from "@find-my-path/shared";
import { describe, expect, it } from "vitest";
import { routeName, toGpx } from "./gpx";

const route: Route = {
  track: [
    [2.1204, 48.8049, 130],
    [2.13, 48.81, 142.5],
  ],
  distanceM: 80_400,
  ascentM: 480,
  descentM: 480,
  waypoints: [{ lat: 48.8049, lon: 2.1204, name: "Versailles, Yvelines", role: "start" }],
  targets: { distanceKm: 80, elevationGainM: 500 },
  bike: "road",
  isLoop: true,
  notes: [],
};

describe("gpx", () => {
  it("writes every point with elevation", () => {
    const gpx = toGpx(route, "Versailles & co");
    expect(gpx).toContain('<trkpt lat="48.804900" lon="2.120400"><ele>130.0</ele></trkpt>');
    expect(gpx).toContain("<name>Versailles &amp; co</name>");
    expect(gpx.match(/<trkpt/g)).toHaveLength(2);
  });

  it("names loops and point-to-point rides", () => {
    expect(routeName(route)).toBe("Versailles loop, 80 km");
    expect(
      routeName({ ...route, waypoints: [...route.waypoints, { lat: 48.85, lon: 2.35, name: "Paris", role: "end" }] }),
    ).toBe("Versailles to Paris, 80 km");
  });
});
