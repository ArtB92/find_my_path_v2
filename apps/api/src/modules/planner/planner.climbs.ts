import type { LatLon } from "@find-my-path/shared";
import type { Climb } from "../climbs";
import { angleDiffDeg, bearingDeg, haversineM, localPlane, pathLengthM } from "./planner.geometry";
import { bentLegs, type Shape } from "./planner.shapes";

export interface ClimbShape extends Shape {
  climbs: Climb[];
}

interface Options {
  start: LatLon;
  /** Places the rider asked to pass, in any order: the loop visits them where they sit around the start. */
  through?: LatLon[];
  climbs: Climb[];
  distanceM: number;
  elevationM: number;
  /** Compass bearing the loop should head towards, if the rider asked. */
  headingDeg: number | null;
  max?: number;
}

/** The loop can't reach further out than this share of its length. */
const REACH = 0.38;
/** Typical road-to-straight-line ratio: a chain of climbs longer than the loop allows is no use. */
const ROAD_FACTOR = 1.15;
/**
 * How much of the asked climbing the chosen climbs should give; the roads in between give the
 * rest, or not: the last share asks the climbs for more than the whole target.
 */
const SHARES = [0.3, 0.6, 0.9, 1.2];
const MAX_CLIMBS = 8;
/** Climbs are picked within this angle of the loop's main side, so the loop zigzags between them. */
const SAME_SIDE_DEG = 90;
/** With no other climb within reach, the best one is ridden again (at most this many times). */
const MAX_REPEATS = 2;

const toLatLon = ([lon, lat]: [number, number]): LatLon => ({ lat, lon });
const gainOf = (set: Climb[]) => set.reduce((sum, c) => sum + c.gainM, 0);

/**
 * Loops that ride up real climbs, bottom to top: sets of climbs on one side of the start, chained
 * in the order they sit around it, with the legs between them free to bend so the loop's length
 * can be tuned like any other shape. Places the rider asked to pass are chained in the same way.
 */
export function climbLoops({ start, through = [], climbs, distanceM, elevationM, headingDeg, max = 6 }: Options): ClimbShape[] {
  const plane = localPlane(start);
  const bearingOf = (p: LatLon) => {
    const { x, y } = plane.toXY(p);
    return (Math.atan2(x, y) * 180) / Math.PI;
  };
  const bearing = (c: Climb) => bearingOf(toLatLon(c.path[Math.floor(c.path.length / 2)]!));
  const distanceTo = (c: Climb) => haversineM(start, toLatLon(c.path[0]!));
  const usable = climbs
    .filter((c) => {
      const d = distanceTo(c);
      return d > 300 && d < REACH * distanceM && (headingDeg === null || angleDiffDeg(bearing(c), headingDeg) <= 60);
    })
    .sort((a, b) => b.gainM - a.gainM)
    .slice(0, 60);
  const limitM = distanceM / ROAD_FACTOR;
  const value = (x: Climb) => x.gainM / Math.sqrt(distanceTo(x));

  // Each seed sets the side the loop goes to. With places to pass, that side is theirs; otherwise
  // one seed per side of the start, the climb worth the most for how far away it is, so the
  // candidates explore different hills instead of all chasing the single biggest one.
  const seeds: { side: number; set: Climb[] }[] = [];
  if (through.length) {
    const side = bearingOf(through[0]!);
    const near = usable.filter((c) => angleDiffDeg(bearing(c), side) <= SAME_SIDE_DEG).sort((a, b) => value(b) - value(a));
    seeds.push({ side, set: [] }, ...near.slice(0, 3).map((c) => ({ side, set: [c] })));
  } else {
    const bySector = new Map<number, Climb>();
    for (const c of usable) {
      const sector = Math.round((((bearing(c) % 360) + 360) % 360) / 45) % 8;
      if (!bySector.has(sector) || value(c) > value(bySector.get(sector)!)) bySector.set(sector, c);
    }
    seeds.push(...[...bySector.values()].map((c) => ({ side: bearing(c), set: [c] })));
  }

  const bySeed: { shape: ClimbShape; miss: number; key: string }[][] = [];
  for (const seed of seeds) {
    const around = (b: number) => ((b - seed.side + 540) % 360) - 180;
    const build = (set: Climb[]) => chain(start, set, through, (c) => around(bearing(c)), (p) => around(bearingOf(p)));
    const found: { shape: ClimbShape; miss: number; key: string }[] = [];
    for (const share of SHARES) {
      const want = share * elevationM;
      let set = seed.set;
      let shape = build(set);
      let lengthM = pathLengthM(shape.waypoints(0));
      if (lengthM > limitM) break;
      // Add the climb that gives the most height for the extra distance it costs, until there's enough.
      while (gainOf(set) < want && set.length < MAX_CLIMBS) {
        let best: { climb: Climb; shape: ClimbShape; lengthM: number; ratio: number } | null = null;
        const consider = (other: Climb) => {
          const bigger = build([...set, other]);
          const biggerM = pathLengthM(bigger.waypoints(0));
          if (biggerM > limitM) return;
          const ratio = other.gainM / Math.max(biggerM - lengthM, 500);
          if (!best || ratio > best.ratio) best = { climb: other, shape: bigger, lengthM: biggerM, ratio };
        };
        for (const other of usable) {
          if (set.includes(other) || Math.abs(around(bearing(other))) > SAME_SIDE_DEG) continue;
          // Two climbs to the same top would ride the same hill twice.
          if (set.some((c) => haversineM(toLatLon(c.path.at(-1)!), toLatLon(other.path.at(-1)!)) < 1000)) continue;
          consider(other);
        }
        // Nothing new within reach: ride again the climbs already in the loop.
        if (!best) for (const again of new Set(set)) if (set.filter((c) => c === again).length < MAX_REPEATS) consider(again);
        if (!best) break;
        const picked: { climb: Climb; shape: ClimbShape; lengthM: number } = best;
        set = [...set, picked.climb];
        shape = picked.shape;
        lengthM = picked.lengthM;
      }
      const key = set.map((c) => c.id).sort().join(",");
      if (set.length && !found.some((f) => f.key === key)) found.push({ shape, miss: Math.abs(gainOf(set) - want) / want, key });
    }
    bySeed.push(found.sort((a, b) => a.miss - b.miss));
  }

  // Take the best of each side in turn.
  const out: ClimbShape[] = [];
  const keys = new Set<string>();
  bySeed.sort((a, b) => (a[0]?.miss ?? Infinity) - (b[0]?.miss ?? Infinity));
  for (let round = 0; out.length < max && bySeed.some((f) => f.length > round); round++) {
    for (const found of bySeed) {
      const f = found[round];
      if (f && !keys.has(f.key) && out.length < max) {
        keys.add(f.key);
        out.push(f.shape);
      }
    }
  }
  return out;
}

/**
 * Start, then each climb bottom to top and each place to pass, in the order they sit around the
 * start (whichever way round is shorter), then start again.
 */
function chain(
  start: LatLon,
  set: Climb[],
  through: LatLon[],
  climbAngle: (c: Climb) => number,
  pointAngle: (p: LatLon) => number,
): ClimbShape {
  const items = [
    ...set.map((climb) => ({ angle: climbAngle(climb), points: climb.path.map(toLatLon), climb })),
    ...through.map((p) => ({ angle: pointAngle(p), points: [p], climb: null })),
  ].sort((a, b) => a.angle - b.angle);
  const orders = [items, [...items].reverse()].map((order) => {
    const anchors = [start, ...order.flatMap((item) => item.points), start];
    return { order, anchors, length: pathLengthM(anchors) };
  });
  const best = orders[0]!.length <= orders[1]!.length ? orders[0]! : orders[1]!;
  const fixed = new Set<number>();
  let index = 1;
  for (const item of best.order) {
    // Legs ending at the 2nd..last point of a climb run along it.
    if (item.climb) for (let k = 1; k < item.points.length; k++) fixed.add(index + k);
    index += item.points.length;
  }
  const ridden = best.order.flatMap((item) => (item.climb ? [item.climb] : []));
  const shape = bentLegs(best.anchors, { fixed });
  return {
    ...shape,
    label: `climbs ${ridden.map((c) => c.name ?? c.id).join(", ")}`,
    climbs: ridden,
    // A climb up to a dead end is still the point of the ride.
    keep: ridden.map((c) => toLatLon(c.path.at(-1)!)),
  };
}

export interface LapShape extends ClimbShape {
  laps: number;
  maxLaps: number;
  /** The same ride with another number of laps. */
  withLaps(laps: number): LapShape;
  /** Waypoints split into the ride to the hill, one lap back to its foot, and the last lap and ride home. */
  parts(waypoints: LatLon[]): { out: LatLon[]; lap: LatLon[]; back: LatLon[] };
}

export const isLapShape = (shape: Shape): shape is LapShape => "withLaps" in shape;

interface LapOptions {
  start: LatLon;
  /** A place the rider asked to pass, on the way to the hill. */
  through?: LatLon;
  /** Climbs to choose from: around the place the rider named for them, or within reach of the start. */
  climbs: Climb[];
  distanceM: number;
  elevationM: number;
  headingDeg: number | null;
  max?: number;
}

/** Climbs ridden in one lap start within this distance of each other, so the lap stays on one hill. */
const LAP_SPREAD_M = 2500;
const MAX_LAP_CLIMBS = 3;
/** Climbing the roads to and from the laps typically give, per km. */
const APPROACH_M_PER_KM = 4;

/**
 * Loops that ride to a hill and climb it again and again: each lap rides up one to three climbs
 * that start close together, back down, and round again, as many times as the climbing asked
 * needs and the distance allows. The legs to and from the hill bend like any other shape's, so
 * the loop's length is tuned the same way.
 */
export function climbLaps({ start, through, climbs, distanceM, elevationM, headingDeg, max = 3 }: LapOptions): LapShape[] {
  const bottomOf = (c: Climb) => toLatLon(c.path[0]!);
  const usable = climbs
    .filter((c) => {
      const d = haversineM(start, bottomOf(c));
      return d > 300 && d < REACH * distanceM && (headingDeg === null || angleDiffDeg(bearingDeg(start, bottomOf(c)), headingDeg) <= 60);
    })
    .sort((a, b) => b.gainM - a.gainM)
    .slice(0, 40);
  const limitM = distanceM / ROAD_FACTOR;

  const options: { set: Climb[]; laps: number; maxLaps: number; centre: LatLon; rank: number }[] = [];
  for (const seed of usable) {
    const set = [seed];
    for (const other of usable) {
      if (set.length === MAX_LAP_CLIMBS) break;
      if (!set.includes(other) && haversineM(bottomOf(seed), bottomOf(other)) < LAP_SPREAD_M) set.push(other);
    }
    const lapM = lapLengthM(set);
    const transitM = 2 * haversineM(start, bottomOf(seed));
    const maxLaps = Math.floor((limitM - transitM) / lapM);
    if (maxLaps < 1) continue;
    const gain = gainOf(set);
    // Laps climb `gain` each; the rest of the ride climbs a little too, less the more of it is laps.
    const perLapM = gain - (APPROACH_M_PER_KM * lapM * ROAD_FACTOR) / 1000;
    const laps = Math.min(maxLaps, Math.max(1, Math.round((elevationM - (APPROACH_M_PER_KM * distanceM) / 1000) / perLapM)));
    const expected = (APPROACH_M_PER_KM * distanceM) / 1000 + laps * perLapM;
    const miss = Math.max(0, Math.abs(expected - elevationM) / elevationM - 0.1);
    // Closest to the climbing asked first, then the fewest times up the same road, then the nearest.
    options.push({ set, laps, maxLaps, centre: bottomOf(seed), rank: 10 * miss + 0.03 * laps + transitM / distanceM });
  }

  const out: LapShape[] = [];
  for (const o of options.sort((a, b) => a.rank - b.rank)) {
    if (out.length === max) break;
    if (out.some((s) => haversineM(s.repeatsIn!, o.centre) < LAP_SPREAD_M)) continue;
    out.push(lapShape(start, through, o.set, o.laps, o.maxLaps));
  }
  return out;
}

/** Up every climb of the set, then back to the first one's foot. */
function lapLengthM(set: Climb[]): number {
  const points = set.flatMap((c) => c.path.map(toLatLon));
  return pathLengthM([...points, points[0]!]);
}

function lapShape(start: LatLon, through: LatLon | undefined, set: Climb[], laps: number, maxLaps: number): LapShape {
  const lap = set.flatMap((c) => c.path.map(toLatLon));
  const before = [start, ...(through ? [through] : [])];
  const anchors = [...before, ...Array.from({ length: laps }, () => lap).flat(), start];
  // Only the legs to and from the hill bend; the laps are ridden as they are.
  const fixed = new Set(Array.from({ length: anchors.length - before.length - 2 }, (_, i) => before.length + 1 + i));
  const shape = bentLegs(anchors, { fixed });
  const centre = lap.reduce((sum, p) => ({ lat: sum.lat + p.lat / lap.length, lon: sum.lon + p.lon / lap.length }), { lat: 0, lon: 0 });
  return {
    ...shape,
    label: `${laps} laps of ${set.map((c) => c.name ?? c.id).join(", ")}`,
    climbs: set,
    // Turning at the foot of a climb to ride it again is a dead end too.
    keep: set.flatMap((c) => [toLatLon(c.path[0]!), toLatLon(c.path.at(-1)!)]),
    repeatsIn: { ...centre, radiusM: Math.max(...lap.map((p) => haversineM(centre, p))) + 300 },
    laps,
    maxLaps,
    withLaps: (n) => lapShape(start, through, set, Math.min(maxLaps, Math.max(1, n)), maxLaps),
    parts: (waypoints) => {
      const foot = waypoints.indexOf(lap[0]!);
      return { out: waypoints.slice(0, foot + 1), lap: [...lap, lap[0]!], back: waypoints.slice(waypoints.lastIndexOf(lap[0]!)) };
    },
  };
}
