"""Author registered 1 m close ground and matching collision for a small area.

Usage: python3 tools/build_ground_close.py --area 0,0,125
Only 250 m leaves are upgraded: LOD0 is ~1 m, LOD1 ~2 m; existing distant
meshes remain registered products of the same source. The outer row is tied to
the existing 2 m field so neighbouring tiles and collision meet without gaps.
This is an asset-authoring command, not a player quality setting.
"""
import argparse
import json
import tempfile
from pathlib import Path

import numpy as np

from build_ground import LEVELS, SKIRT_MARGIN, compress
from ground_glb import write_glb
from ground_mesh import build_level, edge_error, pin_bounds, tile_heights
from ground_quadtree import adjacent
from heightfield import height, height1m

ROOT = Path(__file__).resolve().parent.parent
PACK = ROOT / "public/packs/crater-lake/ground"
QUADS = 256


def close_heights(info):
    x, z, size = info["x"], info["z"], info["size"]
    step, pad = size / QUADS, 2 ** (LEVELS - 1)
    axis = (np.arange(QUADS + 1 + 2 * pad) - pad) * step
    X, Z = np.meshgrid(x + axis, z + axis)
    base = height(X, Z)
    # Keep adjacent legacy fields coincident at the boundary. The transition
    # occupies one old grid cell; the interior uses the original 1 m samples.
    edge = np.minimum.reduce([X - x, x + size - X, Z - z, z + size - Z])
    weight = np.clip(edge / (size / 128), 0, 1)
    fine = height1m(X, Z)
    return step, pad, base + (fine - base) * weight


def build(area):
    path = PACK / "ground.json"
    manifest = json.loads(path.read_text())
    leaves = manifest["leaves"]
    ax, az, radius = area
    chosen = [i for i, l in enumerate(leaves) if l["size"] == 250 and
              np.hypot(max(l["x"] - ax, 0, ax - l["x"] - l["size"]),
                       max(l["z"] - az, 0, az - l["z"] - l["size"])) < radius]
    neighbours = adjacent([(l["x"], l["z"], l["size"]) for l in leaves])
    errors = {}

    def old_error(i):
        if i not in errors:
            l = leaves[i]
            n, pad, hp = tile_heights(l["x"], l["z"], l["size"], l["size"] / 128, LEVELS)
            errors[i] = edge_error(l["x"], l["z"], l["size"], hp[pad:pad+n+1, pad:pad+n+1],
                                   [2 ** k for k in range(LEVELS)])
        return errors[i]

    with tempfile.TemporaryDirectory(prefix="sojourney-close-ground-") as tmp:
        for i in chosen:
            info = leaves[i]
            step, pad, hp = close_heights(info)
            h = hp[pad:pad+QUADS+1, pad:pad+QUADS+1]
            depth = old_error(i) + max(old_error(j) for j in neighbours[i] | {i}) + SKIRT_MARGIN
            levels, pin = [], None
            for k in range(2):
                p, n, uv, indices = build_level(info["x"], info["z"], step, QUADS, pad, hp, k, depth, pin)
                if k == 0:
                    pin = pin_bounds(p)
                levels.append({"name": f"leaf_{i}_LOD{k}", "positions": p, "normals": n,
                               "uvs": uv, "indices": indices})
            raw = Path(tmp) / f"near_{i}.glb"
            write_glb(raw, levels)
            compress(raw, PACK / "near" / f"{i}.glb")
            low, high = float(h.min()), float(h.max())
            scale = max(high - low, 1e-3) / 65535
            packed = np.round((h[::-1] - low) / scale).astype("<u2")
            packed.tofile(PACK / "collision" / f"{i}.bin")
            # Check the actual binary ABI and quantization, not just metadata.
            decoded = np.fromfile(PACK / "collision" / f"{i}.bin", dtype="<u2").reshape(h.shape)
            assert np.max(np.abs((low + decoded * scale) - h[::-1])) <= scale / 2 + 1e-6
            info.update(heightMin=low, heightScale=scale, collisionSamples=QUADS + 1)
            sphere = np.sqrt(2 * info["size"] ** 2 + (high - low + depth) ** 2) / 2
            info["lodDistances"][:2] = [round(sphere + 50 * step * 2, 1),
                                         round(sphere + 50 * step * 4, 1)]
            print(f"Leaf {i}: close {step:.4f} m, middle {step*2:.4f} m, collision {QUADS+1} square")
    path.write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    return chosen


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--area", required=True, help="X,Z,RADIUS in world metres")
    args = parser.parse_args()
    build(tuple(map(float, args.area.split(","))))
