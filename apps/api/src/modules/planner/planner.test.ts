import type { LatLon, Pin, RouteIntent } from "@find-my-path/shared";
import { describe, expect, it } from "vitest";
import { DomainError } from "../../lib/errors";
import { createFakeGeocoder, createGeocodingService, type GeocodedPlace } from "../geocoding";
import { createFakeRoutingAdapter } from "../routing";
import { haversineM, localPlane, overlapRatio } from "./planner.geometry";
import { createPlannerService, TOLERANCE } from "./planner.service";

const place = (name: string, lat: number, lon: number): GeocodedPlace => ({ name, lat, lon, kind: "town", score: 0.9 });
const places = {
  versailles: place("Versailles", 48.8049, 2.1204),
  rambouillet: place("Rambouillet", 48.6437, 1.8298),
  chevreuse: { ...place("Vallée de Chevreuse", 48.7066, 2.0386), kind: "area" as const },
  saclay: place("Saclay", 48.7302, 2.1692),
  meudon: place("Meudon", 48.8133, 2.2358),
  paris: place("Paris", 48.8566, 2.3522),
  "sèvres": place("Sèvres", 48.823, 2.211),
};

/** Flat to the west, rolling hills (100 m waves every ~9 km) to the east of Versailles. */
function hillsToTheEast(p: LatLon) {
  const { x } = localPlane(places.versailles).toXY(p);
  return x > 0 ? 50 * (1 - Math.cos(x / 1500)) : 0;
}

function setup(elevationAt?: (p: LatLon) => number) {
  const fake = createFakeGeocoder(places);
  const geocoding = createGeocodingService({
    ban: fake,
    photon: fake,
    serviceArea: { bbox: [1.44, 48.12, 3.56, 49.24], name: "Île-de-France" },
  });
  const routing = createFakeRoutingAdapter(elevationAt);
  return { planner: createPlannerService({ geocoding, routing }), routing };
}

const text = (t: string) => ({ type: "text" as const, text: t });
const intent = (over: Partial<RouteIntent>): RouteIntent => ({
  start: text("Versailles"),
  end: null,
  via: [],
  distanceKm: null,
  elevationGainM: null,
  bike: "road",
  outAndBack: false,
  avoid: [],
  direction: null,
  ...over,
});

const passesNear = (track: [number, number, number][], p: LatLon, withinM = 200) =>
  track.some(([lon, lat]) => haversineM({ lat, lon }, p) < withinM);

describe("planner", () => {
  it("routes from A to B", async () => {
    const { planner } = setup();
    const route = await planner.plan(intent({ end: text("Rambouillet") }), []);
    expect(route.isLoop).toBe(false);
    expect(route.distanceM).toBeCloseTo(haversineM(places.versailles, places.rambouillet), -3);
    expect(route.waypoints.map((w) => w.role)).toEqual(["start", "end"]);
  });

  it("routes from A to B through C and D, in order", async () => {
    const { planner, routing } = setup();
    const route = await planner.plan(
      intent({
        end: text("Paris"),
        via: [
          { place: text("Saclay"), kind: "point" },
          { place: text("Meudon"), kind: "point" },
        ],
      }),
      [],
    );
    expect(routing.calls[0]).toMatchObject([places.versailles, places.saclay, places.meudon, places.paris].map(({ lat, lon }) => ({ lat, lon })));
    expect(passesNear(route.track, places.saclay)).toBe(true);
    expect(passesNear(route.track, places.meudon)).toBe(true);
  });

  it("accepts a pin as the start", async () => {
    const { planner } = setup();
    const pins: Pin[] = [{ label: "A", lat: 48.75, lon: 2.3 }];
    const route = await planner.plan(intent({ start: { type: "pin", label: "A" }, end: text("Paris") }), pins);
    expect(route.waypoints[0]).toMatchObject({ lat: 48.75, lon: 2.3, name: "Pin A" });
  });

  it("builds a real loop of about 80 km, not an out-and-back", async () => {
    const { planner } = setup();
    const route = await planner.plan(intent({ distanceKm: 80 }), []);
    expect(route.isLoop).toBe(true);
    expect(Math.abs(route.distanceM - 80_000) / 80_000).toBeLessThanOrEqual(TOLERANCE.distance);
    expect(overlapRatio(route.track)).toBeLessThan(0.1);
    const [first, last] = [route.track[0]!, route.track.at(-1)!];
    expect(haversineM({ lon: first[0], lat: first[1] }, { lon: last[0], lat: last[1] })).toBeLessThan(50);
  });

  it("finds the direction with the asked climbing", async () => {
    const { planner } = setup(hillsToTheEast);
    const route = await planner.plan(intent({ distanceKm: 80, elevationGainM: 500 }), []);
    expect(Math.abs(route.ascentM - 500)).toBeLessThanOrEqual(500 * TOLERANCE.elevation);
    expect(Math.abs(route.distanceM - 80_000) / 80_000).toBeLessThanOrEqual(TOLERANCE.distance);
  });

  it("says so when the climbing asked for doesn't exist", async () => {
    const { planner } = setup(hillsToTheEast);
    const attempt = planner.plan(intent({ distanceKm: 40, elevationGainM: 3000 }), []);
    await expect(attempt).rejects.toMatchObject({ code: "target_unreachable" });
    await expect(attempt).rejects.toThrow(/closest we found/);
  });

  it("loops through an area without riding the same road back", async () => {
    const { planner } = setup();
    const route = await planner.plan(intent({ distanceKm: 50, via: [{ place: text("Vallée de Chevreuse"), kind: "area" }] }), []);
    expect(passesNear(route.track, places.chevreuse, 1000)).toBe(true);
    expect(overlapRatio(route.track)).toBeLessThan(0.1);
    expect(Math.abs(route.distanceM - 50_000) / 50_000).toBeLessThanOrEqual(TOLERANCE.distance);
  });

  it("loops through an area without a distance, still as a loop", async () => {
    const { planner } = setup();
    const route = await planner.plan(intent({ via: [{ place: text("Rambouillet"), kind: "area" }] }), []);
    expect(overlapRatio(route.track)).toBeLessThan(0.1);
  });

  it("rides out and back when the rider asks for it", async () => {
    const { planner } = setup();
    const route = await planner.plan(intent({ outAndBack: true, via: [{ place: text("Saclay"), kind: "point" }] }), []);
    expect(overlapRatio(route.track)).toBeGreaterThan(0.8);
  });

  it("refuses a loop too short to reach the place asked for", async () => {
    const { planner } = setup();
    const attempt = planner.plan(intent({ distanceKm: 20, via: [{ place: text("Rambouillet"), kind: "point" }] }), []);
    await expect(attempt).rejects.toThrow(/too far apart/);
  });

  it("defaults a bare loop to 40 km and says so", async () => {
    const { planner } = setup();
    const route = await planner.plan(intent({}), []);
    expect(route.notes[0]).toMatch(/40 km/);
    expect(Math.abs(route.distanceM - 40_000) / 40_000).toBeLessThanOrEqual(TOLERANCE.distance);
  });

  it("rejects places outside the service area", async () => {
    const { planner } = setup();
    const pins: Pin[] = [{ label: "A", lat: 45.76, lon: 4.83 }];
    await expect(planner.plan(intent({ start: { type: "pin", label: "A" } }), pins)).rejects.toBeInstanceOf(DomainError);
  });

  it("goes around a place to avoid, and tells the router to", async () => {
    const { planner, routing } = setup();
    const route = await planner.plan(intent({ end: text("Paris"), avoid: [text("Sèvres")] }), []);
    expect(routing.avoided[0]).toEqual([expect.objectContaining({ lat: places["sèvres"].lat, lon: places["sèvres"].lon, radiusM: 1500 })]);
    expect(passesNear(route.track, places["sèvres"], 1200)).toBe(false);
  });

  it("refuses to avoid the place the route starts from", async () => {
    const { planner } = setup();
    await expect(planner.plan(intent({ avoid: [text("Versailles")] }), [])).rejects.toThrow(/inside Versailles/);
  });

  it("sends a loop towards the direction asked", async () => {
    const { planner, routing } = setup();
    await planner.plan(intent({ distanceKm: 40, direction: "S" }), []);
    for (const waypoints of routing.calls) {
      const farthest = waypoints.reduce((a, b) => (haversineM(b, places.versailles) > haversineM(a, places.versailles) ? b : a));
      expect(farthest.lat).toBeLessThan(places.versailles.lat);
    }
  });

  it("stops starting new routing calls once the time budget is spent", async () => {
    const fake = createFakeRoutingAdapter(hillsToTheEast);
    const slowRouting = { route: async (...args: Parameters<typeof fake.route>) => (await sleep(40), fake.route(...args)) };
    const geocoding = createGeocodingService({
      ban: createFakeGeocoder(places),
      photon: createFakeGeocoder(places),
      serviceArea: { bbox: [1.44, 48.12, 3.56, 49.24], name: "Île-de-France" },
    });
    const planner = createPlannerService({ geocoding, routing: slowRouting, budgetMs: 60 });
    const startedAt = Date.now();
    await planner.plan(intent({ distanceKm: 80, elevationGainM: 500 }), []).catch(() => null);
    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(fake.calls.length).toBeLessThanOrEqual(8);
  });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
