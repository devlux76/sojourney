"""Build the Crater Lake ground pack into public/packs/crater-lake/ground/.

Usage: python3 tools/build_ground.py            everything
        python3 tools/build_ground.py --meshes   only the leaf, block and collision files; the water, lake
                                                 mask, splatmap and textures already in the pack are kept
        python3 tools/build_ground.py --bed      only the lake-bed texture arrays and material.lakeBed
                                                 in the manifest; everything else is kept
        python3 tools/build_ground.py --basalt   only the POI basalt mask and material.basaltUrl
        python3 tools/build_ground.py --textures only the land textures and material.rock
        python3 tools/build_ground.py --proxy    only the ground the lake's mirror draws
"""
import json
import shutil
import subprocess
import sys
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ground_glb import write_glb
from ground_mesh import _grid_indices, build_level, edge_error, pin_bounds, tile_heights
from ground_quadtree import QUADS, adjacent, build_leaves
from ground_splat import build_basalt_mask, build_splatmap
from heightfield import SIZE_METRES, all_lake_cells, height, lake_cells

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public/packs/crater-lake/ground"
SOURCES = ROOT / "assets/crater-lake/ground"
CACHE = ROOT / "tools/.cache"
STAGE = CACHE / "ground_stage"
URL_PREFIX = "packs/crater-lake/ground/"
LOD_RATIO = 50
PROXY_STEP = 60
PROXY_SHORE_STEP = 10

# Per leaf: 128, 64, 32, 16, 8 quads. Levels 0 and 1 are written per leaf ("near"), the rest into FAR_FILES shared files.
LEVELS = 5
NEAR_LEVELS = 2
# Quadtree error budget in metres (see ground_quadtree.py): about 1300 leaves, with 250 m leaves on the island, walls, rim and shore.
BUDGET = 0.3
# Skirt depth = own edge error + largest neighbour edge error + this margin.
SKIRT_MARGIN = 0.5
FAR_FILES = 4
# Far away, every leaf is one draw call for a handful of triangles, and the engine pays for each call.
# So the leaves of each BLOCK_METRES square are also written joined into one mesh, at each of the
# BLOCK_LEVELS: the same triangles, skirts included, as the leaves at that level. The engine draws a block
# in place of its leaves once every leaf in it has reached that level. A block of one leaf saves nothing
# and is not written.
BLOCK_METRES = 1000.0
BLOCK_LEVELS = (3, 4)
# 24 m cells = 12 source samples: a lake cell is set when any sample in it is lake, so the mask covers the shore.
LAKE_CELL_METRES = 24.0
WATER_CELL_METRES = 100.0
COMPRESS_JOBS = 8

LAYERS = [
    {"name": "gravel", "asset": "coast_sand_03", "tileMetres": 3, "tint": 0.9, "size": "2k"},
    {"name": "needles", "asset": "forrest_ground_03", "tileMetres": 3, "tint": 0.75, "size": "2k"},
    {"name": "soil", "asset": "brown_mud_rocks_01", "tileMetres": 1.3, "tint": 0.75, "size": "1k"},
]
# The lake bed's five depth bands, in texture-array layer order (the bed shader in
# src/engine/TerrainMaterial.ts blends them by water depth): bright shore sand kept from the old
# single-texture bed, moss for the 26 to 140 m slopes, fine sediment for the dim plain, dark
# basalt for the deep basins, and rust-gold bacterial mats in patches over the basalt.
# Every layer ships at the same 1k size, which a texture array needs: below about 150 m the bed
# is black without the flashlight, so the deep layers are only ever seen in its pool a few metres
# wide, where 1k over a small tile is plenty. The layers share pixels, not scale: each keeps its
# own tile metres, applied when the shader samples its layer.
BED_LAYERS = [
    {"name": "sand", "asset": "aerial_beach_01", "tileMetres": 12},
    {"name": "moss", "asset": "forest_leaves_02", "tileMetres": 8},
    {"name": "sediment", "asset": "brown_mud", "tileMetres": 8},
    {"name": "basalt", "asset": "dark_rock_02", "tileMetres": 10},
    {"name": "mats", "asset": "red_dirt_mud_01", "tileMetres": 7},
]
BED_SIZE = "1k"
BED_PX = 1024
# The steep-ground base: dark fractured basalt, so the caldera crags, the dikes and the
# islands read as volcanic rock and the pale gravel lies on top of it as scree and shore.
# (Was the Babylon asset library's pale rockyGround; ISSUES.md POI pass, option A inverted.)
ROCK = {"asset": "dark_rock_02", "tileMetres": 8.0, "size": "2k"}
OLD_ROCK = ROOT / "assets/crater-lake/models/rocks"
VIEWPOINT = (0.0, 27.0, 530.0)


def compress(src, dst):
    subprocess.run(["bun", "x", "@gltf-transform/cli@4", "meshopt", str(src), str(dst),
                    "--level", "medium", "--quantize-position", "16", "--quantize-normal", "14", "--quantize-texcoord", "16"],
                   cwd=CACHE, check=True, stdout=subprocess.DEVNULL)


def build_water(path):
    cell = WATER_CELL_METRES
    lake = lake_cells(cell)
    count = len(lake)
    origin = -SIZE_METRES / 2
    padded = np.pad(lake, 1)
    wet = np.zeros_like(lake)
    for dz in range(3):
        for dx in range(3):
            wet |= padded[dz:dz + count, dx:dx + count]
    verts = np.full((count + 1, count + 1), -1, dtype=np.int64)
    for dz in range(2):
        for dx in range(2):
            verts[dz:dz + count, dx:dx + count][wet] = 0
    mask = verts == 0
    verts[mask] = np.arange(mask.sum())
    xs = origin + np.arange(count + 1) * cell
    X, Z = np.meshgrid(xs, xs)
    x, z = X[mask], Z[mask]
    positions = np.stack([-x, np.zeros_like(x), z], -1)
    normals = np.tile([0.0, 1.0, 0.0], (len(x), 1))
    uvs = np.stack([x / SIZE_METRES + 0.5, z / SIZE_METRES + 0.5], -1)
    iz, ix = np.nonzero(wet)
    a, b, c, d = verts[iz, ix], verts[iz + 1, ix], verts[iz, ix + 1], verts[iz + 1, ix + 1]
    indices = np.concatenate([np.stack([a, c, b], 1), np.stack([b, c, d], 1)])
    write_glb(path, [{"name": "water", "positions": positions, "normals": normals, "uvs": uvs, "indices": indices}])
    return int(wet.sum())


# The ground as the lake's mirror draws it: PROXY_STEP cells, except the cells the shoreline passes
# through, which are PROXY_SHORE_STEP. On a shallow shore a coarse cell joins a vertex on the beach to
# one on the bed in a straight line, which lies metres above the water where the real bed is under it,
# and the lake reflected that slab as a straight-edged patch along the shore.
def build_reflection_proxy(path):
    origin = -SIZE_METRES / 2
    n0, pad, hp = tile_heights(origin, origin, SIZE_METRES, PROXY_STEP, 1)
    positions, normals, _, indices = build_level(origin, origin, PROXY_STEP, n0, pad, hp, 0, 0.0)
    shore = lake_cells(PROXY_STEP) & ~all_lake_cells(PROXY_STEP)
    # build_level lists each cell's two triangles at the same place in the two halves of the grid's
    # triangles, cells in row order, and the skirt after them.
    keep = np.concatenate([np.tile(~shore.ravel(), 2), np.ones(len(indices) - 2 * n0 * n0, dtype=bool)])
    indices = indices[keep]
    fine = PROXY_STEP // PROXY_SHORE_STEP
    t = np.linspace(0, 1, fine + 1)
    patch = _grid_indices(fine)
    for j, i in zip(*np.nonzero(shore)):
        x = origin + i * PROXY_STEP + t * PROXY_STEP
        z = origin + j * PROXY_STEP + t * PROXY_STEP
        X, Z = np.meshgrid(x, z)
        h = height(X, Z)
        # An edge shared with a coarse cell is drawn as that cell draws it, a straight line between the
        # two corners, so no crack opens between them.
        for dj, di, edge in ((-1, 0, np.s_[0, :]), (1, 0, np.s_[-1, :]), (0, -1, np.s_[:, 0]), (0, 1, np.s_[:, -1])):
            nj, ni = j + dj, i + di
            if not (0 <= nj < n0 and 0 <= ni < n0 and shore[nj, ni]):
                h[edge] = h[edge][0] + (h[edge][-1] - h[edge][0]) * t
        d = PROXY_SHORE_STEP
        normal = np.stack([-(height(X + d, Z) - height(X - d, Z)) / (2 * d), np.ones_like(h),
                           -(height(X, Z + d) - height(X, Z - d)) / (2 * d)], -1)
        normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
        indices = np.concatenate([indices, patch + len(positions)])
        # x is negated as build_level negates it, for the glTF file.
        positions = np.concatenate([positions, np.stack([-X, h, Z], -1).reshape(-1, 3)])
        normals = np.concatenate([normals, (normal * [-1, 1, 1]).reshape(-1, 3)])
    write_glb(path, [{"name": "reflectionProxy", "positions": positions, "normals": normals, "indices": indices}])
    return len(indices), int(shore.sum())


def download(asset, mapname, suffix, size):
    SOURCES.mkdir(parents=True, exist_ok=True)
    dest = SOURCES / f"{asset}_{suffix}_{size}.jpg"
    if dest.exists():
        return dest
    request = urllib.request.Request(f"https://api.polyhaven.com/files/{asset}", headers={"User-Agent": "sojourney-packsmith"})
    files = json.load(urllib.request.urlopen(request))
    url = files[mapname][size]["jpg"]["url"]
    request = urllib.request.Request(url, headers={"User-Agent": "sojourney-packsmith"})
    dest.write_bytes(urllib.request.urlopen(request).read())
    return dest


def stage(src, name, size=None):
    dest = STAGE / f"{name}.png"
    img = Image.open(src).convert("RGB")
    # Texture-array layers must be pixel-identical in size; land layers keep their own.
    if size is not None and img.size != (size, size):
        img = img.resize((size, size), Image.Resampling.LANCZOS)
    img.save(dest)
    return dest


def build_textures():
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    colour, linear, flatten = [], [], []
    for layer in LAYERS:
        a = layer["asset"]
        size = layer["size"]
        albedo = stage(download(a, "Diffuse", "diff", size), f"{layer['name']}_albedo")
        flatten.append(albedo)
        colour.append(albedo)
        linear.append(stage(download(a, "nor_gl", "nor_gl", size), f"{layer['name']}_normal"))
        linear.append(stage(download(a, "AO", "ao", size), f"{layer['name']}_ao"))
    colour.append(stage(download(ROCK["asset"], "Diffuse", "diff", ROCK["size"]), "rock_albedo"))
    linear.append(stage(download(ROCK["asset"], "nor_gl", "nor_gl", ROCK["size"]), "rock_normal"))
    subprocess.run([sys.executable, str(ROOT / "tools/flatten_tiles.py"), *map(str, flatten)], check=True)

    def encode(flag, image):
        subprocess.run([sys.executable, str(ROOT / "tools/encode_ktx2.py"), flag, str(OUT), str(image)], check=True)

    with ThreadPoolExecutor(3) as pool:
        jobs = [pool.submit(encode, "--colour", i) for i in colour] + [pool.submit(encode, "--linear", i) for i in linear]
        for job in jobs:
            job.result()


def encode_bed_array(env, images, out_name, colour):
    # One KTX2 holding every bed layer, so the ground material binds two array textures instead
    # of ten 2D ones (WebGPU guarantees only 16 textures per stage; see ISSUES.md B4). ktx create
    # takes one input per array layer in order with --layers. No --generate-mipmap: Babylon's
    # CreateTexture2DArrayFromKTX2Async uploads only the base level and regenerates the mip chain
    # on the GPU, so shipping mips would only fatten the pack.
    fmt, tf = ("R8G8B8_SRGB", "srgb") if colour else ("R8G8B8_UNORM", "linear")
    out = OUT / out_name
    subprocess.run(["ktx", "create", "--format", fmt, "--assign-tf", tf,
                    "--encode", "uastc", "--uastc-quality", "2",
                    "--zstd", "18", "--layers", str(len(images)),
                    *map(str, images), str(out)], env=env, check=True)
    print(f"bed array -> {out}: {out.stat().st_size / 1e3:.0f} kB ({'sRGB' if colour else 'linear'})")


def build_bed_textures():
    # The bed's five depth bands as two texture arrays (albedo + normals), in BED_LAYERS order.
    # The flip matches tools/encode_ktx2.py's vertical convention, so the sand layer maps the
    # same way the old single-texture bed did.
    from compress_textures import ktx_env
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    albedo, normal = [], []
    for layer in BED_LAYERS:
        a = layer["asset"]
        albedo.append(stage(download(a, "Diffuse", "diff", BED_SIZE), f"bed_{layer['name']}_albedo", BED_PX))
        normal.append(stage(download(a, "nor_gl", "nor_gl", BED_SIZE), f"bed_{layer['name']}_normal", BED_PX))
    for png in albedo + normal:
        Image.open(png).transpose(Image.Transpose.FLIP_TOP_BOTTOM).save(png)
    subprocess.run([sys.executable, str(ROOT / "tools/flatten_tiles.py"), *map(str, albedo + normal)], check=True)
    env = ktx_env()
    encode_bed_array(env, albedo, "lakeBed_albedo_array.ktx2", True)
    encode_bed_array(env, normal, "lakeBed_normal_array.ktx2", False)


def bed_manifest():
    return {
        "albedoArrayUrl": URL_PREFIX + "lakeBed_albedo_array.ktx2",
        "normalArrayUrl": URL_PREFIX + "lakeBed_normal_array.ktx2",
        "layers": [{"name": l["name"], "tileMetres": l["tileMetres"]} for l in BED_LAYERS],
    }


def lod_distances(size, radius):
    step = size / QUADS
    return [LOD_RATIO * step * 2 ** (k + 1) + radius for k in range(LEVELS - 1)]


def compress_all(jobs):
    # One run on its own first: started together with nothing in Bun's cache, the jobs all install the tool
    # at once and fail on each other's half-written files.
    subprocess.run(["bun", "x", "@gltf-transform/cli@4", "--version"], cwd=CACHE, check=True, stdout=subprocess.DEVNULL)
    with ThreadPoolExecutor(COMPRESS_JOBS) as pool:
        for future in [pool.submit(compress, src, dst) for src, dst in jobs]:
            future.result()


# Writes every leaf's meshes and collision. Collision is the level-0 grid as uint16 between heightMin and
# heightMin + 65535 * heightScale, rows from north to south (the order PhysicsShapeHeightField expects).
def build_leaves_pack(leaves, raw, near_dir, collision_dir):
    errors = []
    for x0, z0, size in leaves:
        step = size / QUADS
        n0, pad, hp = tile_heights(x0, z0, size, step, LEVELS)
        h0 = hp[pad:pad + n0 + 1, pad:pad + n0 + 1]
        errors.append(edge_error(x0, z0, size, h0, [2 ** k for k in range(LEVELS)]))
    neighbours = adjacent(leaves)
    far = [[] for _ in range(FAR_FILES)]
    near_jobs = []
    records = []
    per_level = [0] * LEVELS
    depths = []
    blocks = {}
    for n, (x0, z0, size) in enumerate(leaves):
        step = size / QUADS
        n0, pad, hp = tile_heights(x0, z0, size, step, LEVELS)
        h0 = hp[pad:pad + n0 + 1, pad:pad + n0 + 1]
        depth = errors[n] + max(errors[j] for j in neighbours[n] | {n}) + SKIRT_MARGIN
        depths.append(depth)
        pin = None
        levels = []
        for k in range(LEVELS):
            p, nrm, uv, idx = build_level(x0, z0, step, n0, pad, hp, k, depth, pin)
            if k == 0:
                pin = pin_bounds(p)
                p, nrm, uv, idx = build_level(x0, z0, step, n0, pad, hp, k, depth, pin)
                lo, hi = p.min(axis=0), p.max(axis=0)
            levels.append({"name": f"leaf_{n}_LOD{k}", "positions": p, "normals": nrm, "uvs": uv, "indices": idx})
            per_level[k] += len(idx)
        radius = float(np.linalg.norm(hi - lo) / 2)
        near = near_dir / f"{n}.glb"
        write_glb(raw / f"near_{n}.glb", levels[:NEAR_LEVELS])
        near_jobs.append((raw / f"near_{n}.glb", near))
        far[n * FAR_FILES // len(leaves)].extend(levels[NEAR_LEVELS:])
        block = blocks.setdefault((int((x0 + SIZE_METRES / 2) // BLOCK_METRES), int((z0 + SIZE_METRES / 2) // BLOCK_METRES)),
                                  {"leaves": [], "levels": {k: [] for k in BLOCK_LEVELS}})
        block["leaves"].append(n)
        for k in BLOCK_LEVELS:
            block["levels"][k].append(levels[k])
        low = float(h0.min())
        scale = max(float(h0.max()) - low, 1e-3) / 65535
        quantised = np.round((h0[::-1] - low) / scale).astype("<u2")
        quantised.tofile(collision_dir / f"{n}.bin")
        records.append({"x": x0, "z": z0, "size": size, "lodDistances": [round(d, 1) for d in lod_distances(size, radius)],
                        "heightMin": low, "heightScale": scale,
                        "centre": [round(float(-(lo[0] + hi[0]) / 2), 1), round(float((lo[1] + hi[1]) / 2), 1), round(float((lo[2] + hi[2]) / 2), 1)]})
    far_jobs = []
    for c, meshes in enumerate(far):
        write_glb(raw / f"far_{c}.glb", meshes)
        far_jobs.append((raw / f"far_{c}.glb", OUT / f"far_{c}.glb"))
    block_records, block_meshes = [], []
    for block in (b for _, b in sorted(blocks.items()) if len(b["leaves"]) > 1):
        for k in BLOCK_LEVELS:
            parts, start, indices = block["levels"][k], 0, []
            for part in parts:
                indices.append(part["indices"] + start)
                start += len(part["positions"])
            block_meshes.append({"name": f"block_{len(block_records)}_LOD{k}",
                                 "positions": np.concatenate([p["positions"] for p in parts]),
                                 "normals": np.concatenate([p["normals"] for p in parts]),
                                 "uvs": np.concatenate([p["uvs"] for p in parts]),
                                 "indices": np.concatenate(indices)})
        block_records.append({"leaves": block["leaves"]})
    write_glb(raw / "blocks.glb", block_meshes)
    far_jobs.append((raw / "blocks.glb", OUT / "blocks.glb"))
    return records, block_records, near_jobs, far_jobs, per_level, errors, depths


def estimate_drawn(records):
    cam = np.array(VIEWPOINT)
    total = [0] * LEVELS
    for r in records:
        d = float(np.linalg.norm(np.array(r["centre"]) - cam))
        k = sum(1 for dist in r["lodDistances"] if d > dist)
        n = QUADS // 2 ** k
        total[k] += 2 * n * n + 8 * n
    return total


def build_proxy():
    proxy, shore = build_reflection_proxy(CACHE / "reflection_proxy.glb")
    compress(CACHE / "reflection_proxy.glb", OUT / "reflection_proxy.glb")
    print(f"reflection proxy: {proxy} triangles at {PROXY_STEP} m, {shore} shore cells at {PROXY_SHORE_STEP} m")


def main():
    started = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    if "--proxy" in sys.argv:
        build_proxy()
        return
    if "--bed" in sys.argv:
        # Only the lake-bed texture arrays and the manifest's material.lakeBed: the meshes,
        # splatmap and land textures already in the pack are kept.
        build_bed_textures()
        manifest = json.loads((OUT / "ground.json").read_text())
        manifest["format"] = 4
        manifest["material"]["lakeBed"] = bed_manifest()
        (OUT / "ground.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
        for stale in ("lakeBed_albedo.ktx2", "lakeBed_normal.ktx2"):
            (OUT / stale).unlink(missing_ok=True)
        print(f"bed only, done in {time.time() - started:.0f} s")
        return
    if "--basalt" in sys.argv:
        # Only the POI basalt mask and the manifest's material.basaltUrl: everything else kept.
        mean = build_basalt_mask(CACHE / "basalt.png")
        subprocess.run([sys.executable, str(ROOT / "tools/encode_ktx2.py"), "--linear",
                        str(OUT), str(CACHE / "basalt.png")], check=True)
        manifest = json.loads((OUT / "ground.json").read_text())
        manifest["format"] = 4
        manifest["material"]["basaltUrl"] = URL_PREFIX + "basalt.ktx2"
        (OUT / "ground.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
        print(f"basalt mask only, mean {mean:.4f}, done in {time.time() - started:.0f} s")
        return
    if "--textures" in sys.argv:
        # Only the land textures (the steep-ground rock is dark basalt now) and the manifest's
        # rock tile: meshes, splatmap and bed arrays already in the pack are kept.
        build_textures()
        manifest = json.loads((OUT / "ground.json").read_text())
        manifest["format"] = 4
        manifest["material"]["rock"]["tileMetres"] = ROCK["tileMetres"]
        (OUT / "ground.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
        print(f"textures only, done in {time.time() - started:.0f} s")
        return
    if "--splat" in sys.argv:
        # Only the splat map (which slopes wear deposits and which stand as bare rock):
        # meshes and textures already in the pack are kept.
        mean = build_splatmap(CACHE / "splatmap.png")
        subprocess.run([sys.executable, str(ROOT / "tools/encode_ktx2.py"), "--linear",
                        str(OUT), str(CACHE / "splatmap.png")], check=True)
        print("mean splat weights (gravel, needles, soil, rock):", *[f"{v:.3f}" for v in mean])
        print(f"splat only, done in {time.time() - started:.0f} s")
        return
    raw = CACHE / "ground_raw"
    if raw.exists():
        shutil.rmtree(raw)
    raw.mkdir()
    for folder in ("near", "collision"):
        if (OUT / folder).exists():
            shutil.rmtree(OUT / folder)
        (OUT / folder).mkdir()

    leaves = build_leaves(BUDGET)
    print(f"budget {BUDGET} m (99th percentile): {len(leaves)} leaves, "
          f"by size {dict(sorted(Counter(int(s) for _, _, s in leaves).items()))}, {time.time() - started:.0f} s")
    records, block_records, near_jobs, far_jobs, per_level, errors, depths = build_leaves_pack(leaves, raw, OUT / "near", OUT / "collision")
    print(f"{len(block_records)} blocks of {BLOCK_METRES:.0f} m join {sum(len(b['leaves']) for b in block_records)} leaves at levels {BLOCK_LEVELS}")
    print(f"triangles per level {per_level}, total {sum(per_level)}")
    print(f"edge error m: median {np.median(errors):.2f}, max {max(errors):.2f}; skirt depth m: median {np.median(depths):.2f}, max {max(depths):.2f}")
    drawn = estimate_drawn(records)
    print(f"drawn from viewpoint {VIEWPOINT} with every level loaded, no frustum culling: per level {drawn}, total {sum(drawn)}")
    compress_all(near_jobs + far_jobs)
    shutil.rmtree(raw)
    print(f"compressed {len(near_jobs)} near files and {len(far_jobs)} far files, {time.time() - started:.0f} s")

    if "--meshes" in sys.argv:
        manifest = json.loads((OUT / "ground.json").read_text())
        manifest.update(far=[URL_PREFIX + job[1].name for job in far_jobs if job[1].name != "blocks.glb"],
                        blocksUrl=URL_PREFIX + "blocks.glb", blockLevels=list(BLOCK_LEVELS), blocks=block_records, leaves=records)
        (OUT / "ground.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
        print(f"meshes only, done in {time.time() - started:.0f} s")
        return

    cells = build_water(CACHE / "water.glb")
    compress(CACHE / "water.glb", OUT / "water.glb")
    print(f"water: {cells} wet cells")

    build_proxy()

    lake = lake_cells(LAKE_CELL_METRES)
    (lake.astype(np.uint8) * 255).tofile(OUT / "lake_mask.bin")
    print(f"lake mask: {lake.shape[0]} cells of {LAKE_CELL_METRES:.0f} m, {int(lake.sum())} lake cells")
    # The splat map ships as KTX2 like the other ground textures, so it stays compressed on the graphics
    # card: as a PNG it was unpacked to 4096 x 4096 RGBA there, 64 MB before its mip levels.
    mean = build_splatmap(CACHE / "splatmap.png")
    subprocess.run([sys.executable, str(ROOT / "tools/encode_ktx2.py"), "--linear", str(OUT), str(CACHE / "splatmap.png")], check=True)
    (OUT / "splatmap.png").unlink(missing_ok=True)
    print("mean splat weights (gravel, needles, soil, rock):", *[f"{v:.3f}" for v in mean])
    build_textures()

    def tex(name, kind):
        return URL_PREFIX + f"{name}_{kind}.ktx2"

    manifest = {
        "format": 4,
        "sizeMetres": int(SIZE_METRES),
        "far": [URL_PREFIX + job[1].name for job in far_jobs if job[1].name != "blocks.glb"],
        "blocksUrl": URL_PREFIX + "blocks.glb",
        "blockLevels": list(BLOCK_LEVELS),
        "blocks": block_records,
        "nearUrl": URL_PREFIX + "near/",
        "collisionUrl": URL_PREFIX + "collision/",
        "collisionSamples": QUADS + 1,
        "leaves": records,
        "lakeMask": {"url": URL_PREFIX + "lake_mask.bin", "cells": int(lake.shape[0])},
        "water": {"url": URL_PREFIX + "water.glb"},
        "reflectionProxy": {"url": URL_PREFIX + "reflection_proxy.glb"},
        "material": {
            "splatmapUrl": URL_PREFIX + "splatmap.ktx2",
            "layers": [{"name": l["name"], "albedoUrl": tex(l["name"], "albedo"), "normalUrl": tex(l["name"], "normal"),
                        "aoUrl": tex(l["name"], "ao"), "tileMetres": l["tileMetres"], "tint": l["tint"]} for l in LAYERS],
            "rock": {"albedoUrl": tex("rock", "albedo"), "normalUrl": tex("rock", "normal"), "tileMetres": ROCK["tileMetres"]},
            "lakeBed": bed_manifest(),
        },
    }
    if (OUT / "terrain_normal_ao.ktx2").exists():
        manifest["material"]["normalAoUrl"] = URL_PREFIX + "terrain_normal_ao.ktx2"
    (OUT / "ground.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    for stale in ("tiles_inner.glb", "tiles_outer.glb", "collision_inner.bin", "collision_outer.bin"):
        (OUT / stale).unlink(missing_ok=True)
    print(f"done in {time.time() - started:.0f} s")


if __name__ == "__main__":
    main()
