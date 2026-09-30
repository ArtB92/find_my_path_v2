import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Climb } from "./climbs.schema";
import { createClimbIndex, loadClimbIndex } from "./climbs.service";

const climb = (id: number, lon: number, lat: number, over: Partial<Climb> = {}): Climb => ({
  id,
  name: `Côte ${id}`,
  path: [
    [lon, lat],
    [lon + 0.01, lat],
  ],
  bottomEle: 100,
  topEle: 160,
  lengthM: 800,
  gainM: 60,
  avgGrade: 0.075,
  maxGrade: 0.1,
  roadClass: "tertiary",
  paved: true,
  ...over,
});

describe("climb index", () => {
  const index = createClimbIndex([
    climb(1, 2.1, 48.8),
    climb(2, 2.3, 48.8),
    climb(3, 2.12, 48.81, { paved: false }),
    climb(4, 2.1, 48.35),
  ]);

  it("finds the climbs starting within reach, across grid cells", () => {
    expect(index.near({ lat: 48.8, lon: 2.2 }, 16_000).map((c) => c.id).sort()).toEqual([1, 2, 3]);
    expect(index.near({ lat: 48.8, lon: 2.2 }, 5_000)).toEqual([]);
  });

  it("keeps paved climbs only for road bikes", () => {
    expect(index.near({ lat: 48.8, lon: 2.11 }, 3_000, { paved: true }).map((c) => c.id)).toEqual([1]);
  });

  it("loads a file, and treats a missing one as no climbs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "climbs-"));
    const path = join(dir, "climbs.json");
    await writeFile(path, JSON.stringify({ bbox: [1, 48, 3, 49], climbs: [climb(1, 2.1, 48.8)] }));
    expect((await loadClimbIndex(path)).size).toBe(1);
    expect((await loadClimbIndex(join(dir, "missing.json"))).size).toBe(0);
  });
});
