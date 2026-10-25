"""Reports how far each placed rock patch stands off the lidar ground.

A patch is a flat slab of small rocks: rock_patch_0 is 11.5 m across and 0.8 m high as modelled, and
build_forest.py used to place it by one point, so on curved ground its far end hangs in the air (ISSUES.md
P3). This walks every patch record in the pack, puts the four corners of the model's own footprint
through the record's scale, yaw and tilt with the same arithmetic the engine uses (writeMatrix in
src/engine/flora.ts, plus the glTF loader's half turn about Y and z flip, which together mirror x), and
measures each corner's top against tools/heightfield.py.

Usage: uv run --quiet --with numpy python tools/check_rock_patches.py [--pack DIR] [--worst N]
"""
import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import heightfield as terrain  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PACK = ROOT / "public" / "packs" / "crater-lake"
# The species that are flat slabs rather than single rocks: these are the ones whose far end can hang.
PATCHES = ("rock_patch_0", "pumice_patch_0")
RECORD = np.dtype([("y", "<f4"), ("x", "<u2"), ("z", "<u2"), ("scale", "<u2"), ("yaw", "u1"), ("species", "u1"),
                   ("tiltX", "i1"), ("tiltZ", "i1")])
SCALE_UNIT = 0.001


def glb_bounds(path):
    """The min and max of LOD0's positions over every primitive: the model's own footprint and height."""
    data = Path(path).read_bytes()
    js_len, _ = struct.unpack("<II", data[12:20])
    g = json.loads(data[20:20 + js_len])
    lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
    for node in g["nodes"]:
        if not node["name"].endswith("LOD0"):
            continue
        for prim in g["meshes"][node["mesh"]]["primitives"]:
            a = g["accessors"][prim["attributes"]["POSITION"]]
            lo = np.minimum(lo, a["min"])
            hi = np.maximum(hi, a["max"])
    return lo, hi


def world_matrix(scale, yaw, tilt_x, tilt_z):
    """writeMatrix from src/engine/flora.ts: the record's world matrix as sixteen numbers, row by row."""
    up = np.sqrt(max(0.0, 1 - tilt_x * tilt_x - tilt_z * tilt_z))
    norm = np.sqrt(tilt_z * tilt_z + tilt_x * tilt_x + (up + 1) ** 2)   # Math.hypot of three
    ax, az, aw = tilt_z / norm, -tilt_x / norm, (up + 1) / norm
    by, bw = np.sin(yaw / 2), np.cos(yaw / 2)
    x, y, z, w = aw * 0 + ax * bw - az * by, aw * by, az * bw + ax * by, aw * bw
    x2, y2, z2 = x + x, y + y, z + z
    xx, xy, xz = x * x2, x * y2, x * z2
    yy, yz, zz = y * y2, y * z2, z * z2
    wx, wy, wz = w * x2, w * y2, w * z2
    row = lambda a, b, c, d: (a, b, c, d)  # noqa: E731
    m = np.array([
        row((1 - (yy + zz)) * scale, (xy + wz) * scale, (xz - wy) * scale, 0.0),
        row((xy - wz) * scale, (1 - (xx + zz)) * scale, (yz + wx) * scale, 0.0),
        row((xz + wy) * scale, (yz - wx) * scale, (1 - (xx + yy)) * scale, 0.0),
        row(0.0, 0.0, 0.0, 1.0),
    ])
    return m


def place(local, scale, yaw, tilt_x, tilt_z, at):
    """The model-space points where they end up in the world, as the engine would draw them."""
    # The glTF loader's root transform (a half turn about Y and a z flip) leaves an x mirror, and
    # world_matrix above holds the rotation's transpose (its rows are the rotation's columns, as in
    # flora.ts where each column is written in turn), so row vectors take the mirror then the matrix.
    mirrored = local * np.array([-1.0, 1.0, 1.0])
    m = world_matrix(scale, yaw, tilt_x, tilt_z)
    out = mirrored @ m[:3, :3] + at
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pack", default=str(PACK))
    ap.add_argument("--worst", type=int, default=10, help="how many of the worst to list")
    args = ap.parse_args()
    pack = Path(args.pack)
    forest = json.loads((pack / "flora" / "forest.json").read_text())
    species = forest["species"]
    ids = [i for i, s in enumerate(species) if s["id"] in PATCHES]
    bounds = {i: glb_bounds(pack / "flora" / Path(species[i]["modelUrl"]).name) for i in ids}
    leaves = json.loads((pack / "ground" / "ground.json").read_text())["leaves"]
    rows = []
    for n, (count, _mid) in enumerate(forest["leaves"]):
        if not count:
            continue
        # build_forest.py names each leaf's file after the leaf's own index in ground.json's leaf list
        path = pack / "flora" / "leaves" / f"{n}.bin"
        if not path.exists():
            continue
        a = np.fromfile(path, dtype=RECORD)
        keep = np.isin(a["species"], ids)
        if not keep.any():
            continue
        leaf = leaves[n]
        for rec in a[keep]:
            i = int(rec["species"])
            lo, hi = bounds[i]
            local = np.array([[lo[0], lo[1], lo[2]], [hi[0], lo[1], lo[2]], [hi[0], lo[1], hi[2]], [lo[0], lo[1], hi[2]]])
            at = np.array([leaf["x"] + rec["x"] / 65536 * leaf["size"], rec["y"],
                           leaf["z"] + rec["z"] / 65536 * leaf["size"]])
            scale = rec["scale"] * SCALE_UNIT
            world = place(local, scale, rec["yaw"] / 256 * 2 * np.pi, rec["tiltX"] / 127, rec["tiltZ"] / 127, at)
            ground = terrain.height(world[:, 0], world[:, 2])
            # The slab's own base is what has to sit on the ground: a corner above it hangs in the air, a
            # corner below it is buried, which is what the entry's sink asks for.
            stand = world[:, 1] - ground
            rows.append((float(stand.max()), float(stand.mean()), species[i]["id"],
                         float(at[0]), float(at[1]), float(at[2]), float(scale),
                         int(rec["tiltX"]), int(rec["tiltZ"])))
    if not rows:
        print("no patch records found")
        return
    rows.sort(reverse=True)
    off = np.array([r[0] for r in rows])
    print(f"{len(rows)} patch records")
    print(f"  highest corner above the ground: max {off.max():.2f} m, p99 {np.percentile(off, 99):.2f} m, "
          f"p90 {np.percentile(off, 90):.2f} m, median {np.median(off):.2f} m")
    for limit in (0.1, 0.25, 0.5, 1.0, 2.0):
        print(f"  a corner more than {limit:.2f} m up: {int((off > limit).sum())} "
              f"({100 * (off > limit).mean():.1f}%)")
    print(f"  {'up':>6s} {'mean':>6s}  species            x        y       z     scale tiltX tiltZ")
    for r in rows[:args.worst]:
        print(f"  {r[0]:6.2f} {r[1]:6.2f}  {r[2]:16s} {r[3]:8.1f} {r[4]:7.1f} {r[5]:7.1f} {r[6]:6.2f} "
              f"{r[7]:5d} {r[8]:5d}")


if __name__ == "__main__":
    main()