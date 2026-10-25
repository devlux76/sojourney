"""Checks the ship's deck collision: every deck the hull has must have floor under it, no rail blocker may
stand inside a deck, and the places ISSUES.md (pass 4, P2) measured must behave.

The decks are measured from the hull mesh itself, not from build_props.py's answer: the up-facing triangles
are rasterised onto a grid, and what they cover is compared with the walk boxes in props.json. Which patches
of that surface count as a deck is build_props.py's rule (DECK_CELL there: up-facing hull surface joined into
surfaces while it stays within SURFACE_SPREAD of its own lowest point, opened with a DECK_SPAN element so a
rail or a ledge goes, and at least DECK_WIDTH wide because the player is 0.6 m) - this check takes the
surfaces it finds and then holds the collision to them, measuring the planking's height per cell from the
mesh again rather than from the pipeline's averages.

Usage: python3 tools/check_ship_deck.py [prop] [manifest.json]     (default: dutch_ship_medium and the
built props.json). Exits 1 if any check fails, so it can be run as a gate.
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_props as bp

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "public" / "packs" / "crater-lake" / "props" / "props.json"
DECK_CELL = 0.1              # grid the hull's deck surfaces are measured on, m
DECK_SPAN = 0.3              # smallest deck worth walking on, m across
DECK_WIDTH = 1.0             # a deck is at least this wide across the ship, m: the player is 0.6 wide
FLOOR_TOL = 0.35             # how far a walk box's top may sit from the deck it stands for, m
BOX_FOOT = 0.8               # a walk box must have at least this much of its footprint on real deck
BLOCK_TOL = 0.1              # how far inside a deck's edge a rail blocker may stand, m
BLOCK_REACH = 0.6            # how far out from a deck's edge a rail blocker may count as that deck's rail

# ISSUES.md P2, in the ship's own frame (z forward, main deck y 1.65, upper deck y 3.05): every point of
# these bands that is deck must have floor under it.
P2_HOLES = [
    ("main deck z 6.27..7.47 (forward end of the waist)", 6.27, 7.47),
    ("upper aft deck forward edge z -4.9..-3.77", -4.9, -3.77),
    ("main deck z -7.93..-4.18 (under the upper aft deck)", -7.93, -4.18),
]
# These have floor and must keep it.
P2_HELD = [
    ("main deck middle z -1.5..1.5", -1.5, 1.5),
    ("upper bow deck z 4.15..6.66", 4.15, 6.66),
    ("bow deck z 9.37..9.98", 9.37, 9.98),
    ("upper deck z 8.0 drops onto the main deck", 7.9, 8.1),
]
# The narrower slabs' blockers used to stand inside the wider waist over these z bands.
P2_FALSE_RAIL = [(-1.55, -0.33), (0.48, 1.58)]
# The waist, where src/engine/boat.ts opens the rail as the gangway while docked.
WAIST_Z = (-2.0, 3.0)


def shrink(mask):
    out = mask.copy()
    out[1:, :] &= mask[:-1, :]
    out[:-1, :] &= mask[1:, :]
    out[:, 1:] &= mask[:, :-1]
    out[:, :-1] &= mask[:, 1:]
    return out


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
    """Keeps only what a (2*cells+1) square fits inside, so a patch narrower than the element - a rail, a
    rope, a grating bar - goes and a deck comes back the size it was."""
    return grow(shrink(mask), cells)


def label(mask):
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


def row_span(row):
    """The first and last cell of a row, or None where the row is empty."""
    i = np.nonzero(row)[0]
    return None if not len(i) else (int(i.min()), int(i.max()))


class Deck:
    """The hull's walkable decks: the cells they stand on and the height of the surface in each.

    The surfaces come from build_props.py, which owns the definition of what counts as a deck (see DECK_CELL
    there: up-facing hull surface, joined into surfaces while it stays within SURFACE_SPREAD of its own
    lowest point, opened with a DECK_SPAN element so a rail or a ledge goes, and at least DECK_WIDTH wide).
    The heights are measured here from the mesh again, so that a walk box's top is checked against the
    planking under it rather than against the pipeline's own average.
    """

    def __init__(self, hull):
        tri = hull.pos.reshape(-1, 3, 3).astype(np.float64)
        face = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        up = tri[face[:, 1] > 0.95 * np.linalg.norm(face, axis=1)]
        lo, hi = hull.pos.min(0), hull.pos.max(0)
        self.origin = (float(np.floor(lo[0] / DECK_CELL) * DECK_CELL),
                       float(np.floor(lo[2] / DECK_CELL) * DECK_CELL))
        self.shape = (int(np.ceil((hi[2] - self.origin[1]) / DECK_CELL)) + 1,
                      int(np.ceil((hi[0] - self.origin[0]) / DECK_CELL)) + 1)
        self.heights = {}
        for j, i, k in bp.cells_under(up[:, :, [0, 2]], self.shape, self.origin):
            self.heights.setdefault((j, i), []).append(float(up[k][:, 1].mean()))
        self.surfaces = []
        self.mask = np.zeros(self.shape, bool)
        for s in bp.deck_surfaces(up, self.shape, self.origin):
            # a row's stretch of deck narrower than DECK_WIDTH is not floor: the hull carries 0.2 m to 0.5 m
            # wide ledges (the forecastle's side walkways, the cap rails) that a 0.6 m wide player cannot stand
            # on, and the walk boxes are not held to those
            deck = np.zeros(self.shape, bool)
            for j in range(self.shape[0]):
                for a, b in bp.row_segments(s["mask"][j]):
                    if (b - a + 1) * DECK_CELL >= DECK_WIDTH:
                        deck[j, a:b + 1] = True
            rows, cols = np.nonzero(deck)
            self.surfaces.append({"y": s["y"], "area": float(deck.sum()) * DECK_CELL ** 2,
                                  "z": (float(self.z(rows).min()), float(self.z(rows).max())),
                                  "x": (float(self.x(cols).min()), float(self.x(cols).max()))})
            self.mask |= deck

    def x(self, i):
        return self.origin[0] + (np.asarray(i) + 0.5) * DECK_CELL

    def z(self, j):
        return self.origin[1] + (np.asarray(j) + 0.5) * DECK_CELL

    def edge_at(self, j):
        """The deck's x extent in one row, or None where the row has no deck."""
        span = row_span(self.mask[j])
        return None if span is None else (float(self.x(span[0])), float(self.x(span[1])))

    def cells_in(self, x0, x1, z0, z1):
        rows = [j for j in range(self.shape[0]) if z0 <= self.z(j) <= z1]
        return [(j, i) for j in rows for i in np.nonzero(self.mask[j])[0] if x0 <= self.x(i) <= x1]

    def box_cells(self, box):
        """The cells of a walk box's footprint that are deck, and how many cells the whole footprint is.
        The deck mask is grown by a cell first: a walk box reaches a cell past the deck it was measured from,
        so that two decks whose masks do not quite meet still meet."""
        rows = [j for j in range(self.shape[0]) if box["z"][0] <= self.z(j) <= box["z"][1]]
        cols = [i for i in range(self.shape[1]) if box["x"][0] <= self.x(i) <= box["x"][1]]
        if not rows or not cols:
            return [], 0
        near = bp.grow(self.mask)
        return [(rows[a], cols[b]) for a, b in zip(*np.nonzero(near[np.ix_(rows, cols)]))], len(rows) * len(cols)

    def floored(self, walk, j, i):
        """Whether some walk box over this cell has its top at the height of one of the surfaces here."""
        tops = floor_at(walk, float(self.x(i)), float(self.z(j)))
        return any(abs(t - h) <= FLOOR_TOL for t in tops for h in self.heights[(j, i)])

    def high_at(self, j, i):
        """The highest up-facing surface in a cell, m."""
        return max(self.heights[(j, i)])


def floor_at(walk, x, z):
    """The tops of the walk boxes over (x, z), lowest first."""
    return sorted(w["y"] for w in walk if w["x"][0] - 1e-6 <= x <= w["x"][1] + 1e-6
                  and w["z"][0] - 1e-6 <= z <= w["z"][1] + 1e-6)


def rail_at(blockers, z, edge, sign):
    """The blocker standing on one side of a deck edge at z, if any is close enough to be that deck's rail.
    sign is -1 to port (outboard of the edge means more negative x) and +1 to starboard."""
    want = sign * edge
    near = []
    for b in blockers:
        if b.get("kind") == "step" or sign * b["x"][0] < want - BLOCK_REACH:
            continue
        inner = sign * (b["x"][0] if sign > 0 else b["x"][1])
        if -BLOCK_TOL <= inner - want <= BLOCK_REACH and b["z"][0] - DECK_CELL <= z <= b["z"][1] + DECK_CELL:
            near.append((abs(inner - want), b))
    return min(near, key=lambda n: n[0], default=(None, None))[1]


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "dutch_ship_medium"
    manifest = json.loads(Path(sys.argv[2] if len(sys.argv) > 2 else MANIFEST).read_text())
    entry = manifest["props"][name]
    spec = bp.PROPS[name]
    walk, blockers = entry.get("walk", []), entry.get("blockers", [])
    print(f"== {name}: {len(walk)} walk boxes, {len(blockers)} blockers, "
          f"main deck {entry.get('mainDeckHeight')}, deck levels {entry.get('deckLevels')}")

    gltf = bp.fetch.fetch_gltf(spec["asset"], spec["res"])
    mats = bp.Mats()
    for key in ("rigging", "hull", "sails"):
        mats.id(f"{spec['asset']}_{key}")
    deck = Deck(bp.ship_hull(gltf, spec, mats))
    print(f"   hull: {deck.mask.sum() * DECK_CELL ** 2:.1f} m2 of deck in {len(deck.surfaces)} surfaces")
    for s in sorted(deck.surfaces, key=lambda s: -s["area"]):
        print(f"     y {s['y']:5.2f}  z {s['z'][0]:6.2f}..{s['z'][1]:6.2f}  x {s['x'][0]:5.2f}..{s['x'][1]:5.2f}"
              f"  {s['area']:6.2f} m2")

    failures = []

    # 1. Every deck cell has floor under it. Cells with no floor only fail where three or more of them sit
    #    side by side, which is the ISSUES.md rule (any deck area more than about 0.3 m across with no walk
    #    box), so a single cell of raster noise does not.
    bare = np.array([[not deck.floored(walk, j, i) if deck.mask[j, i] else False
                      for i in range(deck.shape[1])] for j in range(deck.shape[0])])
    wide = opening(bare, 1)
    print(f"\n1. floor under every deck: {(deck.mask & ~bare).sum() * DECK_CELL ** 2:.1f} m2 floored, "
          f"{bare.sum() * DECK_CELL ** 2:.2f} m2 not, of which {wide.sum() * DECK_CELL ** 2:.2f} m2 is more "
          f"than {DECK_SPAN:.1f} m across")
    if wide.any():
        failures.append("deck without floor")
        lab, count = label(wide)
        for part in sorted(range(count), key=lambda k: -int((lab == k).sum()))[:4]:
            rows, cols = np.nonzero(lab == part)
            print(f"   FAIL: {len(rows) * DECK_CELL ** 2:.2f} m2 of deck with no floor at x "
                  f"{deck.x(cols).min():.2f}..{deck.x(cols).max():.2f} z {deck.z(rows).min():.2f}.."
                  f"{deck.z(rows).max():.2f}, under planking at y "
                  f"{sorted({round(y, 2) for j, i in zip(rows, cols) for y in deck.heights[(j, i)]})}")

    # 2. Every walk box stands on deck: most of its footprint is deck, and its top is at the height of the
    #    deck there. A box that floats is how the phantom deck at z -8.57..-7.93 and the one at z 7.47..8.45
    #    got there: floor inside the hull with no planking over it.
    for w in walk:
        cells, whole = deck.box_cells(w)
        if not cells:
            failures.append("walk box off deck")
            print(f"   FAIL: walk box y {w['y']} z {w['z']} x {w['x']} is not on deck at all")
            continue
        ys = [y for j, i in cells for y in deck.heights.get((j, i), [])]
        off = 1 - len(cells) / whole
        if off > 1 - BOX_FOOT or not any(abs(w["y"] - y) <= FLOOR_TOL for y in ys):
            failures.append("walk box off deck")
            print(f"   FAIL: walk box y {w['y']} z {w['z']} x {w['x']}: the deck there is y "
                  f"{sorted({round(y, 2) for y in ys})}, and {off * 100:.0f}% of its footprint is not deck")

    # 3. No rail blocker stands inside a deck: walking to the side across a deck must reach the rail, not an
    #    invisible wall short of it.
    inner = []
    for b in blockers:
        if b.get("kind"):
            continue    # a step or an end rail crosses the deck on purpose; only the side rails are checked
        for z in np.arange(b["z"][0] + DECK_CELL / 2, b["z"][1], DECK_CELL):
            edge = deck.edge_at(int(np.floor((z - deck.origin[1]) / DECK_CELL)))
            if edge is None:
                continue
            for sign, at in ((-1, edge[0]), (1, edge[1])):
                face = b["x"][1] if sign < 0 else b["x"][0]
                if sign * face > 0 and sign * face < sign * at - BLOCK_TOL and abs(face) < abs(at) + BLOCK_REACH:
                    inner.append((b, float(z), at))
    print(f"\n3. rail blockers inside a deck: {len(inner)} blocker/row pairs")
    for z0, z1 in P2_FALSE_RAIL:
        band = [b for b in blockers if b.get("kind") != "step" and b["x"][1] > 0.5
                and b["z"][0] < z1 and b["z"][1] > z0]
        face = min((b["x"][0] for b in band), default=None)
        print(f"   starboard rail over z {z0}..{z1}: {len(band)} blockers, innermost face at x "
              f"{'none' if face is None else f'{face:.2f}'} (the waist rail is at x 2.6)")
        if face is not None and face < 1.5:
            failures.append(f"inner rail over z {z0}..{z1}")
    if inner:
        failures.append("rail blocker inside a deck")
        b, z, at = inner[0]
        print(f"   FAIL: a blocker stands inside the deck, e.g. at z {z:.2f} the deck reaches x {at:.2f} but a "
              f"blocker starts at x {b['x'][0]:.2f} (z {b['z']}, x {b['x']})")

    # 4. The ISSUES.md P2 list, item by item.
    print("\n4. ISSUES.md P2")
    for item, z0, z1 in P2_HOLES + P2_HELD:
        held = any(item == other for other, _, _ in P2_HELD)
        cells = deck.cells_in(-9.0, 9.0, z0, z1)
        bare = np.array([[not deck.floored(walk, j, i) if deck.mask[j, i] else False
                          for i in range(deck.shape[1])] for j in range(deck.shape[0])])
        band = np.array([[bare[j, i] and z0 <= deck.z(j) <= z1 for i in range(deck.shape[1])]
                         for j in range(deck.shape[0])])
        wide = int(opening(band, 1).sum())
        tops = sorted({round(t, 2) for c in cells for t in floor_at(walk, float(deck.x(c[1])), float(deck.z(c[0])))})
        note = " (the model has no deck here)" if not cells else ""
        state = "HELD  " if held and not wide else "hole  " if not held and not wide else "FAIL  "
        print(f"   {state} {item}: {len(cells)} deck cells, {int(band.sum())} without floor "
              f"({wide * DECK_CELL ** 2:.2f} m2 of it more than {DECK_SPAN:.1f} m across), floor at y "
              f"{tops}{note}")
        if wide:
            failures.append(item)

    # The bow must be closed: past the head, deck must not run on into open air.
    open_bow = []
    for j, i in zip(*np.nonzero(deck.mask)):
        z, x = float(deck.z(j)), float(deck.x(i))
        if z < 7.0:
            continue
        ahead = [(jj, ii) for jj in range(j + 1, deck.shape[0]) for ii in np.nonzero(deck.mask[jj])[0]
                 if abs(float(deck.x(ii)) - x) < 0.4]
        for jj, _ in ahead:
            wall = [b for b in blockers if b["x"][0] - 0.2 <= x <= b["x"][1] + 0.2
                    and b["z"][0] < float(deck.z(jj)) + DECK_CELL and b["z"][1] > z]
            if any(b["y"][1] > deck.high_at(j, i) + 0.6 for b in wall):
                break
        else:
            if ahead:
                open_bow.append((x, z))
    print(f"   bow closed: {len(open_bow)} deck cells past z 7.0 with no blocker ahead"
          + (f", e.g. x {open_bow[0][0]:.2f} z {open_bow[0][1]:.2f}" if open_bow else ""))
    if open_bow:
        failures.append("open bow")

    # 5. The waist rail, which src/engine/boat.ts opens as the gangway while docked: it has to be continuous
    #    along both sides of the waist, or opening the gangway leaves a hole beside it.
    gaps = []
    for sign in (-1, 1):
        z = WAIST_Z[0]
        while z < WAIST_Z[1]:
            edge = deck.edge_at(int(np.floor((z - deck.origin[1]) / DECK_CELL)))
            if edge is not None and rail_at(blockers, z, edge[1 if sign > 0 else 0], sign) is None:
                gaps.append((sign, round(z, 2), edge))
            z += DECK_CELL
    print(f"\n5. waist rail: {len(gaps)} of {int((WAIST_Z[1] - WAIST_Z[0]) / DECK_CELL) * 2} side steps along "
          f"z {WAIST_Z[0]}..{WAIST_Z[1]} have no rail blocker (the gangway is opened there while docked, so the "
          f"game removes the rail itself)")
    if gaps:
        failures.append("missing waist rail")
        print(f"   FAIL: e.g. {'port' if gaps[0][0] < 0 else 'starboard'} z {gaps[0][1]}, deck edge x "
              f"{gaps[0][2][0 if gaps[0][0] < 0 else 1]:.2f}")

    print(f"\n{'FAILED: ' + ', '.join(sorted(set(failures))) if failures else 'all checks passed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
