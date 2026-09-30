import type { LatLon } from "@find-my-path/shared";
import { localPlane, pathLengthM } from "./planner.geometry";

/**
 * A family of waypoint sequences indexed by one scale parameter: the bigger the scale, the
 * longer the straight-line path through the waypoints. The planner picks the scale that makes
 * the routed track hit the target distance.
 */
export interface Shape {
  label: string;
  waypoints(scale: number): LatLon[];
  minScale: number;
  maxScale: number;
}

/** Scale whose straight-line length is closest to `lengthM` (bisection; length grows with scale). */
export function scaleForLength(shape: Shape, lengthM: number): number {
  let lo = shape.minScale;
  let hi = shape.maxScale;
  if (pathLengthM(shape.waypoints(lo)) >= lengthM) return lo;
  if (pathLengthM(shape.waypoints(hi)) <= lengthM) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (pathLengthM(shape.waypoints(mid)) < lengthM) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Loop from `start` around an ellipse lying in direction `headingDeg`. Scale is the ellipse's
 * half-length in metres; `aspect` > 1 stretches it along the heading to reach further out.
 */
export function ellipseLoop(start: LatLon, headingDeg: number, { points = 3, aspect = 1 } = {}): Shape {
  const plane = localPlane(start);
  const h = (headingDeg * Math.PI) / 180;
  const ux = Math.sin(h);
  const uy = Math.cos(h);
  return {
    label: `loop ${Math.round(headingDeg)}° x${aspect}`,
    minScale: 500,
    maxScale: 150_000,
    waypoints(scale) {
      const a = scale;
      const b = scale / aspect;
      const out: LatLon[] = [start];
      for (let k = 1; k <= points; k++) {
        // Angle around the ellipse, starting from the start point (at -a on the major axis).
        const t = Math.PI + (2 * Math.PI * k) / (points + 1);
        const along = a + a * Math.cos(t);
        const across = b * Math.sin(t);
        out.push(plane.toLatLon({ x: ux * along + uy * across, y: uy * along - ux * across }));
      }
      out.push(start);
      return out;
    },
  };
}

function signedArea(points: { x: number; y: number }[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/**
 * Keeps the rider's anchors (start, places to pass, end) and bends each leg sideways through a
 * shaping point. Scale is the bend as a fraction of the leg length: 0 goes straight through
 * the anchors. On a loop the bends point outwards, so going to a place and back uses two
 * different sides instead of the same road twice. Legs listed in `fixed` (by the index of the
 * anchor they end at) stay straight: a climb must be ridden as it is.
 */
export function bentLegs(anchors: LatLon[], { at = 0.5, side = 1, fixed = new Set<number>() } = {}): Shape {
  const plane = localPlane(anchors[0]!);
  const xy = anchors.map(plane.toXY);
  const isLoop = anchors.length > 2 && pathLengthM([anchors[0]!, anchors[anchors.length - 1]!]) < 1;
  // Right of travel is outward on a clockwise polygon; flip for counter-clockwise ones.
  const area = isLoop ? signedArea(xy.slice(0, -1)) : 0;
  const outward = area > 0 ? -1 : 1;
  return {
    label: `bent legs at ${at} side ${side}`,
    minScale: 0,
    maxScale: 3,
    waypoints(scale) {
      const out: LatLon[] = [anchors[0]!];
      for (let i = 1; i < xy.length; i++) {
        const a = xy[i - 1]!;
        const b = xy[i]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (scale > 0 && len > 300 && !fixed.has(i)) {
          const off = scale * side * outward;
          out.push(plane.toLatLon({ x: a.x + dx * at + dy * off, y: a.y + dy * at - dx * off }));
        }
        out.push(anchors[i]!);
      }
      return out;
    },
  };
}

/** Straight out to a turnaround point and back the same way, for riders who asked for that. */
export function outAndBack(start: LatLon, headingDeg: number): Shape {
  const plane = localPlane(start);
  const h = (headingDeg * Math.PI) / 180;
  return {
    label: `out and back ${Math.round(headingDeg)}°`,
    minScale: 250,
    maxScale: 150_000,
    waypoints: (scale) => [start, plane.toLatLon({ x: Math.sin(h) * scale, y: Math.cos(h) * scale }), start],
  };
}
