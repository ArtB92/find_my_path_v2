import type { Compass, LatLon, Pin, PlaceRef, Route, RouteIntent, RouteWaypoint, TrackPoint } from "@find-my-path/shared";
import { createLimiter, mapWithConcurrency } from "../../lib/concurrency";
import { DomainError } from "../../lib/errors";
import type { ClimbIndex } from "../climbs";
import type { GeocodedPlace, GeocodingService } from "../geocoding";
import type { NoGoZone, RoutedTrack, RoutingAdapter } from "../routing";
import { angleDiffDeg, bearingDeg, destination, elevationStats, haversineM, localPlane, overlapRatio, pathLengthM, trackLengthM, trimSpurs } from "./planner.geometry";
import { climbLaps, climbLoops, isLapShape, type ClimbShape } from "./planner.climbs";
import { bentLegs, ellipseLoop, loopThrough, outAndBack, scaleForLength, type Shape } from "./planner.shapes";

interface Deps {
  geocoding: GeocodingService;
  routing: RoutingAdapter;
  /** After this long, no new routing call starts and the best route so far is used. */
  budgetMs?: number;
  /** After this long, routing calls still running are dropped if a route was already found. */
  cutoffMs?: number;
  /** Known climbs, so loops asked to climb can be sent up real hills. */
  climbs?: ClimbIndex;
}

/** How far from the asked distance and climb a route may land and still count as a match. */
export const TOLERANCE = { distance: 0.1, elevation: 0.2, elevationMinM: 60 };
export const DEFAULT_LOOP_KM = 40;
/** Leaves room, within the 10 s a rider will wait, for reading the request and the calls still running. */
export const PLAN_BUDGET_MS = 6000;
/** A single call through Paris can take 3 s or more: don't let one started late run past the 10 s. */
export const PLAN_CUTOFF_MS = 8500;

/** Typical ratio of road distance to straight-line distance through the waypoints. */
const INITIAL_ROAD_FACTOR = 1.3;
const PARALLEL_ROUTES = 4;
const REFINED_CANDIDATES = 4;
const REFINED_LAPS = 2;
const MAX_REFINEMENTS = 3;
const SAME_PLACE_M = 300;
/** Climbs this close to the place the rider named for them count as theirs. */
const CLIMB_AREA_M = 4000;

interface Resolved extends LatLon {
  name: string;
}

interface Targets {
  distanceM: number | null;
  elevationM: number | null;
}

interface Candidate {
  shape: Shape;
  scale: number;
  track: TrackPoint[];
  lengthM: number;
  ascentM: number;
  descentM: number;
  overlap: number;
  roadFactor: number;
  lightsPerKm: number;
  /** How far the loop's far side is from the direction asked, in degrees. */
  offCourseDeg: number;
  /** For laps, the routed pieces, so the laps can be ridden more or fewer times without routing again. */
  lapParts?: LapParts;
}

interface LapParts {
  there: RoutedTrack;
  once: RoutedTrack;
  home: RoutedTrack;
}

function distanceError(c: Candidate, t: Targets) {
  return t.distanceM ? Math.abs(c.lengthM - t.distanceM) / t.distanceM : 0;
}

function elevationError(ascentM: number, t: Targets) {
  return t.elevationM === null ? 0 : Math.abs(ascentM - t.elevationM) / Math.max(t.elevationM, 100);
}

function withinTolerance(c: Candidate, t: Targets) {
  const distanceOk = distanceError(c, t) <= TOLERANCE.distance;
  const elevationOk =
    t.elevationM === null ||
    Math.abs(c.ascentM - t.elevationM) <= Math.max(TOLERANCE.elevation * t.elevationM, TOLERANCE.elevationMinM);
  return distanceOk && elevationOk;
}

/**
 * What the numbers can't say: a ride that stops at a light every few hundred metres through a
 * town centre, or a loop heading off to the side of the one asked, is worse than one that doesn't.
 */
function ride(c: Candidate) {
  return 0.2 * c.lightsPerKm + (0.3 * c.offCourseDeg) / 45;
}

/** Every lap up the same hill makes a ride a bit duller than one over different climbs. */
const laps = (c: Candidate) => (isLapShape(c.shape) ? c.shape.laps : 0);

/**
 * Lower is better. Repeated roads weigh most: a route that hits the numbers by riding the same
 * road twice is not what a cyclist asked for, unless it's laps of a climb to get the climbing.
 */
function score(c: Candidate, t: Targets, penaliseOverlap: boolean) {
  return 2 * distanceError(c, t) + 1.5 * elevationError(c.ascentM, t) + (penaliseOverlap ? 3 * c.overlap : 0) + 0.05 * laps(c) + ride(c);
}

/** Climbing once the distance is tuned; laps already ride the hill the best number of times. */
const projectedAscent = (c: Candidate, t: Targets) =>
  t.distanceM && !isLapShape(c.shape) ? (c.ascentM * t.distanceM) / c.lengthM : c.ascentM;

/**
 * First-round ranking, before the distance is tuned: judge climbing per km, not in total. A shape
 * on course for the climbing asked comes first, even if it rides a climb or a road twice.
 */
function potential(c: Candidate, t: Targets, penaliseOverlap: boolean) {
  const onCourse = withinTolerance({ ...c, ascentM: projectedAscent(c, t), lengthM: t.distanceM ?? c.lengthM }, t);
  return (
    (onCourse ? 0 : 10) + 1.5 * elevationError(projectedAscent(c, t), t) + (penaliseOverlap ? 3 * c.overlap : 0) + 0.2 * distanceError(c, t) + ride(c)
  );
}

/** Eight directions, opposite ones first, so a round cut short by the time budget still covers every side. */
const HEADINGS = [0, 180, 90, 270, 45, 225, 135, 315];
const COMPASS_DEG: Record<Compass, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
/** A loop asked to head somewhere keeps its far side within 45° of that direction. */
const DIRECTION_SPREAD = [0, -25, 25, -45, 45];

interface Zone extends NoGoZone {
  name: string;
}

/** Radius of the circle to keep out of: the place's outline when known, else a typical size for its kind. */
function zoneRadiusM(place: GeocodedPlace): number {
  if (place.extent) {
    const [minLon, minLat, maxLon, maxLat] = place.extent;
    const widthM = haversineM({ lat: place.lat, lon: minLon }, { lat: place.lat, lon: maxLon });
    const heightM = haversineM({ lat: minLat, lon: place.lon }, { lat: maxLat, lon: place.lon });
    return Math.min(Math.max((0.45 * (widthM + heightM)) / 2, 300), 5000);
  }
  return { town: 1500, area: 2000, street: 200, address: 300, poi: 300 }[place.kind];
}

/** Shaping points that fall in a zone move just outside it, so the router isn't asked to go there. */
function moveOutOfZones(points: LatLon[], zones: Zone[]): LatLon[] {
  return points.map((p) => {
    const zone = zones.find((z) => haversineM(p, z) < z.radiusM);
    if (!zone) return p;
    const { x, y } = localPlane(zone).toXY(p);
    const bearing = x === 0 && y === 0 ? 0 : (Math.atan2(x, y) * 180) / Math.PI;
    return destination(zone, bearing, zone.radiusM + 500);
  });
}

/** Router no-go zones are circles, so a track may graze the edge; entering well inside is a miss. */
const entersZone = (track: TrackPoint[], zones: Zone[]) =>
  zones.some((z) => track.some(([lon, lat]) => haversineM({ lat, lon }, z) < 0.8 * z.radiusM));

export function createPlannerService({ geocoding, routing, budgetMs = PLAN_BUDGET_MS, cutoffMs = PLAN_CUTOFF_MS, climbs }: Deps) {
  async function resolvePlace(ref: PlaceRef, pins: Pin[], preferArea: boolean, signal?: AbortSignal): Promise<Resolved> {
    if (ref.type === "pin") {
      const pin = pins.find((p) => p.label === ref.label);
      if (!pin) throw new DomainError("bad_request", `Pin ${ref.label} isn't on the map.`);
      geocoding.assertInServiceArea(pin, `Pin ${pin.label}`);
      return { lat: pin.lat, lon: pin.lon, name: `Pin ${pin.label}` };
    }
    const place = await geocoding.resolve(ref.text, { preferArea, signal });
    return { lat: place.lat, lon: place.lon, name: place.name };
  }

  async function resolveZone(ref: PlaceRef, pins: Pin[], signal?: AbortSignal): Promise<Zone> {
    if (ref.type === "pin") return { ...(await resolvePlace(ref, pins, false, signal)), radiusM: 300 };
    const place = await geocoding.resolve(ref.text, { preferArea: true, signal });
    return { lat: place.lat, lon: place.lon, name: place.name, radiusM: zoneRadiusM(place) };
  }

  return {
    async plan(intent: RouteIntent, pins: Pin[], signal?: AbortSignal): Promise<Route> {
      const startedAt = Date.now();
      const outOfTime = () => Date.now() - startedAt > budgetMs;
      let routingCalls = 0;
      let noRoute: DomainError | null = null;
      let found = 0;
      const cutoff = new AbortController();
      const cutoffTimer = setTimeout(() => found > 0 && cutoff.abort(), cutoffMs);
      const routeSignal = signal ? AbortSignal.any([signal, cutoff.signal]) : cutoff.signal;
      try {
        const [[start, end, ...vias], zones] = await Promise.all([
          Promise.all([
            resolvePlace(intent.start, pins, false, signal),
            intent.end ? resolvePlace(intent.end, pins, false, signal) : null,
            ...intent.via.map((v) => resolvePlace(v.place, pins, v.kind === "area", signal)),
          ]),
          Promise.all(intent.avoid.map((ref) => resolveZone(ref, pins, signal))),
        ]);
        const via = vias as Resolved[];
        for (const anchor of [start!, ...(end ? [end] : []), ...via]) {
          const zone = zones.find((z) => haversineM(anchor, z) < z.radiusM);
          if (zone) throw new DomainError("bad_request", `${anchor.name} is inside ${zone.name}, which you asked to avoid.`);
        }
        const isLoop = !end || haversineM(start!, end) < SAME_PLACE_M;
        const finish = isLoop ? start! : end;
        const notes: string[] = [];

        let distanceKm = intent.distanceKm;
        if (distanceKm === null && isLoop && via.length === 0) {
          distanceKm = DEFAULT_LOOP_KM;
          notes.push(`No distance given, so this loop aims for ${DEFAULT_LOOP_KM} km.`);
        }
        const targets: Targets = {
          distanceM: distanceKm === null ? null : distanceKm * 1000,
          elevationM: intent.elevationGainM,
        };
        const anchors = [start!, ...via, finish];
        const keep = via.filter((_, i) => intent.via[i]!.kind === "point");
        const penaliseOverlap = !intent.outAndBack;
        const headingDeg = isLoop && intent.direction ? COMPASS_DEG[intent.direction] : null;

        // The router drops requests beyond the ones it can run at once, and laps make several per shape.
        const limit = createLimiter(PARALLEL_ROUTES);
        const route = (points: LatLon[]) =>
          limit(() => {
            routingCalls++;
            return routing.route(points, intent.bike, { avoid: zones, signal: routeSignal });
          });
        // One lap is routed once per hill and ridden as many times as asked.
        const lapRoutes = new Map<string, Promise<RoutedTrack>>();
        function routeLap(lap: LatLon[]) {
          const key = lap.map((p) => `${p.lon},${p.lat}`).join("|");
          if (!lapRoutes.has(key)) lapRoutes.set(key, route(lap));
          return lapRoutes.get(key)!;
        }

        /** The ride to the hill, the laps, and the last lap and ride home, joined into one track. */
        function joinLaps(laps: number, { there, once, home }: LapParts): RoutedTrack {
          const again = Array.from({ length: laps - 1 }, () => once.track.slice(1)).flat();
          return {
            track: [...there.track, ...again, ...home.track.slice(1)],
            trafficLights: there.trafficLights + (laps - 1) * once.trafficLights + home.trafficLights,
          };
        }

        async function evaluate(shape: Shape, scale: number): Promise<Candidate | null> {
          const waypoints = moveOutOfZones(shape.waypoints(scale), zones);
          let routed: RoutedTrack;
          let lapParts: LapParts | undefined;
          try {
            if (isLapShape(shape)) {
              const { out, lap, back } = shape.parts(shape.waypoints(scale));
              const parts = await Promise.all([route(moveOutOfZones(out, zones)), routeLap(lap), route(moveOutOfZones(back, zones))]);
              // Trimmed piece by piece: the joined track rides the same spots so often that trimming it whole is slow.
              const [there, once, home] = parts.map((p) => (penaliseOverlap ? { ...p, track: trimSpurs(p.track, { keep: [...keep, ...shape.keep!] }) } : p));
              lapParts = { there: there!, once: once!, home: home! };
              routed = joinLaps(shape.laps, lapParts);
            } else {
              routed = await route(waypoints);
            }
          } catch (err) {
            if (cutoff.signal.aborted && !signal?.aborted) return null;
            // A shaping point in a lake or a military zone only rules out this candidate; if every
            // candidate fails, it's likely one of the rider's own places, and they are told why.
            if (err instanceof DomainError && err.code === "no_route") {
              noRoute ??= err;
              return null;
            }
            throw err;
          }
          return candidate(shape, scale, waypoints, routed, lapParts);
        }

        function candidate(shape: Shape, scale: number, waypoints: LatLon[], routed: RoutedTrack, lapParts?: LapParts): Candidate | null {
          let track = routed.track;
          if (entersZone(track, zones)) return null;
          if (penaliseOverlap && !lapParts) track = trimSpurs(track, { keep: [...keep, ...(shape.keep ?? [])] });
          const lengthM = trackLengthM(track);
          const straightM = Math.max(pathLengthM(waypoints), 1);
          return {
            shape,
            scale,
            track,
            lengthM,
            ...elevationStats(track),
            overlap: penaliseOverlap ? overlapRatio(track, { ignore: shape.repeatsIn }) : 0,
            roadFactor: lengthM / straightM,
            lightsPerKm: routed.trafficLights / Math.max(lengthM / 1000, 1),
            offCourseDeg: headingDeg === null ? 0 : angleDiffDeg(bearingDeg(start!, farthestFrom(start!, track)), headingDeg),
            lapParts,
          };
        }

        const closeness = (c: Candidate) =>
          isLapShape(c.shape) ? 2 * distanceError(c, targets) + 1.5 * elevationError(c.ascentM, targets) : distanceError(c, targets);

        /**
         * The number of laps closest to the distance and climbing asked, between the one the climbing
         * calls for and the one the distance does: the same roads, so no routing.
         */
        function bestLaps(c: Candidate): Candidate {
          if (!isLapShape(c.shape) || !c.lapParts) return c;
          const { laps: now, maxLaps } = c.shape;
          const lap = c.lapParts.once.track;
          const lapAscentM = Math.max(elevationStats(lap).ascentM, 1);
          const forClimbing = now + (targets.elevationM! - c.ascentM) / lapAscentM;
          const forDistance = now + (targets.distanceM! - c.lengthM) / Math.max(trackLengthM(lap), 1);
          let best = c;
          const from = Math.max(1, Math.round(Math.min(forClimbing, forDistance)));
          for (let laps = from; laps <= Math.min(maxLaps, Math.round(Math.max(forClimbing, forDistance)), from + 6); laps++) {
            if (laps === now) continue;
            const shape = c.shape.withLaps(laps);
            const next = candidate(shape, c.scale, moveOutOfZones(shape.waypoints(c.scale), zones), joinLaps(laps, c.lapParts), c.lapParts);
            if (next && closeness(next) < closeness(best)) best = next;
          }
          return best;
        }

        async function refine(c: Candidate): Promise<Candidate> {
          let best = bestLaps(c);
          for (let i = 0; i < MAX_REFINEMENTS && targets.distanceM && !outOfTime(); i++) {
            if (distanceError(best, targets) <= TOLERANCE.distance / 3) break;
            const scale = scaleForLength(best.shape, targets.distanceM / best.roadFactor);
            if (Math.abs(scale - best.scale) <= 1e-3 * Math.max(1, Math.abs(best.scale))) break;
            const next = await evaluate(best.shape, scale);
            if (!next) break;
            const tuned = bestLaps(next);
            if (closeness(tuned) < closeness(best)) best = tuned;
            else break;
          }
          return best;
        }

        const wantsClimbs = climbs && isLoop && targets.distanceM && targets.elevationM;
        const paved = intent.bike === "road";
        const climbShapes = wantsClimbs
          ? climbLoops({
              start: start!,
              through: via,
              climbs: climbs.near(start!, 0.4 * targets.distanceM!, { paved }),
              distanceM: targets.distanceM!,
              elevationM: targets.elevationM!,
              headingDeg,
            })
          : [];
        // More climbing than the climbs around give once each: laps of the best hill, around the
        // place the rider named if they did.
        const lapShapes =
          wantsClimbs && via.length <= 1
            ? climbLaps({
                start: start!,
                through: intent.via[0]?.kind === "point" ? via[0] : undefined,
                climbs: via.length ? climbs.near(via[0]!, CLIMB_AREA_M, { paved }) : climbs.near(start!, 0.4 * targets.distanceM!, { paved }),
                distanceM: targets.distanceM!,
                elevationM: targets.elevationM!,
                headingDeg,
              })
            : [];
        // With laps on offer, loops whose climbs give well under the climbing asked only take time.
        const worthTrying = lapShapes.length
          ? climbShapes.filter((shape) => shape.climbs.reduce((sum, c) => sum + c.gainM, 0) >= 0.35 * targets.elevationM!)
          : climbShapes;
        const starts = buildStarts({
          start: start!,
          anchors,
          isLoop,
          via,
          targets,
          outAndBack: intent.outAndBack,
          direction: intent.direction,
          detour: zones.length > 0,
          // Laps where the rider asked for them come first; otherwise both kinds get tried early.
          climbShapes: via.length ? [...lapShapes, ...worthTrying] : interleave(worthTrying, lapShapes),
        });
        const firstRound = (
          await mapWithConcurrency(starts, PARALLEL_ROUTES, async ({ shape, scale }) => {
            if (found > 0 && outOfTime()) return null;
            const c = await evaluate(shape, scale ?? scaleForLength(shape, (targets.distanceM ?? 0) / INITIAL_ROAD_FACTOR));
            if (c) found++;
            return c && bestLaps(c);
          })
        ).filter((c): c is Candidate => c !== null);
        if (firstRound.length === 0) {
          const around = zones.length ? ` that stays out of ${zones.map((z) => z.name).join(" and ")}` : "";
          throw noRoute ?? new DomainError("no_route", `We couldn't find a rideable route here${around}.`);
        }

        // The best laps are tuned on top, not instead: a ride over different climbs is nicer when it can match.
        const ranked = [...firstRound].sort((a, b) => potential(a, targets, penaliseOverlap) - potential(b, targets, penaliseOverlap));
        const shortlist = [
          ...ranked.filter((c) => !isLapShape(c.shape)).slice(0, REFINED_CANDIDATES),
          ...ranked.filter((c) => isLapShape(c.shape)).slice(0, REFINED_LAPS),
        ];
        const refined = await mapWithConcurrency(shortlist, PARALLEL_ROUTES, refine);
        // A route that matches the request beats any that doesn't, however nice; when none does,
        // the closest one is returned, saying what it misses.
        const matching = refined.filter((c) => withinTolerance(c, targets));
        const best = matching.length
          ? matching.sort((a, b) => score(a, targets, penaliseOverlap) - score(b, targets, penaliseOverlap))[0]!
          : refined.sort((a, b) => score(a, targets, penaliseOverlap) - ride(a) - (score(b, targets, penaliseOverlap) - ride(b)))[0]!;
        console.info(`planned in ${Date.now() - startedAt} ms with ${routingCalls} routing calls`);
        const climbed = (best.shape as Partial<ClimbShape>).climbs;
        if (climbed?.length) {
          const times = isLapShape(best.shape) ? `, ridden ${best.shape.laps} times` : "";
          notes.push(`Climbs: ${climbed.map((c) => `${c.name ?? "unnamed road"} (${(c.lengthM / 1000).toFixed(1)} km at ${Math.round(c.avgGrade * 100)}%)`).join(", ")}${times}.`);
        }
        if (penaliseOverlap && best.overlap > 0.25) {
          notes.push("Some roads are ridden twice: there aren't many ways around here.");
        }

        const waypoints: RouteWaypoint[] = [
          { ...point(start!), name: start!.name, role: "start" },
          ...via.map((v) => ({ ...point(v), name: v.name, role: "via" as const })),
          ...(isLoop ? [] : [{ ...point(finish), name: finish.name, role: "end" as const }]),
        ];
        return {
          track: best.track,
          distanceM: Math.round(best.lengthM),
          ascentM: best.ascentM,
          descentM: best.descentM,
          waypoints,
          targets: { distanceKm, elevationGainM: intent.elevationGainM },
          bike: intent.bike,
          isLoop,
          notes,
          missed: matching.length ? null : missedTargets(best, targets),
        };
      } finally {
        clearTimeout(cutoffTimer);
      }
    },
  };
}

const point = ({ lat, lon }: LatLon): LatLon => ({ lat, lon });

const interleave = <T,>(a: T[], b: T[]) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a[i], b[i]]).flat().filter((x): x is T => x !== undefined);

function farthestFrom(from: LatLon, track: TrackPoint[]): LatLon {
  let best = from;
  let bestM = 0;
  for (const [lon, lat] of track) {
    const m = haversineM(from, { lat, lon });
    if (m > bestM) [best, bestM] = [{ lat, lon }, m];
  }
  return best;
}

interface StartOptions {
  start: LatLon;
  anchors: LatLon[];
  isLoop: boolean;
  via: LatLon[];
  targets: Targets;
  outAndBack: boolean;
  direction: Compass | null;
  /** Places to avoid: worth trying routes bent to either side even when the straight one looks fine. */
  detour: boolean;
  /** Loops over known climbs, tried first when there are some. */
  climbShapes: Shape[];
}

/** The candidate shapes worth trying for this request, with a fixed scale when there's no distance to aim for. */
function buildStarts({ start, anchors, isLoop, via, targets, outAndBack: backAllowed, direction, detour, climbShapes }: StartOptions) {
  const starts: { shape: Shape; scale?: number }[] = [];
  const wantsClimb = targets.elevationM !== null;

  if (isLoop && via.length === 0) {
    // Try every direction (or every angle around the one asked): the terrain, and so the climbing,
    // differs a lot from one side to another.
    const headings = direction ? DIRECTION_SPREAD.map((d) => (COMPASS_DEG[direction] + d + 360) % 360) : HEADINGS;
    starts.push(...climbShapes.map((shape) => ({ shape })));
    starts.push(...headings.map((h) => ({ shape: ellipseLoop(start, h) })));
    // Stretched loops reach further for hills; known climbs do that better when there are some.
    if (wantsClimb && climbShapes.length === 0) starts.push(...headings.map((h) => ({ shape: ellipseLoop(start, h, { aspect: 1.8 }) })));
    if (backAllowed) starts.push(...headings.map((h) => ({ shape: outAndBack(start, h) })));
    return starts;
  }

  const variants = isLoop
    ? [{ at: 0.5 }, { at: 0.35 }, { at: 0.65 }].map((v) => bentLegs(anchors, v))
    : [bentLegs(anchors, { side: 1 }), bentLegs(anchors, { side: -1 })];

  if (targets.distanceM !== null) {
    starts.push(...climbShapes.map((shape) => ({ shape })));
    starts.push(...variants.map((shape) => ({ shape })));
    // Bending both legs out makes the loop cross whatever lies on either side; keep to one side too.
    if (isLoop && via.length === 1) starts.push(...([1, -1] as const).map((side) => ({ shape: loopThrough(start, via[0]!, side) })));
  } else {
    // No distance to hit: go straight through the anchors unless that means doubling back.
    starts.push({ shape: variants[0]!, scale: 0 });
    if (isLoop && !backAllowed) starts.push(...variants.map((shape) => ({ shape, scale: via.length === 1 ? 0.25 : 0.12 })));
    else if (detour) starts.push(...variants.map((shape) => ({ shape, scale: 0.3 })));
  }
  return starts;
}

function missedTargets(best: Candidate, t: Targets): string {
  const km = (m: number) => `${Math.round(m / 1000)} km`;
  const found = `${km(best.lengthM)} with ${best.ascentM} m of climbing`;
  const asked = [t.distanceM && km(t.distanceM), t.elevationM !== null && `${t.elevationM} m of climbing`]
    .filter(Boolean)
    .join(" and ");
  const hint =
    t.distanceM && best.lengthM > t.distanceM * (1 + TOLERANCE.distance) && best.scale === best.shape.minScale
      ? " The places you asked for are too far apart for that distance."
      : t.elevationM !== null && best.ascentM < t.elevationM
        ? " There isn't enough climbing around here for that distance."
        : "";
  return `You asked for ${asked}; this is the closest we found: ${found}.${hint}`;
}
export type PlannerService = ReturnType<typeof createPlannerService>;
