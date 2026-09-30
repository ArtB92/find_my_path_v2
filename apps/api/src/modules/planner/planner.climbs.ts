import type { LatLon } from "@find-my-path/shared";
import type { Climb } from "../climbs";
import { haversineM, localPlane, pathLengthM } from "./planner.geometry";
import { bentLegs, type Shape } from "./planner.shapes";

export interface ClimbShape extends Shape {
  climbs: Climb[];
}

interface Options {
  start: LatLon;
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
/** How much of the asked climbing the chosen climbs should give; the roads in between give the rest. */
const SHARES = [0.3, 0.6, 0.9];
const MAX_CLIMBS = 4;
const SAME_SIDE_DEG = 70;

const toLatLon = ([lon, lat]: [number, number]): LatLon => ({ lat, lon });
const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const gainOf = (set: Climb[]) => set.reduce((sum, c) => sum + c.gainM, 0);

/**
 * Loops that ride up real climbs, bottom to top: sets of climbs on one side of the start, chained
 * in the order they sit around it, with the legs between them free to bend so the loop's length
 * can be tuned like any other shape.
 */
export function climbLoops({ start, climbs, distanceM, elevationM, headingDeg, max = 6 }: Options): ClimbShape[] {
  const plane = localPlane(start);
  const bearing = (c: Climb) => {
    const { x, y } = plane.toXY(toLatLon(c.path[Math.floor(c.path.length / 2)]!));
    return (Math.atan2(x, y) * 180) / Math.PI;
  };
  const distanceTo = (c: Climb) => haversineM(start, toLatLon(c.path[0]!));
  const usable = climbs
    .filter((c) => {
      const d = distanceTo(c);
      return d > 300 && d < REACH * distanceM && (headingDeg === null || angleDiff(bearing(c), headingDeg) <= 60);
    })
    .sort((a, b) => b.gainM - a.gainM)
    .slice(0, 60);
  const limitM = distanceM / ROAD_FACTOR;

  // One seed per side of the start, the climb worth the most for how far away it is, so the
  // candidates explore different hills instead of all chasing the single biggest one.
  const seeds = new Map<number, Climb>();
  for (const c of usable) {
    const sector = Math.round((((bearing(c) % 360) + 360) % 360) / 45) % 8;
    const value = (x: Climb) => x.gainM / Math.sqrt(distanceTo(x));
    if (!seeds.has(sector) || value(c) > value(seeds.get(sector)!)) seeds.set(sector, c);
  }

  const bySeed: { shape: ClimbShape; miss: number; key: string }[][] = [];
  for (const seed of seeds.values()) {
    const around = (c: Climb) => ((bearing(c) - bearing(seed) + 540) % 360) - 180;
    const found: { shape: ClimbShape; miss: number; key: string }[] = [];
    for (const share of SHARES) {
      const want = share * elevationM;
      let set = [seed];
      let shape = chain(start, set, around);
      let lengthM = pathLengthM(shape.waypoints(0));
      if (lengthM > limitM) break;
      // Add the climb that gives the most height for the extra distance it costs, until there's enough.
      while (gainOf(set) < want && set.length < MAX_CLIMBS) {
        let best: { climb: Climb; shape: ClimbShape; lengthM: number; ratio: number } | null = null;
        for (const other of usable) {
          if (set.includes(other) || Math.abs(around(other)) > SAME_SIDE_DEG) continue;
          // Two climbs to the same top would ride the same hill twice.
          if (set.some((c) => haversineM(toLatLon(c.path.at(-1)!), toLatLon(other.path.at(-1)!)) < 1000)) continue;
          const bigger = chain(start, [...set, other], around);
          const biggerM = pathLengthM(bigger.waypoints(0));
          if (biggerM > limitM) continue;
          const ratio = other.gainM / Math.max(biggerM - lengthM, 500);
          if (!best || ratio > best.ratio) best = { climb: other, shape: bigger, lengthM: biggerM, ratio };
        }
        if (!best) break;
        set = [...set, best.climb];
        shape = best.shape;
        lengthM = best.lengthM;
      }
      const key = set.map((c) => c.id).sort().join(",");
      if (!found.some((f) => f.key === key)) found.push({ shape, miss: Math.abs(gainOf(set) - want) / want, key });
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

/** Start, each climb bottom to top in the order they sit around the start (whichever way round is shorter), start. */
function chain(start: LatLon, set: Climb[], angle: (c: Climb) => number): ClimbShape {
  const sorted = [...set].sort((a, b) => angle(a) - angle(b));
  const orders = [sorted, [...sorted].reverse()].map((order) => {
    const anchors = [start, ...order.flatMap((c) => c.path.map(toLatLon)), start];
    return { order, anchors, length: pathLengthM(anchors) };
  });
  const best = orders[0]!.length <= orders[1]!.length ? orders[0]! : orders[1]!;
  const fixed = new Set<number>();
  let index = 1;
  for (const c of best.order) {
    // Legs ending at the 2nd..last point of a climb run along it.
    for (let k = 1; k < c.path.length; k++) fixed.add(index + k);
    index += c.path.length;
  }
  const shape = bentLegs(best.anchors, { fixed });
  return { ...shape, label: `climbs ${best.order.map((c) => c.name ?? c.id).join(", ")}`, climbs: best.order };
}
