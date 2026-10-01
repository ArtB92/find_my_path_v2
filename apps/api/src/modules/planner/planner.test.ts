import type { LatLon, Pin, RouteIntent } from "@find-my-path/shared";
import { describe, expect, it } from "vitest";
import { DomainError } from "../../lib/errors";
import { createFakeGeocoder, createGeocodingService, type GeocodedPlace } from "../geocoding";
import { createClimbIndex, type Climb } from "../climbs";
import { createFakeRoutingAdapter } from "../routing";
import { haversineM, localPlane, overlapRatio } from "./planner.geometry";
import { createPlannerService, TOLERANCE } from "./planner.service";
import { loopThrough, scaleForLength } from "./planner.shapes";

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

/** Climbs up the eastern hills: from a trough (x = 2πk·1500 m) to the next crest, riding east. */
function easternClimbs(): Climb[] {
  const plane = localPlane(places.versailles);
  return [
    { x: 2 * Math.PI * 1500, y: 3000 },
    { x: 4 * Math.PI * 1500, y: -2000 },
  ].map(({ x, y }, id) => ({
    id,
    name: `Côte ${id}`,
    path: [0, 1 / 3, 2 / 3, 1].map((f) => {
      const p = plane.toLatLon({ x: x + f * Math.PI * 1500, y });
      return [p.lon, p.lat] as [number, number];
    }),
    bottomEle: 0,
    topEle: 100,
    lengthM: Math.PI * 1500,
    gainM: 100,
    avgGrade: 100 / (Math.PI * 1500),
    maxGrade: 0.05,
    roadClass: "tertiary",
    paved: true,
  }));
}

function setup(elevationAt?: (p: LatLon) => number, climbs: Climb[] = []) {
  const fake = createFakeGeocoder(places);
  const geocoding = createGeocodingService({
    ban: fake,
    photon: fake,
    serviceArea: { bbox: [1.44, 48.12, 3.56, 49.24], name: "Île-de-France" },
  });
  const routing = createFakeRoutingAdapter(elevationAt);
  return { planner: createPlannerService({ geocoding, routing, climbs: createClimbIndex(climbs) }), routing };
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

  it("returns the closest route, saying what it misses, when the climbing asked for doesn't exist", async () => {
    const { planner } = setup(hillsToTheEast);
    const route = await planner.plan(intent({ distanceKm: 40, elevationGainM: 3000 }), []);
    expect(route.track.length).toBeGreaterThan(0);
    expect(route.missed).toMatch(/closest we found.*not enough climbing|isn't enough climbing/);
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

  it("says when a loop is too short to reach the place asked for", async () => {
    const { planner } = setup();
    const route = await planner.plan(intent({ distanceKm: 20, via: [{ place: text("Rambouillet"), kind: "point" }] }), []);
    expect(route.missed).toMatch(/too far apart/);
  });

  it("rides the only climb around twice to get closer to the climbing asked for", async () => {
    const [climb] = easternClimbs();
    const { planner, routing } = setup(hillsToTheEast, [climb!]);
    await planner.plan(intent({ distanceKm: 50, elevationGainM: 250 }), []);
    const bottom = { lon: climb!.path[0]![0], lat: climb!.path[0]![1] };
    expect(routing.calls.some((call) => call.filter((p) => haversineM(p, bottom) < 1).length === 2)).toBe(true);
  });

  it("rides laps of a climb when one pass of each can't give the climbing asked", async () => {
    const [climb] = easternClimbs();
    const { planner } = setup(hillsToTheEast, [climb!]);
    const route = await planner.plan(intent({ distanceKm: 80, elevationGainM: 750 }), []);
    expect(route.notes.join(" ")).toMatch(/Côte 0 .*ridden \d+ times/);
    expect(route.missed).toBeNull();
    expect(Math.abs(route.ascentM - 750)).toBeLessThanOrEqual(750 * TOLERANCE.elevation);
    expect(Math.abs(route.distanceM - 80_000) / 80_000).toBeLessThanOrEqual(TOLERANCE.distance);
  });

  it("rides the laps around the place the rider named for them", async () => {
    const climbs = easternClimbs();
    const { planner } = setup(hillsToTheEast, climbs);
    const [lon, lat] = climbs[1]!.path[0]!;
    const route = await planner.plan(intent({ distanceKm: 80, elevationGainM: 900, via: [{ place: { type: "pin", label: "B" }, kind: "point" }] }), [
      { label: "B", lat, lon },
    ]);
    expect(route.notes.join(" ")).toMatch(/Climbs: Côte 1 .*ridden \d+ times/);
    expect(passesNear(route.track, { lat, lon })).toBe(true);
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

  it("sends a hilly loop up known climbs, bottom to top", async () => {
    const climbs = easternClimbs();
    const { planner, routing } = setup(hillsToTheEast, climbs);
    const route = await planner.plan(intent({ distanceKm: 80, elevationGainM: 500 }), []);
    const firstCall = routing.calls[0]!;
    const onClimb = climbs.find((c) => firstCall.some((p) => haversineM(p, { lon: c.path[0]![0], lat: c.path[0]![1] }) < 1))!;
    const bottom = firstCall.findIndex((p) => haversineM(p, { lon: onClimb.path[0]![0], lat: onClimb.path[0]![1] }) < 1);
    const top = firstCall.findIndex((p) => haversineM(p, { lon: onClimb.path[3]![0], lat: onClimb.path[3]![1] }) < 1);
    expect(top - bottom).toBe(3);
    expect(route.notes.join(" ")).toMatch(/Climbs: Côte/);
    expect(Math.abs(route.ascentM - 500)).toBeLessThanOrEqual(Math.max(TOLERANCE.elevation * 500, TOLERANCE.elevationMinM));
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

  it("drops routing calls still running at the cutoff and keeps the route already found", async () => {
    const fake = createFakeRoutingAdapter();
    const hangingRouting = {
      route: async (...args: Parameters<typeof fake.route>) => {
        if (fake.calls.length === 0) return fake.route(...args);
        const signal = args[2]?.signal;
        return new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason)));
      },
    };
    const geocoding = createGeocodingService({
      ban: createFakeGeocoder(places),
      photon: createFakeGeocoder(places),
      serviceArea: { bbox: [1.44, 48.12, 3.56, 49.24], name: "Île-de-France" },
    });
    const planner = createPlannerService({ geocoding, routing: hangingRouting, budgetMs: 20, cutoffMs: 60 });
    const startedAt = Date.now();
    const route = await planner.plan(intent({ end: text("Paris"), avoid: [text("Rambouillet")] }), []);
    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(route.track.length).toBeGreaterThan(0);
  });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("loopThrough", () => {
  it("passes the place and keeps the whole loop on the side asked", () => {
    const { versailles: start, paris: via } = places;
    const plane = localPlane(start);
    const v = plane.toXY(via);
    for (const side of [1, -1] as const) {
      const shape = loopThrough(start, via, side);
      const points = shape.waypoints(scaleForLength(shape, 100_000));
      expect(points[0]).toEqual(start);
      expect(points.at(-1)).toEqual(start);
      expect(points).toContainEqual(via);
      // Signed distance from the Versailles → Paris line, positive on the side asked.
      const offsets = points.map(plane.toXY).map(({ x, y }) => ((v.x * y - v.y * x) / Math.hypot(v.x, v.y)) * side);
      expect(Math.max(...offsets)).toBeGreaterThan(3 * -Math.min(...offsets));
    }
  });
});
