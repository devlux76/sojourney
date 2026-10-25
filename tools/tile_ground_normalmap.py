"""Author registered normal/AO tiles from the lossless terrain bake.

Ground leaves reference their existing region's padded, power-of-two crop.
Mip inputs come from a shared whole-map pyramid, not independently filtered crop
edges. Babylon only loads authored KTX2 files; no runtime image slicing is needed.
The small whole-map texture serves distant blocks and the reflection proxy.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

import numpy as np
from PIL import Image

from compress_textures import ktx_env

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets/crater-lake/ground/terrain_normal_ao.png"
OUT = ROOT / "public/packs/crater-lake/ground"
PADDING = 16
ALIGN = 64
FAR_SIZE = 2048
VERSION = 3
REGION_METRES = 2000


def next_power(n):
    return 1 << (int(n) - 1).bit_length()


def crop_rect(leaf, source_size, span):
    """Pixel-edge registration; image rows run north to south, world z goes north."""
    scale = source_size / span
    west = (leaf["x"] + span / 2) * scale
    east = (leaf["x"] + leaf["size"] + span / 2) * scale
    north = (span / 2 - leaf["z"] - leaf["size"]) * scale
    south = (span / 2 - leaf["z"]) * scale
    x = math.floor((west - PADDING) / ALIGN) * ALIGN
    y = math.floor((north - PADDING) / ALIGN) * ALIGN
    width = next_power(math.ceil(east + PADDING - x))
    height = next_power(math.ceil(south + PADDING - y))
    texel = span / source_size
    bounds = [x * texel - span / 2, span / 2 - (y + height) * texel,
              width * texel, height * texel]
    return x, y, width, height, bounds


def regions(manifest, source_size):
    """Share one crop among leaves on the existing terrain's 2 km boundaries.

    Babylon's URL texture cache shares the GPU resource too; regional coverage
    avoids shipping the same padded source pixels separately for each small leaf.
    """
    span = manifest["sizeMetres"]
    columns = math.ceil(span / REGION_METRES)
    crops, tiles = {}, []
    for leaf in manifest["leaves"]:
        col = math.floor((leaf["x"] + span / 2) / REGION_METRES)
        row = math.floor((leaf["z"] + span / 2) / REGION_METRES)
        # Group four existing 1 km block squares; existing 2 km leaves keep
        # their footprint. With 64-texel alignment every compressed 4x4 block
        # also aligns through mip 4, without enlarging a region past 1024 pixels.
        size = max(REGION_METRES, leaf["size"])
        region = {"x": col * REGION_METRES - span / 2,
                  "z": row * REGION_METRES - span / 2, "size": size}
        if leaf["x"] + leaf["size"] > region["x"] + size or leaf["z"] + leaf["size"] > region["z"] + size:
            raise ValueError("Terrain leaf crosses the regional grid")
        region_id = row * columns + col
        crops.setdefault(region_id, crop_rect(region, source_size, span))
        tiles.append({"url": f"packs/crater-lake/ground/normal_tiles/{region_id}.ktx2", "bounds": crops[region_id][4]})
    return crops, tiles


def pyramid(image):
    levels = [np.asarray(image.convert("RGB"))]
    while image.width > 1 or image.height > 1:
        # These are linear packed XY normals and sky visibility, not colours.
        # The shader reconstructs Y and renormalizes after texture filtering.
        image = image.resize((max(1, image.width // 2), max(1, image.height // 2)), Image.Resampling.BOX)
        levels.append(np.asarray(image))
    return levels


def sample_crop(level, x, y, width, height):
    """Sample shared mip texel centres, including fractional coarse-mip origins.

    Origins and UASTC blocks align through mip 4. Coarser levels interpolate that same
    authored global field, and map-edge gutters extend the nearest valid texel.
    """
    xx = np.clip(x + np.arange(width), 0, level.shape[1] - 1)
    yy = np.clip(y + np.arange(height), 0, level.shape[0] - 1)
    x0, y0 = np.floor(xx).astype(int), np.floor(yy).astype(int)
    x1, y1 = np.minimum(x0 + 1, level.shape[1] - 1), np.minimum(y0 + 1, level.shape[0] - 1)
    fx, fy = (xx - x0)[None, :, None], (yy - y0)[:, None, None]
    top = level[y0[:, None], x0] * (1 - fx) + level[y0[:, None], x1] * fx
    bottom = level[y1[:, None], x0] * (1 - fx) + level[y1[:, None], x1] * fx
    return np.rint(top * (1 - fy) + bottom * fy).astype(np.uint8)


def check_ktx(path, width, height):
    with path.open("rb") as stream:
        header = stream.read(80)
        expected = int(math.log2(max(width, height))) + 1
        index = stream.read(expected * 24)
    if header[:12] != b"\xabKTX 20\xbb\r\n\x1a\n":
        raise ValueError(f"Invalid KTX2: {path}")
    fields = struct.unpack_from("<9I", header, 12)
    if (fields[2], fields[3], fields[7]) != (width, height, expected):
        raise ValueError(f"Wrong dimensions/mip chain: {path}: {fields}")
    size = path.stat().st_size
    # Reject interrupted files with a plausible header but missing mip payload.
    # UASTC stores one 16-byte block per 4x4 texels before Zstandard compression.
    for lod in range(expected):
        offset, length, decoded = struct.unpack_from("<3Q", index, lod * 24)
        blocks = max(1, math.ceil((width >> lod) / 4)) * max(1, math.ceil((height >> lod) / 4))
        if offset < 80 + expected * 24 or not length or offset + length > size or decoded != blocks * 16:
            raise ValueError(f"Incomplete or invalid mip {lod}: {path}")
    if size > 25_000_000:
        raise ValueError(f"Texture exceeds deployment budget: {path}")


def encode_mips(levels, rect, output, env):
    x, y, width, height = rect[:4]
    if output.exists():
        try:
            check_ktx(output, width, height)
            return
        except (ValueError, struct.error):
            # An interrupted encoder can leave a partial file in the staging cache.
            output.unlink()
    count = int(math.log2(max(width, height))) + 1
    with tempfile.TemporaryDirectory(prefix="terrain-normal-mips-") as tmp:
        inputs = []
        for lod in range(count):
            divisor = 2 ** lod
            pixels = sample_crop(levels[min(lod, len(levels) - 1)], x / divisor, y / divisor,
                                 max(1, width // divisor), max(1, height // divisor))
            path = Path(tmp) / f"{lod}.png"
            Image.fromarray(pixels).transpose(Image.Transpose.FLIP_TOP_BOTTOM).save(path)
            inputs.append(str(path))
        subprocess.run(["ktx", "create", "--format", "R8G8B8_UNORM", "--assign-tf", "linear",
                        "--encode", "uastc", "--uastc-quality", "2", "--zstd", "18",
                        "--threads", "1", "--levels", str(count), *inputs, str(output)],
                       env=env, check=True, capture_output=True)
    check_ktx(output, width, height)


def build(source=SOURCE, output=OUT, workers=8):
    manifest_path = output / "ground.json"
    manifest = json.loads(manifest_path.read_text())
    with Image.open(source) as image:
        if image.mode != "RGB" or image.width != image.height or image.width & (image.width - 1):
            raise ValueError("Source must be a square power-of-two RGB bake")
        source_size = image.width
    signature = hashlib.sha256(source.read_bytes()).hexdigest()
    crops, tiles = regions(manifest, source_size)
    stamp = {"version": VERSION, "source": signature, "span": manifest["sizeMetres"],
             "leaves": [{k: leaf[k] for k in ("x", "z", "size")} for leaf in manifest["leaves"]],
             "padding": PADDING, "alignment": ALIGN, "farSize": FAR_SIZE, "regionMetres": REGION_METRES,
             "encoding": "linear-uastc2-zstd18-global-box-mips"}
    cache = ROOT / "tools/.cache/ground_normal_tiles/build.json"
    descriptor = manifest["material"].get("normalAoTiles")
    if cache.exists() and json.loads(cache.read_text()) == stamp and descriptor and descriptor["tiles"] == tiles:
        paths = [output / "terrain_normal_ao_far.ktx2", *[output / "normal_tiles" / f"{i}.ktx2" for i in crops]]
        if all(path.exists() for path in paths):
            check_ktx(paths[0], FAR_SIZE, FAR_SIZE)
            for region_id, rect in crops.items():
                check_ktx(output / "normal_tiles" / f"{region_id}.ktx2", rect[2], rect[3])
            print(f"Normal tiles current: {len(paths)} authored maps")
            return
    with Image.open(source) as image:
        levels = pyramid(image)
    env = ktx_env()
    # Stage the complete asset batch before publishing metadata or removing the giant map.
    staging = cache.parent / hashlib.sha256(json.dumps(stamp, sort_keys=True).encode()).hexdigest()
    staging.mkdir(parents=True, exist_ok=True)
    # Content-keyed staging lets an interrupted offline batch resume without
    # reusing assets from a different bake, layout, or encoding contract.
    with nullcontext(staging) as tmp:
        staged = Path(tmp)
        folder = staged / "normal_tiles"
        folder.mkdir(exist_ok=True)
        far_lod = int(math.log2(source_size // FAR_SIZE))
        encode_mips(levels[far_lod:], (0, 0, FAR_SIZE, FAR_SIZE), staged / "terrain_normal_ao_far.ktx2", env)
        jobs = []
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for region_id, rect in crops.items():
                jobs.append(pool.submit(encode_mips, levels, rect, folder / f"{region_id}.ktx2", env))
            for i, job in enumerate(jobs):
                job.result()
                if (i + 1) % 100 == 0 or i + 1 == len(jobs):
                    print(f"Encoded {i + 1}/{len(jobs)} normal tiles", flush=True)
        target = output / "normal_tiles"
        target.mkdir(exist_ok=True)
        for path in folder.iterdir():
            shutil.copy2(path, target / path.name)
        # Remove only obsolete numbered members in the dedicated generated directory.
        for path in target.glob("*.ktx2"):
            if path.stem.isdigit() and int(path.stem) not in crops:
                path.unlink()
        shutil.copy2(staged / "terrain_normal_ao_far.ktx2", output / "terrain_normal_ao_far.ktx2")
    manifest["material"]["normalAoUrl"] = "packs/crater-lake/ground/terrain_normal_ao_far.ktx2"
    manifest["material"]["normalAoTiles"] = {"sourceSize": source_size,
        "texelMetres": manifest["sizeMetres"] / source_size, "padding": PADDING, "tiles": tiles}
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    (output / "terrain_normal_ao.ktx2").unlink(missing_ok=True)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(stamp, sort_keys=True))
    maps = [output / "terrain_normal_ao_far.ktx2", *target.glob("*.ktx2")]
    print(f"Published {len(maps)} maps, {sum(p.stat().st_size for p in maps):,} bytes; "
          f"largest {max(p.stat().st_size for p in maps):,} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=OUT)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    build(args.source, args.output, args.workers)
