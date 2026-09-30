import { readFile } from "node:fs/promises";
import type { LatLon } from "@find-my-path/shared";
import { ClimbFileSchema, type Climb } from "./climbs.schema";

const CELL_DEG = 0.1;
const cell = (deg: number) => Math.floor(deg / CELL_DEG);

function distanceM(a: LatLon, b: LatLon) {
  const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lon - a.lon) * kx, (b.lat - a.lat) * 110_540);
}

export const climbStart = (c: Climb): LatLon => ({ lon: c.path[0]![0], lat: c.path[0]![1] });

/** In-memory lookup of the climbs around a point, on a 0.1° grid. */
export function createClimbIndex(climbs: Climb[]) {
  const grid = new Map<string, Climb[]>();
  for (const c of climbs) {
    const { lat, lon } = climbStart(c);
    const key = `${cell(lat)}:${cell(lon)}`;
    grid.set(key, [...(grid.get(key) ?? []), c]);
  }

  return {
    size: climbs.length,
    /** Climbs whose bottom lies within `radiusM` of `center`; `paved` keeps only those a road bike can ride. */
    near(center: LatLon, radiusM: number, { paved = false } = {}): Climb[] {
      const dLat = radiusM / 110_540;
      const dLon = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
      const out: Climb[] = [];
      for (let row = cell(center.lat - dLat); row <= cell(center.lat + dLat); row++) {
        for (let col = cell(center.lon - dLon); col <= cell(center.lon + dLon); col++) {
          for (const c of grid.get(`${row}:${col}`) ?? []) {
            if ((!paved || c.paved) && distanceM(center, climbStart(c)) <= radiusM) out.push(c);
          }
        }
      }
      return out;
    },
  };
}

export type ClimbIndex = ReturnType<typeof createClimbIndex>;

/** Reads the index file; a missing file means no climbs, so hilly loops fall back to searching every direction. */
export async function loadClimbIndex(path: string): Promise<ClimbIndex> {
  const text = await readFile(path, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  return createClimbIndex(text === null ? [] : ClimbFileSchema.parse(JSON.parse(text)).climbs);
}
