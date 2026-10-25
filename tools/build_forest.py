"""Place the forest over the whole map and write it per ground leaf, for the engine to stream.

Usage: uv run --quiet --with numpy --with scipy --with pillow --with rasterio --with geopandas --with pyogrio python tools/build_forest.py
       ... tools/build_forest.py --area X,Z,RADIUS    only the leaves within RADIUS metres of world (X, Z)

Design: docs/specs/2026-10-02-forest-from-canopy-design.md. Run tools/build_flora.py first: it builds
the models and records each one's size, which this tool reads.

Trees are the crown tops of the 2010 lidar canopy-height grid: one tree per crown, at its surveyed
position, scaled to its surveyed height, fir or pine by the vegetation map unit it stands in. Rocks,
shrubs and water plants are scattered by the zone rules in src/biomes/crater-lake/index.ts at the
densities the old 1.2 km scatter had, now over the whole map.

Output, under public/packs/crater-lake/flora/ (types and record layout in src/engine/pack.ts):
  forest.json       species, and the number of records in each leaf's two files
  leaves/<id>.bin   everything standing in ground leaf <id>
  mid/<id>.bin      its middle-band trees only: the tallest tree in each 14 m cell
"""
import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from PIL import Image, ImageFilter
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.windows import Window
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_flora as flora_pack
import flora_place as place
import heightfield as terrain

ROOT = Path(__file__).resolve().parent.parent
OUT = flora_pack.OUT
LAYERS = ROOT / "tools/.cache/reference/crater-lake/layers"
CANOPY = LAYERS / "lidar_dogami2010_nps/canopyheight_dm_uint16.tif"
VEGETATION = LAYERS / "vegetation_vmi/crla_vegmap.gpkg"
GROUND = ROOT / "public/packs/crater-lake/ground/ground.json"
# The world origin in NAD83 / UTM 10N, as in tools/build_heightmap.py. World z is north.
ORIGIN_E, ORIGIN_N = 569609.0, 4754367.0
HALF = terrain.SIZE_METRES / 2

# The canopy grid stores tenths of an international foot (the survey was delivered in Oregon Lambert
# feet; see the grid's metadata.xml) and 65535 where there is no data.
CANOPY_UNIT_METRES = 0.03048
NO_DATA = 65535
# A crown top is the highest cell of its 5 x 5 neighbourhood (4.6 m) after a one-cell blur, which
# joins the several returns of one crown without merging neighbouring trees.
CROWN_BLUR_CELLS = 1.0
CROWN_WINDOW_CELLS = 5
MIN_TREE_METRES = 5.0
# Taller than any tree in the park: the grid has a few wild values (up to 432 ft).
MAX_TREE_METRES = 70.0
# Canopy "heights" on cliffs are the cliff itself, seen from the side.
MAX_TREE_SLOPE = 1.2
STRIP_ROWS = 2048
STRIP_HALO = 8
TREE_SCALE = (0.2, 4.0)

# The vegetation map is rasterised to 10 m cells holding the share of pines among the trees there.
VEG_CELL = 10.0
PINE_UNITS = {
    "Lodgepole Pine Forest": 0.85, "Ponderosa Pine Woodland": 0.85, "Whitebark Pine Woodland": 0.85,
    "Mountain Hemlock Forest - Lodgepole Pine Forest Complex": 0.5,
    "Mountain Hemlock - Lodgepole Pine - Whitebark Pine Forest": 0.5,
    "Subalpine Fir - Lodgepole Pine Riparian Woodland": 0.5, "Montane Conifer Forest": 0.5,
}
# Fir and hemlock units (hemlock has no model yet and uses the fir) still carry a few pines.
PINE_ELSEWHERE = 0.15
# Buildings, car parks and roads: lidar sees roofs as canopy, and nothing grows on tarmac.
BUILT_UNIT = "Pavement - Development"

# Scatter attempts per square metre, as the old scatter had in its squares on Wizard Island.
SCATTER_RATE = place.SCATTER_ATTEMPTS / place.SCATTER_AREA ** 2
ROCK_RATE = place.ROCK_ATTEMPTS / place.SCATTER_AREA ** 2
# The zone rules were written for the island, by height above the lake. Within this distance of the
# lake they apply as written (capped at the island summit's zone); land further away is all upland.
SHORE_REACH_METRES = 300.0
SHORE_CELL_METRES = 25.0
ISLAND_TOP_ELEVATION = 234.0
UPLAND_ELEVATION = 100.0
# Nothing is placed this close to a prop (the piers).
PROP_CLEARANCE_METRES = 30.0
# A rock patch is placed on a plane fitted to the ground under its whole footprint, and dropped where that
# ground bends away from the plane by more than PATCH_FLATNESS metres (ISSUES.md P3). Twelve points on each
# of three rings (the centre, half the footprint's radius, and the full radius) are what it is fitted to.
PATCH_FLATNESS = 0.25
PATCH_RING = 12

MID_CELL_METRES = 14.0
# Engine distances, in the manifest so the engine holds no numbers of its own: a leaf's full file is
# wanted within nearMetres of the leaf, its middle-band file within midMetres; an object is drawn
# until it is further than pixelReach times its size (two pixels on a 1080-line screen).
NEAR_METRES = 600.0
MID_METRES = 2500.0
PIXEL_REACH = 700.0
# Records are sorted by species, then by cells of this size counted from the leaf's south-west
# corner (every leaf size is a multiple), then largest first, so the engine can take a whole cell or
# the visible front of one without looking at each record.
CELL_METRES = 31.25
RECORD = np.dtype([("y", "<f4"), ("x", "<u2"), ("z", "<u2"), ("scale", "<u2"), ("yaw", "u1"), ("species", "u1"),
                   ("tiltX", "i1"), ("tiltZ", "i1")])
SCALE_UNIT = 0.001


def leaf_owner(leaves):
    count = round(terrain.SIZE_METRES / 250.0)
    owner = np.full((count, count), -1, np.int32)
    for n, leaf in enumerate(leaves):
        c0, r0, span = round((leaf["x"] + HALF) / 250.0), round((leaf["z"] + HALF) / 250.0), round(leaf["size"] / 250.0)
        owner[r0:r0 + span, c0:c0 + span] = n
    return owner


def leaf_of(owner, x, z):
    n = len(owner)
    col = np.clip(((x + HALF) // 250.0).astype(int), 0, n - 1)
    row = np.clip(((z + HALF) // 250.0).astype(int), 0, n - 1)
    return owner[row, col]


class Vegetation:
    def __init__(self):
        units = gpd.read_file(VEGETATION, layer="CRLA_VegMap_Final", engine="pyogrio")
        units = units.cx[ORIGIN_E - HALF:ORIGIN_E + HALF, ORIGIN_N - HALF:ORIGIN_N + HALF]
        n = round(terrain.SIZE_METRES / VEG_CELL)
        transform = from_origin(ORIGIN_E - HALF, ORIGIN_N + HALF, VEG_CELL, VEG_CELL)
        share = np.where(units.Primary_MapUnit == BUILT_UNIT, -1.0, units.Primary_MapUnit.map(PINE_UNITS).fillna(PINE_ELSEWHERE))
        # Rows run north to south, as in the survey rasters.
        self.pine = rasterize(zip(units.geometry, share), out_shape=(n, n), transform=transform, fill=PINE_ELSEWHERE,
                              dtype=np.float32)

    def pine_share(self, x, z):
        n = len(self.pine)
        col = np.clip(((x + HALF) // VEG_CELL).astype(int), 0, n - 1)
        row = np.clip(((HALF - z) // VEG_CELL).astype(int), 0, n - 1)
        return self.pine[row, col]


def near_lake_grid():
    cells = terrain.lake_cells(SHORE_CELL_METRES)
    reach = 2 * int(SHORE_REACH_METRES / SHORE_CELL_METRES) + 1
    return np.asarray(Image.fromarray(cells.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(reach))) > 0


NEAR_LAKE = near_lake_grid()


def near_lake(x, z):
    n = len(NEAR_LAKE)
    col = np.clip(((x + HALF) // SHORE_CELL_METRES).astype(int), 0, n - 1)
    row = np.clip(((z + HALF) // SHORE_CELL_METRES).astype(int), 0, n - 1)
    return NEAR_LAKE[row, col]


# The elevation the zone rules see: height above the lake near it, a fixed upland height elsewhere.
def rule_elevation(x, z, y):
    return np.where(near_lake(x, z), np.minimum(y, ISLAND_TOP_ELEVATION), UPLAND_ELEVATION)


def prop_positions():
    code = (f"import b from '{ROOT}/src/biomes/crater-lake/index.ts';"
            "console.log(JSON.stringify((b.props??[]).map(p=>[p.position[0],p.position[2]])))")
    out = subprocess.run(["bun", "-e", code], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return np.array(json.loads(out), np.float64).reshape(-1, 2)


def clear_of_props(props, x, z):
    ok = np.ones(len(x), bool)
    for px, pz in props:
        ok &= np.hypot(x - px, z - pz) > PROP_CLEARANCE_METRES
    return ok


def empty():
    return {"x": np.zeros(0), "z": np.zeros(0), "y": np.zeros(0), "scale": np.zeros(0), "yaw": np.zeros(0),
            "species": np.zeros(0, np.int64), "tiltX": np.zeros(0), "tiltZ": np.zeros(0)}


def things(x, z, y, scale, yaw, species, tilt=None):
    zero = np.zeros(len(x))
    return {"x": x, "z": z, "y": y, "scale": scale, "yaw": yaw, "species": species,
            "tiltX": zero if tilt is None else tilt[0], "tiltZ": zero if tilt is None else tilt[1]}


def gather(parts):
    parts = [p for p in parts if len(p["x"])] or [empty()]
    return {k: np.concatenate([p[k] for p in parts]) for k in parts[0]}


# Crown tops in the rectangle (x0..x1, z0..z1) of the world, read from the canopy grid in strips.
def crown_tops(x0, x1, z0, z1):
    xs, zs, hs = [], [], []
    with rasterio.open(CANOPY) as src:
        cell = src.res[0]
        col0 = int(np.floor((ORIGIN_E + x0 - src.bounds.left) / cell))
        col1 = int(np.ceil((ORIGIN_E + x1 - src.bounds.left) / cell))
        row0 = int(np.floor((src.bounds.top - (ORIGIN_N + z1)) / cell))
        row1 = int(np.ceil((src.bounds.top - (ORIGIN_N + z0)) / cell))
        for first in range(row0, row1, STRIP_ROWS):
            last = min(first + STRIP_ROWS, row1)
            window = Window(col0 - STRIP_HALO, first - STRIP_HALO, col1 - col0 + 2 * STRIP_HALO, last - first + 2 * STRIP_HALO)
            raw = src.read(1, window=window, boundless=True, fill_value=NO_DATA)
            metres = np.where(raw == NO_DATA, 0, raw).astype(np.float32) * CANOPY_UNIT_METRES
            smooth = ndimage.gaussian_filter(metres, CROWN_BLUR_CELLS)
            top = (ndimage.maximum_filter(smooth, size=CROWN_WINDOW_CELLS) == smooth)
            top &= (metres > MIN_TREE_METRES) & (metres < MAX_TREE_METRES)
            top = top[STRIP_HALO:-STRIP_HALO, STRIP_HALO:-STRIP_HALO]
            r, c = np.nonzero(top)
            xs.append(src.bounds.left + (col0 + c + 0.5) * cell - ORIGIN_E)
            zs.append(src.bounds.top - (first + r + 0.5) * cell - ORIGIN_N)
            hs.append(metres[STRIP_HALO:-STRIP_HALO, STRIP_HALO:-STRIP_HALO][r, c])
    return np.concatenate(xs), np.concatenate(zs), np.concatenate(hs).astype(np.float64)


def place_trees(rng, vegetation, props, species, bounds):
    x, z, tall = crown_tops(*bounds)
    # The grid's cells would put trees in rows; move each a little within its cell.
    x = x + (rng.random(len(x)) - 0.5) * 0.6
    z = z + (rng.random(len(x)) - 0.5) * 0.6
    pine = vegetation.pine_share(x, z)
    # No tree stands in the water or on the wet edge of the shore. Much of the outer flank is lower than
    # the lake, so height alone does not say "under water".
    keep = (np.abs(x) < HALF) & (np.abs(z) < HALF) & ~terrain.in_lake(x, z) & ~(near_lake(x, z) & (terrain.height(x, z) < 0.3))
    keep &= (terrain.slope(x, z) < MAX_TREE_SLOPE) & (pine >= 0) & clear_of_props(props, x, z)
    x, z, tall, pine = x[keep], z[keep], tall[keep], pine[keep]
    n = len(x)
    firs = np.array([s["index"] for s in species if s["name"].startswith("fir_")])
    pines = np.array([s["index"] for s in species if s["name"].startswith("pine_")])
    # The fir has fewer variants than the pine (C retired), so one shared 0..2 draw cannot index
    # both families. Pick the family first from the vegetation share, then a variant within that
    # family's own count. The seed stream and everything above (positions, heights) are unchanged.
    is_pine = rng.random(n) < pine
    fir_variant = rng.integers(0, len(firs), n)
    pine_variant = rng.integers(0, len(pines), n)
    index = np.where(is_pine, pines[pine_variant], firs[fir_variant])
    model_height = np.array([s.get("height", 1.0) for s in species])[index]
    scale = np.clip(tall / model_height, *TREE_SCALE)
    ground = terrain.height(x, z)
    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ground = np.minimum(ground, terrain.height(x + dx * place.TRUNK_RADIUS * scale, z + dz * place.TRUNK_RADIUS * scale))
    return things(x, z, ground - place.TREE_ROOT_DEPTH * scale, scale, rng.random(n) * np.pi * 2, index), tall


def attempts(rng, leaf, rate):
    n = rng.poisson(rate * leaf["size"] ** 2)
    return leaf["x"] + rng.random(n) * leaf["size"], leaf["z"] + rng.random(n) * leaf["size"]


# Cleetwood Cove's shore is a rubble pile, not a sandy beach (reference IMG_0749.webp in the
# project root): dense angular grey blocks, mostly 0.2-1 m with some to ~1.5 m, strewn over pale
# gravel from just under the waterline to about 12 m above it, thickest at the water's edge.
# This pass reuses the lava-block/boulder species (same models and grey tint, no colliders, drawn
# as thin instances like everything else), with its own dense attempt stream: the ordinary rock
# rate caps at one attempt per 36 m2, far too sparse for rubble, and the separate seed stream
# leaves every existing placement exactly as it was.
SHORE_STREAM = 921
SHORE_ATTEMPTS_PER_M2 = 2.0
SHORE_TOP_ELEVATION = 12.0
SHORE_WATERLINE_ELEVATION = 4.0
SHORE_MIN_HEIGHT = -1.5
SHORE_MAX_SLOPE = 1.2
# Kept share of attempts: dense at the waterline, thinner uphill.
SHORE_KEEP_WET = 0.5
SHORE_KEEP_DRY = 0.22
SHORE_RUBBLE_IDS = ("lava_block", "boulder")

def place_shore_rubble(rng, leaf, species):
    # Most leaves are nowhere near the lake: a coarse sample says so before any heights are read.
    edge = np.linspace(0, 1, 9)
    gx, gz = np.meshgrid(leaf["x"] + edge * leaf["size"], leaf["z"] + edge * leaf["size"])
    if not near_lake(gx.ravel(), gz.ravel()).any():
        return empty()
    x, z = attempts(rng, leaf, SHORE_ATTEMPTS_PER_M2)
    close = near_lake(x, z)
    x, z = x[close], z[close]
    y = terrain.height(x, z)
    elevation = rule_elevation(x, z, y)
    slope = place.slope_old(x, z)
    wet = elevation < SHORE_WATERLINE_ELEVATION
    keep = (np.abs(x) < HALF) & (np.abs(z) < HALF) & (y > SHORE_MIN_HEIGHT) & (elevation < SHORE_TOP_ELEVATION)
    keep &= slope < SHORE_MAX_SLOPE
    hit = keep & (rng.random(len(x)) < np.where(wet, SHORE_KEEP_WET, SHORE_KEEP_DRY))
    n = int(hit.sum())
    hx, hz, hy = x[hit], z[hit], y[hit]
    # Small blocks dominate, as in place_rocks; seated into the ground like them.
    scale = 0.2 + 1.4 * rng.random(n) ** 2
    names = np.array([s["index"] for s in species if s["entry"]["id"] in SHORE_RUBBLE_IDS])
    r = 0.35 * scale
    east, west = terrain.height(hx + r, hz), terrain.height(hx - r, hz)
    north, south = terrain.height(hx, hz + r), terrain.height(hx, hz - r)
    ground = np.minimum.reduce([hy, east, west, north, south])
    return things(hx, hz, ground - 0.3 * scale, scale, rng.random(n) * np.pi * 2, rng.choice(names, n))


def entry_species(species, entry):
    return np.array([s["index"] for s in species if s["entry"] is entry])


# Shrubs and the two lake-bed rocks: the entries with zones but no scale range. Trees are not
# scattered any more, so the shrubs no longer lose the attempts the trees used to take.
def place_scattered(rng, leaf, entries, species):
    x, z = attempts(rng, leaf, SCATTER_RATE)
    y = terrain.height(x, z)
    elevation = rule_elevation(x, z, y)
    slope = place.slope_old(x, z)
    remaining = np.ones(len(x), bool)
    out = []
    for entry in entries:
        density, matched = place.zone_density(entry, elevation, slope)
        hit = remaining & matched & (rng.random(len(x)) < density)
        remaining &= ~hit
        n = int(hit.sum())
        scale = 4 + rng.random(n) * 3
        py = y[hit] - (0.1 if entry["id"] == "shrub" else 0.0)
        out.append(things(x[hit], z[hit], py, scale, rng.random(n) * np.pi * 2, rng.choice(entry_species(species, entry), n)))
    return out


def fit_patch_ground(hx, hz, scale, footprint):
    """The ground under a whole patch, as one tilted plane: its two slopes, its height at each centre, and
    how far the ground wanders from that plane.

    A patch is a flat slab of small rocks ten metres across, so a plane fitted to the ground a couple of
    metres from its centre says nothing about its far end: on the cone's rounded shoulder the ends hung
    in the air (ISSUES.md P3). The ground is sampled right out to the patch's own bounding radius and
    fitted over both that ring and a half-radius one, and a placement whose ground bends away from that
    plane by more than PATCH_FLATNESS is dropped rather than drawn floating.
    """
    reach = 0.5 * float(np.hypot(*footprint)) * scale
    angles = np.arange(PATCH_RING) * 2 * np.pi / PATCH_RING
    radii = np.array([0.0, 0.5, 1.0])[:, None] * reach[None, :]
    # Three rings of twelve points each: the centre (twelve copies of it), the half-radius ring and the
    # full-radius one, as one row per point. The repeated centre weights the fitted plane to pass near it,
    # so the record's height stays close to what the old centre-point placement wrote.
    dx = (np.cos(angles)[None, :, None] * radii[:, None, :]).reshape(-1, len(hx))
    dz = (np.sin(angles)[None, :, None] * radii[:, None, :]).reshape(-1, len(hx))
    design = np.stack([dx, dz, np.ones_like(dx)], axis=2)
    sample = terrain.height(hx[None, :] + dx, hz[None, :] + dz)
    # One least-squares plane per placement, solved all at once through the normal equations (this
    # NumPy's lstsq takes only one right-hand side at a time). D is the per-placement design matrix.
    d = design.transpose(1, 0, 2)
    s = sample.transpose()
    coef = np.linalg.solve(np.einsum("npj,npk->njk", d, d),
                           np.einsum("npj,np->nj", d, s)[..., None])[..., 0]
    return coef[:, 0], coef[:, 1], coef[:, 2], np.abs(sample - np.einsum("pni,ni->pn", design, coef)).max(0)


def place_rocks(rng, leaf, entries, species, stats):
    x, z = attempts(rng, leaf, ROCK_RATE)
    y = terrain.height(x, z)
    elevation = rule_elevation(x, z, y)
    slope = place.slope_old(x, z)
    remaining = np.ones(len(x), bool)
    out = []
    for entry in entries:
        density, matched = place.zone_density(entry, elevation, slope)
        hit = remaining & matched & (rng.random(len(x)) < density)
        remaining &= ~hit
        n = int(hit.sum())
        hx, hz, hy = x[hit], z[hit], y[hit]
        small, large = entry["scale"]
        scale = small + (large - small) * rng.random(n) ** 2
        names = entry_species(species, entry)
        align = entry.get("alignToGround", False)
        # stats is keyed by species name, while names holds the species' indices into the manifest list;
        # both patch entries have a single variant, so the first one's footprint stands for the entry.
        footprint = stats.get(species[names[0]]["name"], {}).get("footprint") if len(names) else None
        ground, tilt, keep = hy, None, np.ones(n, bool)
        if align and footprint and n:
            slope_x, slope_z, level, bend = fit_patch_ground(hx, hz, scale, footprint)
            # The ground's normal; the engine tilts the model's up axis onto it, then turns it by yaw.
            up = np.stack([-slope_x, np.ones(n), -slope_z], axis=1)
            up /= np.linalg.norm(up, axis=1, keepdims=True)
            tilt = (up[:, 0], up[:, 2])
            ground, keep = level, bend <= PATCH_FLATNESS
        else:
            r = 0.35 * scale
            east, west = terrain.height(hx + r, hz), terrain.height(hx - r, hz)
            north, south = terrain.height(hx, hz + r), terrain.height(hx, hz - r)
            ground = hy if align else np.minimum.reduce([hy, east, west, north, south])
            if align:
                # The ground's normal; the engine tilts the model's up axis onto it, then turns it by yaw.
                up = np.stack([west - east, 2 * r, south - north], axis=1)
                up /= np.linalg.norm(up, axis=1, keepdims=True)
                tilt = (up[:, 0], up[:, 2])
        out.append(things(hx[keep], hz[keep], (ground - entry.get("sink", 0) * scale)[keep], scale[keep],
                          (rng.random(n) * np.pi * 2)[keep], rng.choice(names, n)[keep],
                          None if tilt is None else (tilt[0][keep], tilt[1][keep])))
    return out


def place_clusters(rng, leaf, entry, species):
    c = entry["clusters"]
    beds = rng.poisson(c["beds"] / place.CLUSTER_AREA ** 2 * leaf["size"] ** 2)
    cx, cz = leaf["x"] + rng.random(beds) * leaf["size"], leaf["z"] + rng.random(beds) * leaf["size"]
    bed_y = terrain.height(cx, cz)
    ok = terrain.in_lake(cx, cz) & (bed_y <= -c["minDepth"]) & (bed_y >= -c["maxDepth"])
    lo, hi = c["plantsPerBed"]
    plants = np.where(ok, lo + np.floor(rng.random(beds) * (hi - lo)).astype(int), 0)
    bed = np.repeat(np.arange(beds), plants)
    r = c["bedRadius"] * rng.random(len(bed)) ** 1.5
    a = rng.random(len(bed)) * np.pi * 2
    x, z = cx[bed] + r * np.cos(a), cz[bed] + r * np.sin(a)
    y = terrain.height(x, z)
    keep = terrain.in_lake(x, z) & (y <= -c["minDepth"]) & (y >= -c["maxDepth"]) & (np.abs(x) < HALF) & (np.abs(z) < HALF)
    n = int(keep.sum())
    return things(x[keep], z[keep], y[keep] - 0.1, 3 + rng.random(n) * 3, rng.random(n) * np.pi * 2,
                  rng.choice(entry_species(species, entry), n))


def place_leaf(leaf_id, leaf, flora, species, props, stats):
    # Each leaf has its own random stream, so building one area gives what the whole build gives there.
    rng = np.random.default_rng([place.SEED, leaf_id])
    parts = place_scattered(rng, leaf, [f for f in flora if "clusters" not in f and "scale" not in f and f["id"] != "tree"], species)
    parts += place_rocks(rng, leaf, [f for f in flora if "scale" in f], species, stats)
    parts += [place_shore_rubble(np.random.default_rng([place.SEED, leaf_id, SHORE_STREAM]), leaf, species)]
    parts += [place_clusters(rng, leaf, f, species) for f in flora if "clusters" in f]
    found = gather(parts)
    keep = clear_of_props(props, found["x"], found["z"])
    return {k: v[keep] for k, v in found.items()}


def records(leaf, t):
    out = np.zeros(len(t["x"]), RECORD)
    out["x"] = np.clip((t["x"] - leaf["x"]) / leaf["size"] * 65536, 0, 65535).astype(np.uint16)
    out["z"] = np.clip((t["z"] - leaf["z"]) / leaf["size"] * 65536, 0, 65535).astype(np.uint16)
    out["y"] = t["y"]
    out["scale"] = np.clip(np.rint(t["scale"] / SCALE_UNIT), 1, 65535)
    out["yaw"] = np.floor(t["yaw"] / (2 * np.pi) * 256).astype(np.int64) % 256
    out["species"] = t["species"]
    out["tiltX"] = np.rint(t["tiltX"] * 127)
    out["tiltZ"] = np.rint(t["tiltZ"] * 127)
    cells = round(leaf["size"] / CELL_METRES)
    cell_x, cell_z = out["x"].astype(np.int64) * cells // 65536, out["z"].astype(np.int64) * cells // 65536
    return out[np.lexsort((-out["scale"].astype(np.int64), cell_x, cell_z, out["species"]))]


def write(folder, leaf_id, leaf, t):
    path = OUT / folder / f"{leaf_id}.bin"
    if len(t["x"]):
        records(leaf, t).tofile(path)
    else:
        path.unlink(missing_ok=True)
    return len(t["x"])


def manifest_species(species, stats):
    out = []
    for sp in species:
        st, kind = stats[sp["name"]], sp["kind"]
        collider = st.get("collider")
        out.append({"id": sp["name"], "kind": kind, "modelUrl": f"{flora_pack.URL_BASE}{st['file']}",
                    "lodDistances": flora_pack.LOD_DISTANCES[kind], "size": st["size"],
                    "castsShadows": sp["entry"]["id"] not in flora_pack.NO_SHADOWS, "collider": collider})
    return out


def main():
    ap = argparse.ArgumentParser(description="Builds the Crater Lake forest: forest.json and the per-leaf placement files.")
    ap.add_argument("--area", default="", help="X,Z,RADIUS in world metres: build only the leaves within RADIUS of (X, Z)")
    args = ap.parse_args()
    started = time.time()
    flora = place.load_flora()
    species = flora_pack.species_list(flora)
    stats = json.loads((flora_pack.WORK / "species_stats.json").read_text())
    for index, sp in enumerate(species):
        sp["index"] = index
        sp["height"] = stats[sp["name"]]["height"]
    leaves = json.loads(GROUND.read_text())["leaves"]
    owner = leaf_owner(leaves)
    manifest_path = OUT / "forest.json"
    if args.area:
        ax, az, radius = map(float, args.area.split(","))
        chosen = [n for n, l in enumerate(leaves)
                  if np.hypot(max(l["x"] - ax, 0, ax - l["x"] - l["size"]), max(l["z"] - az, 0, az - l["z"] - l["size"])) < radius]
        counts = json.loads(manifest_path.read_text())["leaves"] if manifest_path.exists() else [[0, 0] for _ in leaves]
    else:
        chosen = list(range(len(leaves)))
        counts = [[0, 0] for _ in leaves]
        for folder in ("leaves", "mid"):
            shutil.rmtree(OUT / folder, ignore_errors=True)
    for folder in ("leaves", "mid"):
        (OUT / folder).mkdir(parents=True, exist_ok=True)
    picked = np.zeros(len(leaves), bool)
    picked[chosen] = True
    # Water plants spread up to a bed's radius into the next leaf, so the leaves that close are placed too.
    spill = max(f["clusters"]["bedRadius"] for f in flora if "clusters" in f)

    def touches(a, b):
        return (a["x"] - spill < b["x"] + b["size"] and b["x"] < a["x"] + a["size"] + spill
                and a["z"] - spill < b["z"] + b["size"] and b["z"] < a["z"] + a["size"] + spill)

    placing = chosen if not args.area else [n for n, l in enumerate(leaves) if any(touches(l, leaves[c]) for c in chosen)]

    vegetation = Vegetation()
    props = prop_positions()
    bounds = (min(leaves[n]["x"] for n in chosen), max(leaves[n]["x"] + leaves[n]["size"] for n in chosen),
              min(leaves[n]["z"] for n in chosen), max(leaves[n]["z"] + leaves[n]["size"] for n in chosen))
    trees, tall = place_trees(np.random.default_rng([place.SEED, len(leaves)]), vegetation, props, species, bounds)
    print(f"{len(tall)} trees in {time.time() - started:.0f}s", flush=True)

    # The middle band keeps the tallest tree of each 14 m cell of the world.
    cell = np.floor(trees["x"] / MID_CELL_METRES).astype(np.int64) * 100_003 + np.floor(trees["z"] / MID_CELL_METRES).astype(np.int64)
    order = np.lexsort((-tall, cell))
    first = order[np.concatenate([[True], cell[order][1:] != cell[order][:-1]])] if len(order) else order
    middle = {k: v[first] for k, v in trees.items()}

    others = gather([place_leaf(n, leaves[n], flora, species, props, stats) for n in placing])
    print(f"{len(others['x'])} rocks, shrubs and water plants in {time.time() - started:.0f}s", flush=True)

    everything = gather([trees, others])
    totals = np.zeros(2, np.int64)
    for folder, t, slot in (("leaves", everything, 0), ("mid", middle, 1)):
        leaf = leaf_of(owner, t["x"], t["z"])
        order = np.argsort(leaf, kind="stable")
        starts = np.searchsorted(leaf[order], np.arange(len(leaves) + 1))
        for n in chosen:
            rows = order[starts[n]:starts[n + 1]]
            counts[n][slot] = write(folder, n, leaves[n], {k: v[rows] for k, v in t.items()})
            totals[slot] += counts[n][slot]

    manifest = {"format": 1, "leavesUrl": f"{flora_pack.URL_BASE}leaves/", "midUrl": f"{flora_pack.URL_BASE}mid/",
                "recordBytes": RECORD.itemsize, "scaleUnit": SCALE_UNIT, "cellMetres": CELL_METRES,
                "nearMetres": NEAR_METRES, "midMetres": MID_METRES, "pixelReach": PIXEL_REACH,
                "species": manifest_species(species, stats), "leaves": counts}
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":")))

    kinds = np.array([sp["kind"] for sp in species])
    in_chosen = picked[leaf_of(owner, everything["x"], everything["z"])]
    for kind in ("tree", "rock", "shrub", "waterPlant"):
        print(f"{kind}: {int((in_chosen & (kinds[everything['species']] == kind)).sum())}")
    size = sum(p.stat().st_size for folder in ("leaves", "mid") for p in (OUT / folder).glob("*.bin"))
    print(f"{len(chosen)} leaves; {totals[0]} records, {totals[1]} middle-band trees; {size / 1e6:.1f} MB on disk; "
          f"done in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
