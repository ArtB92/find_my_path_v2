import type { LatLon } from "@find-my-path/shared";
import type { Climb } from "../climbs";
import { angleDiffDeg, haversineM, localPlane, pathLengthM } from "./planner.geometry";
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
