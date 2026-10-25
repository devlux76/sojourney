"""Build the Crater Lake props: one GLB per prop in public/packs/crater-lake/props/ plus props.json.

Each GLB is in real-world metres with authored LOD levels named <name>_LOD<n> (LOD0 is the original
geometry), KTX2 UASTC textures with full mip chains and meshopt-compressed geometry. props.json holds
bounds, walk boxes and blockers in the engine frame: Babylon's glTF loader parents everything under a
__root__ with a half turn about Y plus a Z scale of -1 (see _LoadTransform in
node_modules/@babylonjs/loaders/glTF/2.0/glTFLoader.pure.js), whose net effect in a left-handed scene
is an X mirror, so the file geometry is spun half a turn about Y (spin()) to cancel it. Without the
spin the pier would run toward -z and the bow would point -z in game while props.json said +z.

Usage: python3 tools/build_props.py [prop ...]      (default: every prop in PROPS)
Then rebuild the pack index: python3 tools/build_pack_index.py crater-lake
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import flora_fetch as fetch
import flora_geometry as geo
import flora_models as models

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "packs" / "crater-lake" / "props"
STAGE = models.WORK / "props"

PROPS = {
    "stone_fire_pit": {
        "asset": "stone_fire_pit", "res": "2k", "texture": 2048, "lods": (-1, 1200, 350),
        "lodDistances": [15, 50],
        "origin": "centre of the pit in x/z, y = 0 at the ground under the stones",
    },
    "modular_wooden_pier": {
        "asset": "modular_wooden_pier", "res": "2k", "texture": 2048, "lods": (-1, 24000, 6000, 1200),
        "lodDistances": [30, 90, 300], "assemble": "pier",
        "kit": {"start": "01", "mid": ("02", "03"), "pairs": 2, "end": "04", "pole": "poles", "reach": 2, "overlap": 0.5,
                "footBelow": -0.3, "footCell": 0.8, "deck": 0.2},
        "origin": "shore end of the deck, centred across the width; y = 0 at the top of the deck; the pier runs along +z",
    },
    "dutch_ship_medium": {
        "asset": "dutch_ship_medium", "res": "2k", "texture": 2048, "lods": (-1, 18000, 4500, 900),
        "lodDistances": [60, 180, 500], "assemble": "ship",
        "weights": {"hull": 0.55, "sails": 0.1, "rigging": 0.35}, "waterline": 0.0, "deck": 0.15,
        "origin": "centre of the hull at the waterline, y = 0 at the water surface; the bow points along +z",
    },
}


# Poly Haven names duplicate materials 'x.001' on import; they share the same textures, so the suffix is dropped
# and each distinct material gets one id, which keeps every prop to its authored material count.
class Mats:
    def __init__(self):
        self.ids = {}

    def id(self, name):
        return self.ids.setdefault(re.sub(r"\.\d+$", "", name), len(self.ids))

    def keys(self):
        return sorted(self.ids, key=self.ids.get)


# Runs Blender's headless export (flora_dump.py) on a pick of objects and reads the corners back, one result
# per triangle target (-1 = the original mesh). Coordinates come out glTF-style (+Y up); spin() below turns
# them into the engine frame before assembly, so meta code works in engine axes throughout.
def dump(gltf, pick, key, targets, mats, extra=None):
    paths = [models.DUMP / f"prop_{key}_{k}_{t}.npz" for k, t in enumerate(targets)]
    models.run_dump({"gltf": str(gltf), "pick": pick, **(extra or {}), "outputs": [{"out": str(p), "target": t, "merge": True} for p, t in zip(paths, targets)]})
    out = []
    for path in paths:
        local = {}
        c = models.read_corners(path, "solid", local)
        remap = np.array([mats.id(n) for n in sorted(local, key=local.get)], np.int32)
        out.append(geo.Corners(c.pos, c.nor, c.uv, remap[c.mat] if c.tris else c.mat))
    return out


# Translates a mesh; with rotate=True also turns it a quarter turn about +Y so that +X (the ship's bow in
# the source file) points along -Z; spin() below then flips it to +z in the engine frame.
def moved(c, offset=(0, 0, 0), rotate=False):
    pos, nor = c.pos.astype(np.float64), c.nor.astype(np.float64)
    if rotate:
        pos, nor = pos[:, [2, 1, 0]] * [1, 1, -1], nor[:, [2, 1, 0]] * [1, 1, -1]
    return geo.Corners(pos + np.asarray(offset), nor, c.uv, c.mat)


# Half turn about +Y: (x, y, z) -> (-x, y, -z). Applied to every assembled part so the file geometry is
# already in the engine frame (see the module docstring): the pier runs toward +z and the bow points +z
# in game, matching props.json. A proper rotation, so winding order and normals stay valid.
def spin(c):
    pos, nor = c.pos.astype(np.float64) * [-1, 1, -1], c.nor.astype(np.float64) * [-1, 1, -1]
    return geo.Corners(pos, nor, c.uv, c.mat)


def level_parts(parts, mats):
    out = {}
    for c in parts:
        if not c.tris:
            continue
        for m in np.unique(c.mat):
            out.setdefault(int(m), []).append(c.take(c.mat == m))
    return [(mats.keys()[m], geo.Corners.concat(v)) for m, v in sorted(out.items())]


# Finds where each pole of a section ends: vertices of the pole material below footBelow are grouped on a
# footCell grid, one group per pole, so the extension poles can be stacked under exactly those spots.
def cluster_feet(c, pole_id, kit):
    v = c.pos[np.repeat(c.mat == pole_id, 3)]
    low = v[v[:, 1] < kit["footBelow"]]
    if not len(low):
        return []
    cell = np.round(low[:, [0, 2]] / kit["footCell"]).astype(int)
    u, inv = np.unique(cell, axis=0, return_inverse=True)
    feet = []
    for k in range(len(u)):
        q = low[inv.ravel() == k]
        if len(q) < 60:
            continue
        bottom = q[:, 1].min()
        foot = q[q[:, 1] < bottom + 0.1]
        feet.append((float(foot[:, 0].mean()), float(bottom), float(foot[:, 2].mean())))
    return feet


# Height of the walking surface: the y with the most upward-facing plank area (the plank tops), not the
# highest plank vertex, which would be a rope knot or crossbeam.
def deck_height(c, plank_id):
    n = c.nor.reshape(-1, 3, 3).mean(1)
    p = c.pos.reshape(-1, 3, 3)
    up = (c.mat == plank_id) & (n[:, 1] > 0.9)
    area = 0.5 * np.linalg.norm(np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]), axis=1)
    h, e = np.histogram(p[up].mean(1)[:, 1], bins=np.arange(p[up][..., 1].min(), p[up][..., 1].max() + 0.02, 0.02), weights=area[up])
    return float(e[np.argmax(h)] + 0.01)


# The kit is one run of sections: a start section, two repeatable middle sections, and an end section with a
# ramp. The pier repeats the middle pair `pairs` times, keeping the kit's own spacing (measured from its node
# positions), and finishes with the ramp. The kit's poles reach only ~3.5 m below the deck but the lake bed
# drops away fast, so under every pole foot `reach` copies of a loose kit pole are stacked end to end (with
# `overlap` so the joint is hidden); nothing is stretched, so the wood grain stays true.
# Origin: shore end of the deck, centred across the width, y = 0 at the plank tops, running along +z.
# LOD levels decimate each module (and the loose pole) by the same ratio before assembly.
def assemble_pier(name, spec, gltf):
    kit, mats = spec["kit"], Mats()
    plank_id, pole_id = mats.id("modular_wooden_pier_planks"), mats.id("modular_wooden_pier_poles")
    nodes = {n["name"]: n for n in json.loads(Path(gltf).read_text())["nodes"]}
    z_of = lambda tag: nodes[f"modular_wooden_pier_section_{tag}"]["translation"][2]
    pair_pitch = 2 * (z_of(kit["mid"][1]) - z_of(kit["mid"][0]))
    modules = [kit["start"], *kit["mid"], kit["end"]]
    pick = lambda tag: "modular_wooden_pier_poles" if tag == kit["pole"] else f"modular_wooden_pier_section_{tag}"
    full = {tag: dump(gltf, pick(tag), f"pier_{tag}", [-1], mats)[0] for tag in [*modules, kit["pole"]]}
    sequence = [(kit["start"], 0.0), *[(t, 0.0) for t in kit["mid"]]]
    for p in range(1, kit["pairs"] + 1):
        sequence += [(t, p * pair_pitch) for t in kit["mid"]]
    sequence.append((kit["end"], kit["pairs"] * pair_pitch))
    feet = {t: cluster_feet(full[t], pole_id, kit) for t in modules}

    def pole_of(piece):
        c = piece.pos.reshape(-1, 3, 3).mean(1)
        return piece.take((c[:, 0] < 0) & (c[:, 2] > 6.5) & (c[:, 2] < 7.4))

    pole_full = pole_of(full[kit["pole"]])
    total = sum(full[t].tris for t, _ in sequence) + sum(len(feet[t]) for t, _ in sequence) * kit["reach"] * pole_full.tris

    deck_y = deck_height(full[kit["mid"][0]], plank_id)
    shore_z = float(full[kit["start"]].pos[np.repeat(full[kit["start"]].mat == plank_id, 3)][:, 2].max())
    mid = full[kit["mid"][0]].pos[np.repeat(full[kit["mid"][0]].mat == plank_id, 3)]
    surface = mid[np.abs(mid[:, 1] - deck_y) < 0.03]
    centre_x = float((surface[:, 0].min() + surface[:, 0].max()) / 2)
    half_width = float((surface[:, 0].max() - surface[:, 0].min()) / 2)
    shift = np.array([-centre_x, -deck_y, -shore_z])

    levels = []
    for lod in spec["lods"]:
        ratio = 1.0 if lod == -1 else lod / total
        cut = full if lod == -1 else {t: dump(gltf, pick(t), f"pier_{t}_{int(ratio * 1e4)}", [max(8, int(full[t].tris * ratio))], mats)[0] for t in [*modules, kit["pole"]]}
        pole = pole_of(cut[kit["pole"]])
        base = pole.pos[pole.pos[:, 1] < pole.pos[:, 1].min() + 0.3]
        px, pz, ptop = float(base[:, 0].mean()), float(base[:, 2].mean()), float(pole.pos[:, 1].max())
        pole_len = ptop - float(pole.pos[:, 1].min())
        parts = []
        for tag, dz in sequence:
            off = np.array([0, 0, dz]) + shift
            parts.append(spin(moved(cut[tag], off)))
            for fx, fy, fz in feet[tag]:
                for r in range(kit["reach"]):
                    top = fy + kit["overlap"] - r * (pole_len - kit["overlap"])
                    parts.append(spin(moved(pole, off + np.array([fx - px, top - ptop, fz - pz]))))
        levels.append(level_parts(parts, mats))

    # The ramp walk line follows the plank tops, not the extreme verts: the lowest verts at the tip are
    # plank undersides about half a metre below the walking surface, and the old line through them sank
    # the player's feet through the deck at the tip. z_from is the last plank row still at deck height;
    # tip_top is the top surface at the tip.
    end = spin(moved(full[kit["end"]], np.array([0, 0, kit["pairs"] * pair_pitch]) + shift))
    ends = end.pos[np.repeat(end.mat == plank_id, 3)]
    tri = end.pos.reshape(-1, 3, 3)
    tops = tri[(end.nor.reshape(-1, 3, 3).mean(1)[:, 1] > 0.9) & (end.mat == plank_id)].mean(1)
    z = lambda v: round(float(v), 3)
    z_from = z(tops[tops[:, 1] > -0.05][:, 2].max())
    tip_z = z(ends[:, 2].max())
    tip_top = z(tops[tops[:, 2] > ends[:, 2].max() - 0.5][:, 1].max())
    top = geo.Corners.concat([c for _, c in levels[0]])
    meta = {
        "deckWidth": z(2 * half_width), "poleReachBelowDeck": z(-top.pos[:, 1].min()),
        "walk": [
            {"kind": "deck", "x": [z(-half_width), z(half_width)], "z": [0.0, z_from], "yTop": 0.0, "thickness": spec["kit"]["deck"]},
            {"kind": "ramp", "x": [z(-half_width), z(half_width)], "from": {"z": z_from, "y": 0.0},
             "to": {"z": tip_z, "y": tip_top}, "thickness": spec["kit"]["deck"]},
        ],
    }
    return levels, mats, meta


# The ship's three parts keep their own materials. y = 0 is the waterline: the hull is widest at y = 0.5 and
# its keel is 2 m below, a normal draught, so the file's own zero is used. The origin is the centre of the
# hull's footprint at the waterline, and the model is turned so the bow (the bowsprit side) points along +z
# in the engine frame (rotate puts it at file -z, spin() flips it to engine +z; see the module docstring).
# Hull and sails are decimated for lower LODs; the rigging is mostly thin ropes that decimation destroys, so
# lower LODs keep whole rope/spar pieces, longest first, which holds the masts and yards in the silhouette.
def assemble_ship(name, spec, gltf):
    mats = Mats()
    for key in ("rigging", "hull", "sails"):
        mats.id(f"dutch_ship_medium_{key}")
    full = {k: dump(gltf, f"dutch_ship_medium_{k}", f"ship_{k}", [-1], mats)[0] for k in ("hull", "sails", "rigging")}
    hull = ship_hull(gltf, spec, mats)
    centre = centre_of(full["hull"], spec)
    levels = []
    for k, lod in enumerate(spec["lods"]):
        parts = []
        for part in ("hull", "sails", "rigging"):
            budget = None if lod == -1 else max(24, int(lod * spec["weights"][part]))
            if lod == -1:
                c = full[part]
            elif part == "rigging":
                c = longest_islands(full[part], budget)
            else:
                c = dump(gltf, f"dutch_ship_medium_{part}", f"ship_{part}_{budget}", [budget], mats)[0]
            parts.append(spin(moved(moved(c, -centre), rotate=True)))
        levels.append(level_parts(parts, mats))
    return levels, mats, ship_meta(hull, spec, np.concatenate([c.pos for _, c in levels[0]]))


# The hull alone, in the engine frame: y = 0 is the waterline and the centre of the hull's footprint at the
# waterline is the origin, which is the band of hull within 15 cm of the waterline (the widest part of the
# hull, so the centre of it is the centre of the ship). Shared by the assembly and by
# tools/check_ship_deck.py, which measures the decks from the same mesh.
def centre_of(hull, spec):
    band = hull.pos[np.abs(hull.pos[:, 1] - spec["waterline"]) < 0.15]
    return np.array([(band[:, 0].min() + band[:, 0].max()) / 2, 0, (band[:, 2].min() + band[:, 2].max()) / 2])


def ship_hull(gltf, spec, mats):
    raw = dump(gltf, "dutch_ship_medium_hull", "ship_hull", [-1], mats)[0]
    return spin(moved(moved(raw, -centre_of(raw, spec)), rotate=True))


# Keeps whole connected pieces of a mesh, longest bounding diagonal first, within a triangle budget.
def longest_islands(c, budget):
    isl = geo.Islands(c)
    tp = c.pos.reshape(-1, 3, 3)
    diag = np.array([np.linalg.norm(np.ptp(tp[isl.island_of_tri == i].reshape(-1, 3), axis=0)) for i in range(isl.count)])
    keep, used = np.zeros(isl.count, bool), 0
    for i in np.argsort(-diag):
        if used + isl.tri_counts[i] <= budget:
            keep[i] = True
            used += isl.tri_counts[i]
    return c.take(isl.tri_mask(keep))


# Deck detection. The decks are measured from the hull rather than assumed: a deck is a patch of
# up-facing hull surface, rasterised onto a DECK_CELL grid. Patches that touch in plan and lie within
# SURFACE_JOIN of each other in height are one surface, for as long as the surface stays within
# SURFACE_SPREAD of its own lowest point - which keeps a cambered deck whole, and stops a cap rail
# (which rides up to a metre above the deck it rims and follows the sheer around the whole ship) from
# joining it. Each surface is then opened with a DECK_SPAN element, which drops anything narrower than
# that: a rail, a rope, a grating bar. That is the rule tools/check_ship_deck.py holds the result to.
DECK_CELL = 0.1            # grid a deck surface is measured on, m
DECK_SPAN = 0.3            # smallest deck worth walking on, m across
DECK_WIDTH = 1.0           # a deck is at least this wide across the ship, m: the player is 0.6 wide
DECK_COVER = 0.7           # a surface this much inside a deck already found is a fitting on it, and the
                         # deck's own walk boxes already carry it
SURFACE_BAND = 0.2         # height step the up-facing surface is cut into patches at, m
SURFACE_JOIN = 0.3         # patches this close in height may be one surface, m
SURFACE_SPREAD = 0.6       # one surface's own height range, m: the deck is cambered and sheer, so it
                         # needs room, while a rail above it is a metre up and stays out
RAIL_THICK = 0.25          # how far outboard of a deck's edge its rail stands, m
RAIL_MIN = 1.0             # a rail rises at least this far above its deck, even where the bulwark is lower
RAIL_REACH = 0.4           # a rail is only drawn where the hull has bulwark within this of the deck's edge
DECK_OUTER = 0.3           # a rail is only drawn within this of the widest deck in its row, m
SEAM = 0.3                 # two decks this close in z are one break, m
STEP_RISE = 0.6            # a break taller than this gets a step to climb it; a lower one you step down
STEP_THICK = 0.2           # how deep a step or an end rail is, m
BOX_WIDTH = 0.15           # how much a walk box's width may change before it becomes another box, m
BOX_RUN = 2.0              # longest run of deck one walk box covers, m: a flat top cannot follow the camber


# A triangle's flat normal, straight from its winding: a deck is flat, so this is what tells a deck from
# the rounded top of a rope or a spar, which the smooth vertex normals would call horizontal.
def face_up(tri):
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    return n[:, 1] > 0.95 * np.linalg.norm(n, axis=1)


def shrink(mask, cells=1):
    for _ in range(cells):
        out = mask.copy()
        out[1:, :] &= mask[:-1, :]
        out[:-1, :] &= mask[1:, :]
        out[:, 1:] &= mask[:, :-1]
        out[:, :-1] &= mask[:, 1:]
        mask = out
    return mask


def grow(mask, cells=1):
    for _ in range(cells):
        out = mask.copy()
        out[1:, :] |= mask[:-1, :]
        out[:-1, :] |= mask[1:, :]
        out[:, 1:] |= mask[:, :-1]
        out[:, :-1] |= mask[:, 1:]
        mask = out
    return mask


def opening(mask, cells):
    """Erode then dilate: keeps only what a (2*cells+1) square fits inside, so a patch narrower than the
    element - a rail, a rope, a grating bar - goes and a deck comes back the size it was."""
    return grow(shrink(mask, cells), cells)


def components(mask):
    """4-connected components of a cell mask, as a label grid (-1 where the cell is empty)."""
    lab = np.full(mask.shape, -1, np.int32)
    count = 0
    for start in zip(*np.nonzero(mask)):
        if lab[start] >= 0:
            continue
        stack = [start]
        lab[start] = count
        while stack:
            j, i = stack.pop()
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                a, b = j + dj, i + di
                if 0 <= a < mask.shape[0] and 0 <= b < mask.shape[1] and mask[a, b] and lab[a, b] < 0:
                    lab[a, b] = count
                    stack.append((a, b))
        count += 1
    return lab, count


def cells_under(tri_xz, shape, origin):
    """(row, column, triangle) for every cell whose centre falls inside that triangle's footprint: a
    surface's plan, on the grid every later measurement is made on."""
    gx = origin[0] + (np.arange(shape[1]) + 0.5) * DECK_CELL
    gz = origin[1] + (np.arange(shape[0]) + 0.5) * DECK_CELL
    for k, t in enumerate(tri_xz):
        span = lambda v, o, n: (max(0, int(np.floor((v.min() - o) / DECK_CELL))),
                                min(n, int(np.ceil((v.max() - o) / DECK_CELL)) + 1))
        i0, i1 = span(t[:, 0], origin[0], shape[1])
        j0, j1 = span(t[:, 1], origin[1], shape[0])
        if i0 >= i1 or j0 >= j1:
            continue
        X, Z = np.meshgrid(gx[i0:i1], gz[j0:j1])
        w = []
        for a in range(3):
            p, q = t[a], t[(a + 1) % 3]
            w.append((X - p[0]) * (q[1] - p[1]) - (Z - p[1]) * (q[0] - p[0]))
        w = np.stack(w)
        for j, i in zip(*np.nonzero((w >= 0).all(0) | (w <= 0).all(0))):
            yield j0 + j, i0 + i, k


def row_span(row):
    """The first and last cell of a row, or None where the row is empty."""
    i = np.nonzero(row)[0]
    return None if not len(i) else (int(i.min()), int(i.max()))


def row_segments(row):
    """A row's stretches of deck as (first cell, last cell) pairs, so a row with two strips in it is two."""
    out, start = [], None
    for i, cell in enumerate(np.append(row, False)):
        if cell and start is None:
            start = i
        elif not cell and start is not None:
            out.append((start, i - 1))
            start = None
    return out


# Cuts the up-facing surface into height bands and then into the separate patches inside each band, and
# joins the patches that touch in plan into surfaces: one deck of the ship. A patch joins only while the
# surface stays within SURFACE_SPREAD of its own lowest point, so a cambered deck stays whole but the cap
# rail that rims it - up to a metre higher, and following the sheer around the whole ship - stays a surface
# of its own and goes in the opening below for being narrower than DECK_SPAN.
def deck_surfaces(up, shape, origin):
    centres = up[:, :, 1].mean(1)
    atoms = []
    for y0 in np.arange(up[:, :, 1].min(), up[:, :, 1].max() + SURFACE_BAND, SURFACE_BAND):
        pick = (centres >= y0) & (centres < y0 + SURFACE_BAND)
        if not pick.any():
            continue
        sel = up[pick]
        entries = list(cells_under(sel[:, :, [0, 2]], shape, origin))
        if not entries:
            continue
        mask = np.zeros(shape, bool)
        for j, i, _ in entries:
            mask[j, i] = True
        lab, _ = components(mask)
        buckets = {}
        for j, i, k in entries:
            buckets.setdefault(int(lab[j, i]), []).append(k)
        for part, ks in buckets.items():
            cells = lab == part
            tris = sel[np.unique(ks)]
            here = centres[pick][np.unique(ks)]
            atoms.append({"lo": float(here.min()), "hi": float(here.max()),
                          "mask": cells, "tris": tris, "area": float(cells.sum()) * DECK_CELL ** 2})
    surfaces = []
    for k in sorted(range(len(atoms)), key=lambda k: -atoms[k]["area"]):
        atom = atoms[k]
        for s in surfaces:
            close = max(s["lo"], atom["lo"]) - min(s["hi"], atom["hi"]) <= SURFACE_JOIN
            if (close and max(s["hi"], atom["hi"]) - min(s["lo"], atom["lo"]) <= SURFACE_SPREAD
                    and (grow(atom["mask"]) & s["mask"]).any()):
                s["atoms"].append(k)
                s["lo"], s["hi"] = min(s["lo"], atom["lo"]), max(s["hi"], atom["hi"])
                s["mask"] |= atom["mask"]
                break
        else:
            surfaces.append({"atoms": [k], "lo": atom["lo"], "hi": atom["hi"], "mask": atom["mask"].copy()})
    out, covered = [], np.zeros(shape, bool)
    for s in surfaces:
        mask = opening(s["mask"], int(round(DECK_SPAN / DECK_CELL / 2)))
        cols = np.nonzero(mask.any(0))[0]
        # A surface has to be DECK_WIDTH wide to be a deck (the player is 0.6 m), and one that lies inside
        # a deck already kept is a fitting standing on it - a hatch cover, the floor of the boat on the
        # booms - which that deck's own walk boxes already carry.
        if not len(cols) or (cols[-1] - cols[0] + 1) * DECK_CELL < DECK_WIDTH:
            continue
        if mask.any() and (mask & covered).sum() >= DECK_COVER * mask.sum():
            continue
        tris = np.concatenate([atoms[k]["tris"] for k in s["atoms"]])
        # the lowest planking of this surface in each cell: a deck's cap rail shares its rows, and the player
        # walks the deck, not the rail
        low = np.full(shape, np.inf)
        for j, i, k in cells_under(tris[:, :, [0, 2]], shape, origin):
            low[j, i] = min(low[j, i], tris[k][:, 1].mean())
        out.append({"mask": mask, "tris": tris, "low": low, "y": float(tris[:, :, 1].mean(1).mean()),
                    "x": (float(cols.min()), float(cols.max()))})
        covered |= mask
    return out


# One walk box per run of deck rows whose width stays put: a row continues the run its k-th segment from
# the left belongs to while that segment's edges stay within BOX_WIDTH of the run's first row, so a row with
# two strips in it (the forecastle's side walkways) is two runs and not one box across the gap between them.
# A run is cut at BOX_RUN, because a flat top cannot follow the camber for ever, and at DECK_WIDTH, because a
# ledge narrower than the player is not floor. Each box carries the rows it was measured from, which is what
# the rails and the steps are then measured against: a ledge that got no box is not deck to them.
def deck_boxes(surface, spec, low, x_of, z_of, r):
    runs, done = {}, []
    for j in range(surface["mask"].shape[0]):
        segments = row_segments(surface["mask"][j])
        for k in [k for k, run in runs.items()
                  if k >= len(segments) or run["j1"] != j - 1
                  or abs(np.subtract(segments[k], run["first"])).max() * DECK_CELL > BOX_WIDTH
                  or (j - run["j0"]) * DECK_CELL > BOX_RUN]:
            done.append(runs.pop(k))
        for k, segment in enumerate(segments):
            if k in runs:
                # the run spans every row between its first and its last, so the box has to be as wide as the
                # widest of them, not as wide as the two ends
                runs[k]["j1"] = j
                runs[k]["lo"] = min(runs[k]["lo"], segment[0])
                runs[k]["hi"] = max(runs[k]["hi"], segment[1])
            else:
                runs[k] = {"j0": j, "j1": j, "first": segment, "lo": segment[0], "hi": segment[1]}
    walk = []
    for run in done + list(runs.values()):
        j0, j1 = run["j0"], run["j1"]
        lo, hi = run["lo"], run["hi"]
        if (hi - lo + 1) * DECK_CELL < DECK_WIDTH:
            continue
        # the box's top is the walking surface, the lowest planking in its cells: a deck whose cap rail is in
        # the same rows is walked at the deck's height, not at the rail's
        cells = low[j0:j1 + 1, run["lo"]:run["hi"] + 1]
        y = float(cells[surface["mask"][j0:j1 + 1, run["lo"]:run["hi"] + 1]].mean())
        # a box reaches a whole cell past its rows, so two decks whose masks do not quite meet still meet
        walk.append({"y": r(y), "z": [r(z_of(j0) - DECK_CELL), r(z_of(j1) + DECK_CELL)],
                     "x": [r(x_of(lo)), r(x_of(hi))], "thickness": spec["deck"], "rows": (j0, j1)})
    return walk


# Where the player can stand: the walk boxes, as cells. The rails are measured against this and not against
# the surfaces, so that a ledge too narrow to walk on (the forecastle's side walkways) is not mistaken for
# the side of the ship.
def standable(walk, shape, x_of):
    cols = x_of(np.arange(shape[1]))
    out = np.zeros(shape, bool)
    for box in walk:
        j0, j1 = box["rows"]
        i = np.nonzero((cols >= box["x"][0]) & (cols <= box["x"][1]))[0]
        out[j0:j1 + 1, i.min():i.max() + 1] = True
    return out


# One rail blocker per walk box, on each side the box reaches the side of the ship on: `outer` is the widest
# deck in a row, so the panels and ledges standing on a deck (the floor of the boat on the booms) get none.
# The rail stands just outboard of the box, never inside it - which is what the invisible inner rail along
# the waist was: every deck slab's own blocker, over a metre inside the next, wider slab's. Its height comes
# from the hull's bulwark above the deck's edge; where the model has none, or only a low strake (as in the
# open waist), the rail still rises RAIL_MIN: an invisible knee wall, but at the rail, not short of it.
def deck_rails(boxes, verts, outer, z_of, r):
    rails = []
    for box in boxes:
        j0, j1 = box["rows"]
        # the rail covers the rows the box was measured from and half a cell either side of them, so that two
        # boxes side by side have rails that meet rather than overlap: a box reaches a whole cell past its rows
        # so that decks whose masks do not quite meet still meet, and a rail that did the same would stand
        # inside the deck next door, where that deck is wider
        z = [r(z_of(j0) - DECK_CELL / 2), r(z_of(j1) + DECK_CELL / 2)]
        for sign, edge in ((-1, box["x"][0]), (1, box["x"][1])):
            if abs(edge) < max(outer[j0:j1 + 1]) - DECK_OUTER:
                continue
            near = verts[(verts[:, 2] >= z[0]) & (verts[:, 2] <= z[1])
                         & (verts[:, 1] > box["y"]) & (verts[:, 1] < box["y"] + 1.5)
                         & (np.sign(verts[:, 0]) == sign)
                         & (np.abs(verts[:, 0] - edge) < RAIL_REACH + RAIL_THICK)]
            if not len(near):
                continue
            top = max(float(near[:, 1].max()), box["y"] + RAIL_MIN)
            x = [r(edge), r(edge + RAIL_THICK)] if sign > 0 else [r(edge - RAIL_THICK), r(edge)]
            rails.append({"x": x, "z": list(z), "y": [r(box["y"]), r(top)]})
    return rails


# A step or a rail across every break in the deck. Where a deck meets another within SEAM, and no more than
# STEP_RISE above or below it, the player steps across or down and nothing is drawn; where the rise is
# greater, a step to climb it is drawn from the lower deck's height to the upper deck's, so that jumping
# onto it lands the player on the upper deck itself - the ledge at the break below the forecastle. Where a
# deck simply ends - the head of the ship, the taffrail - a rail closes it: there is nothing there to meet,
# and without it the bow can be run off into the lake.
def deck_ends(boxes, r):
    out, drawn = [], []
    reach = int(SEAM / DECK_CELL)
    for box in boxes:
        j0, j1 = box["rows"]
        for j, step in ((j0, -1), (j1, 1)):
            slab = (max(0, j - reach), j) if step < 0 else (j + 1, j + 1 + reach)
            # the decks within SEAM of this end that overlap it in width; the furthest in height is the one a
            # step has to reach
            meets = [o for o in boxes if o is not box and o["rows"][1] >= slab[0] and o["rows"][0] <= slab[1]
                     and min(o["x"][1], box["x"][1]) - max(o["x"][0], box["x"][0]) >= DECK_SPAN]
            z = box["z"][0] if step < 0 else box["z"][1]
            if not meets:
                out.append({"x": list(box["x"]), "z": [r(z - STEP_THICK / 2), r(z + STEP_THICK / 2)],
                            "y": [r(box["y"] - RAIL_MIN), r(box["y"] + RAIL_MIN)], "kind": "end"})
                continue
            other = max(meets, key=lambda o: abs(o["y"] - box["y"]))
            low, high = sorted((box["y"], other["y"]))
            if high - low <= STEP_RISE:
                continue
            if any(abs(z - at) < SEAM and abs(low - a) < STEP_RISE and abs(high - b) < STEP_RISE
                   for at, a, b in drawn):
                continue
            drawn.append((z, low, high))
            # the step spans the narrower of the two decks, measured from the centreline: the ship's frame is
            # symmetric about x = 0, and this keeps the raster's edge cells out of the step's width
            half = min(abs(box["x"][0]), abs(box["x"][1]), abs(other["x"][0]), abs(other["x"][1]))
            out.append({"x": [r(-half), r(half)], "z": [r(z - STEP_THICK / 2), r(z + STEP_THICK / 2)],
                        "y": [r(low), r(high)], "kind": "step"})
    return out


# Measures the ship's walkable decks from the hull's own up-facing surfaces (see DECK_CELL above), and the
# rails and steps that keep the player on them. All coordinates are engine frame: the hull arrives already
# spun, so x is engine-x and no axis is flipped here.
def ship_meta(hull, spec, everything):
    r = lambda v: round(float(v), 2)
    tri = hull.pos.reshape(-1, 3, 3).astype(np.float64)
    up = tri[face_up(tri)]
    lo, hi = hull.pos.min(0), hull.pos.max(0)
    origin = (float(np.floor(lo[0] / DECK_CELL) * DECK_CELL), float(np.floor(lo[2] / DECK_CELL) * DECK_CELL))
    shape = (int(np.ceil((hi[2] - origin[1]) / DECK_CELL)) + 1, int(np.ceil((hi[0] - origin[0]) / DECK_CELL)) + 1)
    x_of = lambda i: origin[0] + (i + 0.5) * DECK_CELL
    z_of = lambda j: origin[1] + (j + 0.5) * DECK_CELL
    verts = hull.pos.astype(np.float64)

    surfaces = deck_surfaces(up, shape, origin)
    walk = [box for s in surfaces for box in deck_boxes(s, spec, s["low"], x_of, z_of, r)]
    # how far out the ship's side is in each row, so that a rail is only drawn where a deck reaches it
    side = standable(walk, shape, x_of)
    outer = np.array([max(abs(x_of(row_span(side[j])[0])), abs(x_of(row_span(side[j])[1])))
                      if side[j].any() else 0.0 for j in range(shape[0])])
    blockers = deck_rails(walk, verts, outer, z_of, r) + deck_ends(walk, r)
    for box in walk:
        del box["rows"]        # the rows were for the rails and the steps; props.json carries metres only
    heights = sorted({s["y"] for s in surfaces})
    deck = max(surfaces, key=lambda s: s["mask"].sum())["y"]
    walk.sort(key=lambda w: (w["y"], w["z"]))
    blockers.sort(key=lambda b: (b["y"], b["z"], b["x"]))
    return {"waterline": 0.0, "mainDeckHeight": r(deck), "deckLevels": [r(v) for v in heights],
            "mastHeight": r(everything[:, 1].max()), "walk": walk, "blockers": blockers}


# Bounds and LOD info for props.json, converted to the engine frame (the file is X-mirrored on load,
# so engine-x is file -x while y and z carry over; see the module docstring).
def finish_meta(spec, levels, meta):
    pts = np.concatenate([c.pos for _, c in levels[0]])
    lo, hi = pts.min(0), pts.max(0)
    to_babylon = lambda v: [round(float(-v[0]), 3), round(float(v[1]), 3), round(float(v[2]), 3)]
    box = {"min": to_babylon([hi[0], lo[1], lo[2]]), "max": to_babylon([lo[0], hi[1], hi[2]])}
    return {"file": None, "lodDistances": spec["lodDistances"], "triangles": [sum(c.tris for _, c in lv) for lv in levels],
            "bounds": box, "origin": spec["origin"], **meta}


def single(name, spec, gltf):
    mats = Mats()
    lods = dump(gltf, None, f"{name}_single", list(spec["lods"]), mats, {"normalise": {"longest": 0}})
    return [level_parts([c], mats) for c in lods], mats, {}


ASSEMBLERS = {"single": single, "pier": assemble_pier, "ship": assemble_ship}


def build(name, spec):
    gltf = fetch.fetch_gltf(spec["asset"], spec["res"])
    levels, mats, meta = ASSEMBLERS[spec.get("assemble", "single")](name, spec, gltf)
    source = models.ph_materials(gltf)
    size = spec["texture"]
    materials = {}
    for key in mats.keys():
        s = source[key]
        materials[key] = {"base": models.load_rgb(s["base"], size), "normal": models.load_rgb(s["normal"], size),
                          "orm": models.load_rgb(s["orm"], size)}
    meshes = [([f"{name}_LOD{k}"], lv) for k, lv in enumerate(levels)]
    STAGE.mkdir(parents=True, exist_ok=True)
    staged = STAGE / f"{name}.glb"
    models.write_model(staged, meshes, materials, True)
    OUT.mkdir(parents=True, exist_ok=True)
    dst = OUT / f"{name}.glb"
    subprocess.run(["bun", "x", "@gltf-transform/cli@4", "meshopt", str(staged), str(dst), "--level", "medium",
                    "--quantize-position", "16", "--quantize-normal", "14", "--quantize-texcoord", "16"],
                   check=True, stdout=subprocess.DEVNULL)
    info = finish_meta(spec, levels, meta)
    info["file"] = dst.name
    info["bytes"] = dst.stat().st_size
    (STAGE / f"{name}.json").write_text(json.dumps(info, indent=2))
    print(f"{dst}: triangles {info['triangles']}, {dst.stat().st_size / 1e6:.2f} MB")


def manifest():
    props = {}
    for name in PROPS:
        path = STAGE / f"{name}.json"
        if path.exists():
            props[name] = json.loads(path.read_text())
    (OUT / "props.json").write_text(json.dumps({"format": 1, "props": props}, indent=2) + "\n")


def main():
    ap = argparse.ArgumentParser(description="Builds the Crater Lake props.")
    ap.add_argument("props", nargs="*", default=list(PROPS))
    args = ap.parse_args()
    for name in args.props:
        build(name, PROPS[name])
    manifest()


if __name__ == "__main__":
    main()
