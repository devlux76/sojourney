"""Build the Crater Lake boat tour route into public/packs/crater-lake/route/boat_tour.json.

Usage: uv run --quiet --with pyproj --with numpy --with rasterio --with pillow --with scipy python tools/build_route.py
Then rebuild the pack index: python3 tools/build_pack_index.py crater-lake

The loop is guided by OpenStreetMap way 429536581 "Wizard Island Tour" (cached as
tools/.cache/route/way_429536581.json, downloaded if missing), not copied from it: only its points over
deep water are kept, and the run in to each dock is made here. The ship lies across the end of each
pier, so it passes through the dock along its own heading, slanting in from and out to deeper water.

Output (world metres, +x east, +z north, lake surface y = 0): "points" is the closed loop sampled about
every 10 m, starting at the first dock; each dock gives the ship's origin, its heading in degrees and
"distance", how far along the loop it lies. "sights" are the places the ship stops at with no dock, in
the order she comes to them: each gives its name and the distance along the loop where she is nearest it.
"""
import heapq
import json
import pathlib
import sys
import urllib.request

import numpy as np
from pyproj import Transformer

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import heightfield as terrain
from build_heightmap import ORIGIN_UTM

ROOT = pathlib.Path(__file__).resolve().parent.parent
WAY = ROOT / "tools/.cache/route/way_429536581.json"
WAY_URL = "https://api.openstreetmap.org/api/0.6/way/429536581/full.json"
OUT = ROOT / "public/packs/crater-lake/route/boat_tour.json"

# Where the ship lies at each dock (its origin and heading), as placed against the pier ends in
# src/biomes/crater-lake/index.ts. The loop starts at the first.
DOCKS = [
    {"name": "Cleetwood Cove", "position": [4750.0, 4219.8], "headingDegrees": 204.0, "pierHeadingDegrees": 114.0},
    {"name": "Wizard Island", "position": [-286.4, -522.3], "headingDegrees": 90.0, "pierHeadingDegrees": 180.0},
]
# The sights the ship stops at out on the water, as she would at a dock, each at the point of the loop
# nearest it. Longitude and latitude are from the USGS Geographic Names Information System (the
# number is the feature's GNIS id), which is US Government work in the public domain.
SIGHTS = [
    {"name": "Pumice Castle", "lonLat": (-122.05754, 42.92902), "gnis": 1134046},
    {"name": "Phantom Ship", "lonLat": (-122.09254, 42.91097), "gnis": 1147629},
    {"name": "Devils Backbone", "lonLat": (-122.15816, 42.96094), "gnis": 1140934},
    {"name": "Llao Rock", "lonLat": (-122.13338, 42.97208), "gnis": 1145305},
]
# A mapped point is used only where the lake bed is at least this far below the surface ...
GUIDE_DEPTH = 25.0
# ... and at least this far along the water from either dock, so the run in and out is not forced.
GUIDE_CLEAR = 1500.0
# The shore runs alongside the docked ship, so it comes in and goes out on a slant: each pair is (metres
# along the ship's heading, metres out from the shore along the pier's heading) either side of a dock.
LEADS = [(30.0, 25.0), (60.0, 110.0)]
# The finished curve must keep this much water under it everywhere (the ship draws 2 m).
MIN_DEPTH = 5.0
# Between the docks the ship follows the cheapest path over a grid of water cells: only cells with this
# much water, no nearer than CLEARANCE_CELLS to anything shallower, and deep water is cheaper than shoal.
GRID = 50.0
PATH_DEPTH = 10.0
CLEARANCE_CELLS = 2
CONTROL_EVERY = 4
SAMPLES_PER_SPAN = 24
STEP = 10.0


def mapped_points():
    if not WAY.exists():
        WAY.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(WAY_URL, headers={"User-Agent": "sojourney-pipeline"})
        WAY.write_bytes(urllib.request.urlopen(request).read())
    data = json.loads(WAY.read_text())
    nodes = {e["id"]: (e["lon"], e["lat"]) for e in data["elements"] if e["type"] == "node"}
    way = next(e for e in data["elements"] if e["type"] == "way")
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:26910", always_xy=True)
    points = np.array([to_utm.transform(*nodes[n]) for n in way["nodes"][:-1]]) - ORIGIN_UTM
    deep = (terrain.height(points[:, 0], points[:, 1]) < -GUIDE_DEPTH) & terrain.in_lake(points[:, 0], points[:, 1])
    return points, deep


def direction(degrees):
    h = np.radians(degrees)
    return np.array([np.sin(h), np.cos(h)])


# Uniform Catmull-Rom through a closed ring of control points.
def spline(control):
    n = len(control)
    t = np.linspace(0, 1, SAMPLES_PER_SPAN, endpoint=False)[:, None]
    out = []
    for i in range(n):
        p0, p1, p2, p3 = control[i - 1], control[i], control[(i + 1) % n], control[(i + 2) % n]
        out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t ** 2 + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    return np.concatenate(out)


# The water the ship may cross, as a grid of cells, and what each costs to enter.
def water():
    half = terrain.SIZE_METRES / 2
    centres = np.arange(-half + GRID / 2, half, GRID)
    X, Z = np.meshgrid(centres, centres)
    bed = terrain.height(X, Z)
    ok = terrain.in_lake(X, Z) & (bed < -PATH_DEPTH)
    for _ in range(CLEARANCE_CELLS):
        ok[1:-1, 1:-1] &= ok[:-2, 1:-1] & ok[2:, 1:-1] & ok[1:-1, :-2] & ok[1:-1, 2:]
    return centres, ok, 1 + 60 / np.maximum(-bed, 1)


def cell_of(centres, ok, point):
    rows, cols = np.nonzero(ok)
    i = int(np.argmin((centres[cols] - point[0]) ** 2 + (centres[rows] - point[1]) ** 2))
    return int(rows[i]), int(cols[i])


# Dijkstra over the eight neighbours of each water cell, from one point to another.
def path(centres, ok, cost, start, goal):
    a, b = cell_of(centres, ok, start), cell_of(centres, ok, goal)
    best, came, heap = {a: 0.0}, {}, [(0.0, a)]
    while heap:
        d, cell = heapq.heappop(heap)
        if cell == b:
            break
        if d > best[cell]:
            continue
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            n = (cell[0] + dr, cell[1] + dc)
            if not (0 <= n[0] < len(centres) and 0 <= n[1] < len(centres)) or not ok[n]:
                continue
            nd = d + float(np.hypot(dr, dc) * cost[n])
            if nd < best.get(n, np.inf):
                best[n], came[n] = nd, cell
                heapq.heappush(heap, (nd, n))
    cells = [b]
    while cells[-1] != a:
        cells.append(came[cells[-1]])
    return [np.array([centres[c], centres[r]]) for r, c in reversed(cells)]


def resample(points):
    ring = np.concatenate([points, points[:1]])
    along = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(ring, axis=0).T))])
    count = int(along[-1] // STEP)
    at = np.arange(count) * (along[-1] / count)
    return np.stack([np.interp(at, along, ring[:, 0]), np.interp(at, along, ring[:, 1])], axis=1), along[-1]


def main():
    mapped, deep = mapped_points()
    docks = [np.array(d["position"]) for d in DOCKS]
    # Walk the mapped loop from the point nearest the first dock, in the direction with more mapped
    # points before the second dock, and note where each dock falls in that order. The mapped points
    # are only a guide, and the loop that comes out runs counterclockwise (west and south first), the
    # way the real tour goes round: Llao Rock first and Pumice Castle last.
    start = int(np.argmin(np.hypot(*(mapped - docks[0]).T)))
    other = int(np.argmin(np.hypot(*(mapped - docks[1]).T)))
    n = len(mapped)
    step = 1 if (other - start) % n > (start - other) % n else -1
    order = [(start + step * k) % n for k in range(n)]
    split = order.index(other)
    legs = [order[1:split], order[split + 1:]]
    centres, ok, cost = water()
    ins, outs = [], []
    for k, dock in enumerate(DOCKS):
        f, out = direction(dock["headingDegrees"]), direction(dock["pierHeadingDegrees"])
        ins.append([docks[k] - a * f + o * out for a, o in reversed(LEADS)])
        outs.append([docks[k] + a * f + o * out for a, o in LEADS])
    control = []
    for k, dock in enumerate(DOCKS):
        after = (k + 1) % len(DOCKS)
        control += [docks[k]] + outs[k]
        # From the end of this dock's run out, by way of the mapped points over deep water, to the start
        # of the next dock's run in.
        stops = [outs[k][-1]] + [mapped[i] for i in legs[k]
                                 if deep[i] and min(np.hypot(*(mapped[i] - d)) for d in docks) > GUIDE_CLEAR] + [ins[after][0]]
        for a, b in zip(stops, stops[1:]):
            control += path(centres, ok, cost, a, b)[1:-1][::CONTROL_EVERY]
        control += ins[after]
    points, length = resample(spline(np.array(control)))
    bed = terrain.height(points[:, 0], points[:, 1])
    wet = terrain.in_lake(points[:, 0], points[:, 1])
    shallow = np.flatnonzero((bed > -MIN_DEPTH) | ~wet)
    print(f"{len(control)} control points, {len(points)} samples, {length:.0f} m, shallowest {-bed.max():.1f} m of water")
    if len(shallow):
        for i in shallow[:20]:
            print(f"  too shallow at sample {i}: ({points[i, 0]:.0f}, {points[i, 1]:.0f}) bed {bed[i]:.1f} lake {bool(wet[i])}")
        raise SystemExit("the route runs aground; move the docks, the lead or the guide limits")
    docks_out = []
    for k, dock in enumerate(DOCKS):
        # The dock lies between two samples, so its distance is taken along the stretch it is nearest
        # to: at the nearest sample alone it could be 5 m out, and the ship would slide that far as
        # she came alongside.
        i = int(np.argmin(np.hypot(*(points - docks[k]).T)))
        best = None
        for a in (i - 1, i):
            p, q = points[a % len(points)], points[(a + 1) % len(points)]
            t = float(np.clip(np.dot(docks[k] - p, q - p) / np.dot(q - p, q - p), 0, 1))
            gap = float(np.hypot(*(p + t * (q - p) - docks[k])))
            if best is None or gap < best[1]:
                best = ((a + t) % len(points), gap)
        docks_out.append({**{key: dock[key] for key in ("name", "position", "headingDegrees")}, "distance": round(best[0] * length / len(points), 1)})
        print(f"  {dock['name']}: {docks_out[-1]['distance']} m along, {best[1]:.2f} m from the curve")
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:26910", always_xy=True)
    sights_out = []
    for sight in SIGHTS:
        at = np.array(to_utm.transform(*sight["lonLat"])) - ORIGIN_UTM
        i = int(np.argmin(np.hypot(*(points - at).T)))
        sights_out.append({"name": sight["name"], "distance": round(i * length / len(points), 1)})
        print(f"  {sight['name']}: {sights_out[-1]['distance']} m along, {np.hypot(*(points[i] - at)):.0f} m from the curve")
    sights_out.sort(key=lambda sight: sight["distance"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"format": 2, "length": round(length, 1), "docks": docks_out, "sights": sights_out,
                               "points": [[round(float(x), 2), round(float(z), 2)] for x, z in points]}) + "\n")


if __name__ == "__main__":
    main()
