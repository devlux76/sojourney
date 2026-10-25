"""Build the Crater Lake ground source from USGS Data Series 716 into assets/crater-lake/terrain/source/.

Usage: uv run --quiet --with rasterio --with numpy --with scipy --with pillow python tools/build_heightmap.py
       (add --legacy to also write the old 10 m map and 4 km tile into public/packs/crater-lake/terrain/)

Source: Robinson, J.E., 2012, USGS Data Series 716, 1 m NAD83 UTM 10N (EPSG:26910) float32 grid,
2010 lidar bare earth merged with the 2000 multibeam bathymetry. World axes: +x east, +z north,
origin ORIGIN_UTM (Wizard Island summit). The 18 km window is cut at 1 m to tools/.cache/ds716/window1m.npy.

Cell mapping: a 1 m cell is the average over its square, centred half a metre from the grid lattice
(left edge 556469.2092 m, top edge 4771630.5563 m). Sample (row j, col i) of the 2 m grid sits at
x = -9000 + 2i, z = 9000 - 2j. Its value is the mean over its own 2 x 2 m square: four points at
(x +- 0.5, z +- 0.5), each bilinearly interpolated from the four nearest 1 m cell centres. This is
area-averaging, not point sampling: the 2 m mesh cannot represent 1 m detail and point samples of rough
rock would alias, while the box mean keeps the average height. A sample touching an empty cell is empty.

Empty samples (the shoreline ring between lidar and sonar, and a few land holes) are filled by solving
Laplace's equation over them from their known neighbours; samples with data are never changed.
A gap that reaches more than 0.5 m below the lake surface is water the lidar could not see, so its filled
samples lying less than SHELF_M above the surface are capped 1 cm under it; the lake then meets the lidar
shoreline, and a wall that continues above the water is left as the fill made it. Land holes are not capped.
Lake mask: samples below LAKE_SURFACE_M that are 4-connected to the lake seed point, 1 = lake.
Outputs: heightmap.bin (uint16 LE, row 0 = north), heightmap.json, lake_mask.bin.z (zlib uint8, same grid).
"""
import json
import pathlib
import sys
import urllib.request
import zipfile
import zlib

import numpy as np
import rasterio
from affine import Affine
from PIL import Image
from rasterio.enums import Resampling
from rasterio.warp import reproject
from scipy import ndimage, sparse
from scipy.sparse.linalg import spsolve

SOURCE_URL = "https://oe.oregonexplorer.info/craterlake/products/bathymetry/bathy_dem.zip"
CACHE = pathlib.Path("tools/.cache")
OUT = pathlib.Path("public/packs/crater-lake/terrain")

ISLAND_SUMMIT_UTM = (569703.0, 4754165.0)
SIZE_M = 18000.0
SPACING_M = 10.0
LAKE_SURFACE_M = 1882.0

SAMPLES = int(SIZE_M / SPACING_M) + 1


BATHY_URL = "https://oe.oregonexplorer.info/craterlake/products/bathymetry/bathy_nad27.zip"
TILE_SIZE_M = 4000.0
TILE_SPACING_M = 2.0
TILE_SAMPLES = int(TILE_SIZE_M / TILE_SPACING_M) + 1
SHORE_BLEND_M = 20.0


DS716_URL = "https://pubs.usgs.gov/ds/716/data/DS716-CraterLake_LiDAR.zip"
DS716 = CACHE / "ds716"
SOURCE = pathlib.Path("assets/crater-lake/terrain/source")
ORIGIN_UTM = (569609.0, 4754367.0)
WORLD_SIZE_M = 18000.0
WORLD_STEP_M = 2.0
WORLD_SAMPLES = int(WORLD_SIZE_M / WORLD_STEP_M) + 1
LAKE_SURFACE = 1882.25
SHELF_M = 0.5
LAKE_SEED = (2500.0, 0.0)


def fetch(url: str, name: str) -> pathlib.Path:
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        archive = CACHE / url.rsplit("/", 1)[1]
        if not archive.exists():
            print(f"downloading {url}")
            urllib.request.urlretrieve(url, archive)
        zipfile.ZipFile(archive).extractall(CACHE)
    return path


def source_dem() -> pathlib.Path:
    return fetch(SOURCE_URL, "bathy_dem.dem")


def crop(dem_path: pathlib.Path) -> np.ndarray:
    cx, cy = ISLAND_SUMMIT_UTM
    half = SIZE_M / 2
    with rasterio.open(dem_path) as dem:
        window = rasterio.windows.from_bounds(cx - half - SPACING_M / 2, cy - half - SPACING_M / 2,
                                              cx + half + SPACING_M / 2, cy + half + SPACING_M / 2,
                                              dem.transform)
        heights = dem.read(1, window=window, out_shape=(SAMPLES, SAMPLES), masked=True,
                           resampling=Resampling.bilinear)
    if heights.mask.any():
        raise SystemExit(f"{heights.mask.sum()} samples have no data; the crop runs off the DEM")
    return heights.filled().astype(np.float64)


def resample(path: pathlib.Path, size_m: float, samples: int) -> np.ma.MaskedArray:
    spacing = size_m / (samples - 1)
    cx, cy = ISLAND_SUMMIT_UTM
    left, top = cx - size_m / 2 - spacing / 2, cy + size_m / 2 + spacing / 2
    out = np.full((samples, samples), -32767.0, dtype=np.float32)
    with rasterio.open(path) as src:
        reproject(rasterio.band(src, 1), out, src_nodata=src.nodata, dst_nodata=-32767.0,
                  dst_transform=Affine(spacing, 0, left, 0, -spacing, top), dst_crs=src.crs,
                  resampling=Resampling.bilinear)
    return np.ma.masked_equal(out, -32767.0)


def bathymetry_tile() -> np.ndarray:
    survey = resample(fetch(BATHY_URL, "bathy_nad27.dem"), TILE_SIZE_M, TILE_SAMPLES)
    base = resample(source_dem(), TILE_SIZE_M, TILE_SAMPLES)
    if base.mask.any():
        raise SystemExit("10 m map has gaps under the bathymetry tile")
    base = base.filled().astype(np.float64)
    have = ~np.ma.getmaskarray(survey)
    inside = ndimage.distance_transform_edt(have) * TILE_SPACING_M
    w = np.clip(inside / SHORE_BLEND_M, 0, 1)
    return base * (1 - w) + survey.filled(0).astype(np.float64) * w


def preview(heights: np.ndarray, path: pathlib.Path):
    gy, gx = np.gradient(heights, SPACING_M)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    sun_azimuth, sun_altitude = np.radians(315), np.radians(40)
    shade = np.clip(np.sin(sun_altitude) * np.cos(slope)
                    + np.cos(sun_altitude) * np.sin(slope) * np.cos(sun_azimuth - aspect), 0, 1)
    rgb = np.dstack([shade * 200 + 30, shade * 190 + 40, shade * 170 + 40])
    underwater = heights < LAKE_SURFACE_M
    depth = np.clip((LAKE_SURFACE_M - heights) / 600, 0, 1)[..., None]
    rgb[underwater] = (np.dstack([40 + 60 * shade, 90 + 70 * shade, 150 + 80 * shade]) * (1 - 0.6 * depth))[underwater]
    Image.fromarray(rgb.clip(0, 255).astype(np.uint8)).resize((1000, 1000)).save(path)


def legacy():
    heights = crop(source_dem())
    low, high = float(heights.min()), float(heights.max())
    encoded = np.round((heights - low) / (high - low) * 65535).astype("<u2")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "heightmap.bin").write_bytes(encoded.tobytes())
    (OUT / "heightmap.json").write_text(json.dumps({
        "sizeMetres": SIZE_M, "samples": SAMPLES, "minElevation": low, "maxElevation": high,
        "lakeSurfaceElevation": LAKE_SURFACE_M,
    }, indent=2) + "\n")
    preview(heights, CACHE / "heightmap_preview.png")
    tile = bathymetry_tile()
    t_low, t_high = float(tile.min()), float(tile.max())
    t_encoded = np.round((tile - t_low) / (t_high - t_low) * 65535).astype("<u2")
    (OUT / "bathymetry_2m.bin.z").write_bytes(zlib.compress(t_encoded.tobytes(), 9))
    (OUT / "bathymetry_2m.json").write_text(json.dumps({
        "sizeMetres": TILE_SIZE_M, "samples": TILE_SAMPLES, "minElevation": t_low, "maxElevation": t_high,
    }, indent=2) + "\n")
    preview(tile, CACHE / "bathymetry_preview.png")
    print(f"wrote {TILE_SAMPLES}x{TILE_SAMPLES} 2 m tile, {t_low:.1f}-{t_high:.1f} m")
    step_cm = (high - low) / 65535 * 100
    print(f"wrote {SAMPLES}x{SAMPLES} heightmap, {low:.1f}-{high:.1f} m ({step_cm:.1f} cm steps); "
          f"summit {heights[SAMPLES // 2, SAMPLES // 2]:.1f} m, lake surface {LAKE_SURFACE_M} m")


def ds716_grid() -> pathlib.Path:
    path = DS716 / "DS716-CraterLake_LiDAR" / "craterlake_1m"
    if not path.exists():
        DS716.mkdir(parents=True, exist_ok=True)
        archive = DS716 / DS716_URL.rsplit("/", 1)[1]
        if not archive.exists():
            print(f"downloading {DS716_URL}")
            urllib.request.urlretrieve(DS716_URL, archive)
        zipfile.ZipFile(archive).extractall(DS716)
    return path


def box_operator(f, width):
    rows, cols, vals = [], [], []
    for offset in (-0.5, 0.5):
        g = f + offset
        lo = np.floor(g).astype(np.int64)
        t = g - lo
        rows.append(np.repeat(np.arange(len(f)), 2))
        cols.append(np.stack([lo, lo + 1], 1).ravel())
        vals.append(np.stack([1 - t, t], 1).ravel() * 0.5)
    return sparse.csr_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))),
                             shape=(len(f), width))


def cut_window(grid_path: pathlib.Path) -> np.ndarray:
    ox, oy = ORIGIN_UTM
    half = WORLD_SIZE_M / 2
    with rasterio.open(grid_path) as src:
        left, top = src.transform.c, src.transform.f
        c_first = int(np.floor(ox - half - 0.5 - left - 0.5))
        c_last = int(np.ceil(ox + half + 0.5 - left - 0.5)) + 1
        r_first = int(np.floor(top - (oy + half + 0.5) - 0.5))
        r_last = int(np.ceil(top - (oy - half - 0.5) - 0.5)) + 1
        width, height = c_last - c_first + 1, r_last - r_first + 1
        out = np.lib.format.open_memmap(DS716 / "window1m.npy", mode="w+", dtype=np.float32, shape=(height, width))
        for r in range(0, height, 1000):
            n = min(1000, height - r)
            block = src.read(1, window=rasterio.windows.Window(c_first, r_first + r, width, n)).astype(np.float32)
            block[block < -1e30] = np.nan
            out[r:r + n] = block
        out.flush()
        (DS716 / "window1m.json").write_text(json.dumps({
            "firstCol": c_first, "firstRow": r_first, "left": left, "top": top, "origin": ORIGIN_UTM}) + "\n")
    return out


def resample_2m(window: np.ndarray) -> np.ndarray:
    info = json.loads((DS716 / "window1m.json").read_text())
    ox, oy = ORIGIN_UTM
    xs = ox - WORLD_SIZE_M / 2 + np.arange(WORLD_SAMPLES) * WORLD_STEP_M
    ys = oy + WORLD_SIZE_M / 2 - np.arange(WORLD_SAMPLES) * WORLD_STEP_M
    height, width = window.shape
    hx = box_operator(xs - info["left"] - 0.5 - info["firstCol"], width)
    vy = box_operator(info["top"] - ys - 0.5 - info["firstRow"], height).tocsr()
    out = np.empty((WORLD_SAMPLES, WORLD_SAMPLES), dtype=np.float32)
    for j0 in range(0, WORLD_SAMPLES, 500):
        j1 = min(j0 + 500, WORLD_SAMPLES)
        block = vy[j0:j1]
        used = np.unique(block.indices)
        r_lo, r_hi = used.min(), used.max() + 1
        block = block[:, r_lo:r_hi]
        strip = np.asarray(window[r_lo:r_hi], dtype=np.float64)
        bad = np.isnan(strip)
        value = (hx @ (block @ np.where(bad, 0.0, strip)).T).T
        touched = (hx @ (block @ bad.astype(np.float64)).T).T
        value[touched > 1e-9] = np.nan
        out[j0:j1] = value
    return out


def fill_gaps(grid: np.ndarray) -> np.ndarray:
    empty = np.isnan(grid)
    count = int(empty.sum())
    index = np.full(grid.shape, -1, dtype=np.int64)
    index[empty] = np.arange(count)
    padded = np.pad(grid, 1, constant_values=np.nan)
    r, c = np.nonzero(empty)
    rhs = np.zeros(count)
    degree = np.zeros(count)
    rows, cols = [], []
    for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        neighbour = padded[r + 1 + dr, c + 1 + dc]
        on_grid = (r + dr >= 0) & (r + dr < grid.shape[0]) & (c + dc >= 0) & (c + dc < grid.shape[1])
        unknown = on_grid & np.isnan(neighbour)
        known = on_grid & ~unknown
        degree += on_grid
        rhs[known] += neighbour[known]
        rows.append(np.nonzero(unknown)[0])
        cols.append(index[r[unknown] + dr, c[unknown] + dc])
    rows, cols = np.concatenate(rows), np.concatenate(cols)
    matrix = sparse.csr_matrix((-np.ones(len(rows)), (rows, cols)), shape=(count, count)) + sparse.diags(degree)
    filled = grid.copy()
    filled[empty] = spsolve(matrix.tocsc(), rhs)
    labels, count = ndimage.label(empty)
    lowest = np.asarray(ndimage.minimum(filled, labels, np.arange(1, count + 1)))
    submerged = np.isin(labels, np.nonzero(lowest < LAKE_SURFACE - 0.5)[0] + 1)
    shelf = submerged & (filled < LAKE_SURFACE + SHELF_M)
    filled[shelf] = np.minimum(filled[shelf], LAKE_SURFACE - 0.01)
    return filled


def lake_mask(heights: np.ndarray) -> np.ndarray:
    seed = (int((WORLD_SIZE_M / 2 - LAKE_SEED[1]) / WORLD_STEP_M), int((LAKE_SEED[0] + WORLD_SIZE_M / 2) / WORLD_STEP_M))
    below = heights < LAKE_SURFACE
    if not below[seed]:
        raise SystemExit("lake seed point is above the lake surface")
    labels, _ = ndimage.label(below)
    return labels == labels[seed]


def build():
    window = cut_window(ds716_grid()) if not (DS716 / "window1m.npy").exists() else np.load(DS716 / "window1m.npy", mmap_mode="r")
    grid = resample_2m(window)
    empty = int(np.isnan(grid).sum())
    grid = fill_gaps(grid)
    low, high = float(grid.min()), float(grid.max())
    encoded = np.round((grid - low) / (high - low) * 65535).astype("<u2")
    mask = lake_mask(grid.astype(np.float64))
    SOURCE.mkdir(parents=True, exist_ok=True)
    (SOURCE / "heightmap.bin").write_bytes(encoded.tobytes())
    (SOURCE / "heightmap.json").write_text(json.dumps({
        "sizeMetres": WORLD_SIZE_M, "samples": WORLD_SAMPLES, "minElevation": low, "maxElevation": high,
        "lakeSurfaceElevation": LAKE_SURFACE,
    }, indent=2) + "\n")
    (SOURCE / "lake_mask.bin.z").write_bytes(zlib.compress(mask.astype(np.uint8).tobytes(), 9))
    print(f"wrote {WORLD_SAMPLES}x{WORLD_SAMPLES} heightmap, {low:.2f}-{high:.2f} m "
          f"({(high - low) / 65535 * 100:.1f} cm steps); filled {empty} empty samples; "
          f"lake {mask.sum() * WORLD_STEP_M ** 2 / 1e6:.2f} km2")


def main():
    if "--legacy" in sys.argv:
        legacy()
    build()


if __name__ == "__main__":
    main()
