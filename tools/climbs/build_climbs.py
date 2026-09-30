"""Builds the climb index the planner uses to send hilly loops over real climbs.

Roads come from Overture Maps (OpenStreetMap-based), elevation from GeoTIFF tiles: by default
the free Copernicus 30 m model, downloaded for the area. It measures the surface, trees included,
so climbs through woods come out a little rough; IGN's RGE ALTI (bare ground, France) is sharper
and can be passed with --dem. Roads are joined into continuous "strokes" through intersections, each
stroke's elevation profile is sampled every few metres, and every sustained uphill stretch
(in either direction) becomes a climb with its bottom, top, length, gain and grades.

Usage: python build_climbs.py --bbox 1.44,48.12,3.56,49.24 --out climbs.json [--dem 'rge-alti/*.tif']
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import re
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass

import duckdb
import numpy as np
import rasterio

COPERNICUS = "https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"
OVERTURE = "s3://overturemaps-us-west-2/release/{release}/theme=transportation/type=segment/*"
# Classes a bike can ride; motorways and trunk roads are never climbs we'd send a cyclist up.
RIDEABLE = ("primary", "secondary", "tertiary", "residential", "unclassified", "living_street", "service", "cycleway", "track", "path")
PAVED_SURFACES = {"paved", "asphalt", "concrete", "paving_stones", None}
UNPAVED_CLASSES = {"track", "path"}

STEP_M = 20
SMOOTH_SAMPLES = 5  # 100 m: evens out the noise of a 30 m elevation grid
MAX_TURN_DEG = 35  # a road carries on through an intersection when it bends less than this

MIN_GAIN_M = 35
MIN_LENGTH_M = 400
MIN_GRADE = 0.03
# A climb ends once the road has dropped this much from its high point.
MAX_DIP_M = 10
MAX_DIP_RATIO = 0.2


@dataclass
class Edge:
    a: str
    b: str
    coords: list[tuple[float, float]]
    name: str | None
    road_class: str
    paved: bool


def metres(lat0: float):
    kx = 111_320 * math.cos(math.radians(lat0))
    return lambda p, q: math.hypot((q[0] - p[0]) * kx, (q[1] - p[1]) * 110_540)


def parse_linestring(wkt: str) -> list[tuple[float, float]]:
    return [(float(x), float(y)) for x, y in re.findall(r"(-?[\d.]+) (-?[\d.]+)", wkt)]


def split_at(coords, dist, fractions):
    """Cuts a line at the given fractions of its length (Overture places connectors this way)."""
    cum = [0.0]
    for p, q in zip(coords, coords[1:]):
        cum.append(cum[-1] + dist(p, q))
    total = cum[-1] or 1.0
    pieces, current, i = [], [coords[0]], 1
    for f in fractions[1:]:
        target = f * total
        while i < len(coords) and cum[i] < target:
            current.append(coords[i])
            i += 1
        if i < len(coords):
            span = cum[i] - cum[i - 1] or 1.0
            t = (target - cum[i - 1]) / span
            p, q = coords[i - 1], coords[i]
            cut = (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
        else:
            cut = coords[-1]
        current.append(cut)
        pieces.append(current)
        current = [cut]
    return [p for p in pieces if len(p) >= 2]


def load_edges(con, source: str, bbox, dist) -> list[Edge]:
    xmin, ymin, xmax, ymax = bbox
    rows = con.sql(
        f"""
        SELECT names.primary, class, road_surface, connectors, ST_AsText(geometry)
        FROM read_parquet('{source}', hive_partitioning=1)
        WHERE bbox.xmin > {xmin} AND bbox.xmax < {xmax} AND bbox.ymin > {ymin} AND bbox.ymax < {ymax}
          AND subtype = 'road' AND class IN {RIDEABLE}
        """
    ).fetchall()
    edges = []
    for name, road_class, surface, connectors, wkt in rows:
        if not connectors or len(connectors) < 2:
            continue
        surface_value = surface[0]["value"] if surface else None
        paved = road_class not in UNPAVED_CLASSES and surface_value in PAVED_SURFACES
        stops = sorted(connectors, key=lambda c: c["at"])
        pieces = split_at(parse_linestring(wkt), dist, [c["at"] for c in stops])
        for (a, b), coords in zip(zip(stops, stops[1:]), pieces):
            edges.append(Edge(a["connector_id"], b["connector_id"], coords, name, road_class, paved))
    return edges


def bearing(p, q) -> float:
    return math.degrees(math.atan2((q[0] - p[0]) * math.cos(math.radians(p[1])), q[1] - p[1]))


def build_strokes(edges: list[Edge]) -> list[list[tuple[Edge, bool]]]:
    """Joins edges into the longest natural roads: through each intersection, pair the edges that bend least."""
    at_node = defaultdict(list)
    for i, e in enumerate(edges):
        at_node[e.a].append((i, True))  # leaves the node from its start
        at_node[e.b].append((i, False))  # leaves the node from its end
    partner: dict[tuple[int, str], int] = {}
    for node, incident in at_node.items():
        options = []
        for x in range(len(incident)):
            for y in range(x + 1, len(incident)):
                (i, i_start), (j, j_start) = incident[x], incident[y]
                ei, ej = edges[i], edges[j]
                if i == j or ei.paved != ej.paved:
                    continue
                out_i = bearing(*(ei.coords[:2] if i_start else ei.coords[:-3:-1]))
                out_j = bearing(*(ej.coords[:2] if j_start else ej.coords[:-3:-1]))
                turn = abs((out_i - out_j) % 360 - 180)
                if turn <= MAX_TURN_DEG:
                    options.append((turn - (10 if ei.name and ei.name == ej.name else 0), i, j))
        used = set()
        for _, i, j in sorted(options):
            if i not in used and j not in used:
                partner[(i, node)] = j
                partner[(j, node)] = i
                used.update((i, j))

    seen, strokes = set(), []
    for start in range(len(edges)):
        if start in seen:
            continue
        # Walk back to one end of the stroke, then collect forward.
        i, node, guard = start, edges[start].a, 0
        while (i, node) in partner and guard < len(edges):
            j = partner[(i, node)]
            if j == start:
                break
            node = edges[j].b if edges[j].a == node else edges[j].a
            i, guard = j, guard + 1
        stroke, node = [], node
        while i not in seen:
            seen.add(i)
            forward = edges[i].a == node
            stroke.append((edges[i], forward))
            node = edges[i].b if forward else edges[i].a
            if (i, node) not in partner:
                break
            i = partner[(i, node)]
        strokes.append(stroke)
    return strokes


class Elevation:
    def __init__(self, pattern: str):
        self.tiles = []
        for path in sorted(glob.glob(pattern)):
            with rasterio.open(path) as tile:
                self.tiles.append((tile.bounds, ~tile.transform, tile.read(1).astype(np.float32)))

    def at(self, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
        """Bilinear elevation at each point; NaN outside the tiles."""
        out = np.full(lon.shape, np.nan)
        for (left, bottom, right, top), inverse, data in self.tiles:
            inside = (lon >= left) & (lon < right) & (lat > bottom) & (lat <= top)
            if not inside.any():
                continue
            col, row = inverse * (lon[inside], lat[inside])
            row, col = np.asarray(row) - 0.5, np.asarray(col) - 0.5
            r0 = np.clip(np.floor(row).astype(int), 0, data.shape[0] - 2)
            c0 = np.clip(np.floor(col).astype(int), 0, data.shape[1] - 2)
            fr, fc = np.clip(row - r0, 0, 1), np.clip(col - c0, 0, 1)
            out[inside] = (
                data[r0, c0] * (1 - fr) * (1 - fc)
                + data[r0, c0 + 1] * (1 - fr) * fc
                + data[r0 + 1, c0] * fr * (1 - fc)
                + data[r0 + 1, c0 + 1] * fr * fc
            )
        return out


def resample(stroke, dist):
    coords, names, classes, paved = [], Counter(), Counter(), True
    for edge, forward in stroke:
        pts = edge.coords if forward else edge.coords[::-1]
        coords.extend(pts if not coords else pts[1:])
        length = sum(dist(p, q) for p, q in zip(pts, pts[1:]))
        if edge.name:
            names[edge.name] += length
        classes[edge.road_class] += length
        paved = paved and edge.paved
    out, cum = [coords[0]], [0.0]
    carry = 0.0
    for p, q in zip(coords, coords[1:]):
        seg = dist(p, q)
        pos = STEP_M - carry
        while pos <= seg:
            t = pos / seg
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
            cum.append(cum[-1] + STEP_M)
            pos += STEP_M
        carry = (carry + seg) % STEP_M
    name = names.most_common(1)[0][0] if names else None
    return out, np.array(cum), name, classes.most_common(1)[0][0], paved


def find_climbs(ele: np.ndarray):
    """Index ranges [bottom, top] of sustained climbs in a profile that runs uphill left to right."""
    found, low, high, i = [], 0, 0, 1
    while i < len(ele):
        if ele[i] > ele[high]:
            high = i
        if ele[i] < ele[low] and high == low:
            low = high = i
        gain = ele[high] - ele[low]
        if ele[high] - ele[i] > max(MAX_DIP_M, MAX_DIP_RATIO * gain) or i == len(ele) - 1:
            if gain >= MIN_GAIN_M:
                found.append((low, high))
            low = high = i
        i += 1
    return found


def climbs_in(stroke, dist, dem: Elevation):
    points, cum, name, road_class, paved = resample(stroke, dist)
    if cum[-1] < MIN_LENGTH_M:
        return []
    xy = np.array(points)
    raw = dem.at(xy[:, 0], xy[:, 1])
    if np.isnan(raw).any():
        return []
    kernel = np.ones(SMOOTH_SAMPLES) / SMOOTH_SAMPLES
    ele = np.convolve(np.pad(raw, SMOOTH_SAMPLES // 2, mode="edge"), kernel, mode="valid")
    out = []
    for reverse in (False, True):
        e = ele[::-1] if reverse else ele
        pts = points[::-1] if reverse else points
        for lo, hi in find_climbs(e):
            length = (hi - lo) * STEP_M
            gain = e[hi] - e[lo]
            if length < MIN_LENGTH_M or gain / length < MIN_GRADE:
                continue
            window = max(1, 100 // STEP_M)
            steepest = max((e[k + window] - e[k]) / (window * STEP_M) for k in range(lo, max(lo + 1, hi - window + 1)))
            path = [pts[lo + round((hi - lo) * f)] for f in (0, 1 / 3, 2 / 3, 1)]
            out.append(
                {
                    "name": name,
                    "path": [[round(lon, 6), round(lat, 6)] for lon, lat in path],
                    "bottomEle": round(float(e[lo])),
                    "topEle": round(float(e[hi])),
                    "lengthM": round(length),
                    "gainM": round(float(gain)),
                    "avgGrade": round(float(gain / length), 3),
                    "maxGrade": round(float(steepest), 3),
                    "roadClass": road_class,
                    "paved": paved,
                }
            )
    return out


def dedupe(climbs, dist):
    """Dual carriageways and parallel paths give the same climb twice: keep the bigger one."""
    kept = []
    for c in sorted(climbs, key=lambda c: -c["gainM"]):
        if not any(dist(c["path"][0], k["path"][0]) < 200 and dist(c["path"][-1], k["path"][-1]) < 200 for k in kept):
            kept.append(c)
    return kept


def download_copernicus(bbox, folder: str) -> str:
    """Fetches the 1° Copernicus tiles covering the area, once."""
    os.makedirs(folder, exist_ok=True)
    for lat in range(math.floor(bbox[1]), math.floor(bbox[3]) + 1):
        for lon in range(math.floor(bbox[0]), math.floor(bbox[2]) + 1):
            ns, ew = ("N" if lat >= 0 else "S"), ("E" if lon >= 0 else "W")
            name = f"Copernicus_DSM_COG_10_{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00_DEM"
            path = os.path.join(folder, f"{name}.tif")
            if not os.path.exists(path):
                print(f"downloading {name}", flush=True)
                urllib.request.urlretrieve(COPERNICUS.format(name=name), path + ".part")
                os.rename(path + ".part", path)
    return os.path.join(folder, "*.tif")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bbox", required=True, help="minLon,minLat,maxLon,maxLat")
    parser.add_argument("--dem", help="glob of GeoTIFF elevation tiles (default: Copernicus 30 m, downloaded)")
    parser.add_argument("--cache", default="cache", help="where downloaded elevation tiles are kept")
    parser.add_argument("--out", required=True)
    parser.add_argument("--release", default=os.environ.get("OVERTURE_RELEASE", "2026-09-23.1"))
    parser.add_argument("--source", help="Parquet files with Overture's segment schema, instead of the release on S3")
    args = parser.parse_args()

    bbox = [float(v) for v in args.bbox.split(",")]
    dist = metres((bbox[1] + bbox[3]) / 2)
    con = duckdb.connect()
    con.sql("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; INSTALL spatial; LOAD spatial;")
    source = args.source or OVERTURE.format(release=args.release)

    edges = load_edges(con, source, bbox, dist)
    strokes = build_strokes(edges)
    print(f"{len(edges)} road pieces joined into {len(strokes)} roads", flush=True)
    dem = Elevation(args.dem or download_copernicus(bbox, os.path.join(args.cache, "copernicus")))
    found = []
    for n, stroke in enumerate(strokes):
        found.extend(climbs_in(stroke, dist, dem))
        if n % 50_000 == 0:
            print(f"{n}/{len(strokes)} roads, {len(found)} climbs so far", flush=True)
    climbs = dedupe(found, dist)
    climbs.sort(key=lambda c: -c["gainM"])
    for i, c in enumerate(climbs):
        c["id"] = i
    with open(args.out, "w") as f:
        json.dump({"bbox": bbox, "source": f"Overture {args.release}, {args.dem or 'Copernicus DEM 30 m'}", "climbs": climbs}, f)
    print(f"{len(climbs)} climbs written to {args.out}")


if __name__ == "__main__":
    main()
