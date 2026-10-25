import json
import pathlib
import zlib

import numpy as np

SOURCE = pathlib.Path(__file__).resolve().parent.parent / "assets/crater-lake/terrain/source"

_meta = json.loads((SOURCE / "heightmap.json").read_text())
_samples = int(_meta["samples"])
_grid = np.fromfile(SOURCE / "heightmap.bin", dtype="<u2").reshape(_samples, _samples)
_lake = np.frombuffer(zlib.decompress((SOURCE / "lake_mask.bin.z").read_bytes()), dtype=np.uint8).reshape(
    _samples, _samples)

SIZE_METRES = float(_meta["sizeMetres"])
LAKE_SURFACE_ELEVATION = float(_meta["lakeSurfaceElevation"])

# The registered 1 m lidar window adds metre-scale relief to meshes where coverage exists. It is
# loaded lazily, so tools that only need the base heightmap do not map the 1.3 GB cache.
_W1 = None
_W1_X0 = 0.0
_W1_ZN0 = 0.0


def _ensure_window():
    global _W1, _W1_X0, _W1_ZN0
    if _W1 is None:
        cache = pathlib.Path(__file__).resolve().parent / ".cache" / "ds716"
        info = json.loads((cache / "window1m.json").read_text())
        _W1_X0 = float(info["left"]) + float(info["firstCol"]) - float(info["origin"][0])
        _W1_ZN0 = float(info["top"]) - float(info["firstRow"]) - float(info["origin"][1])
        _W1 = np.load(str(cache / "window1m.npy"), mmap_mode="r")

_STEP = SIZE_METRES / (_samples - 1)
_SPAN = (_meta["maxElevation"] - _meta["minElevation"]) / 65535


def _cell(x, z):
    fc = np.clip((x + SIZE_METRES / 2) / _STEP, 0, _samples - 1)
    fr = np.clip((SIZE_METRES / 2 - z) / _STEP, 0, _samples - 1)
    return fc, fr


def height(x, z):
    x, z = np.asarray(x, dtype=np.float64), np.asarray(z, dtype=np.float64)
    fc, fr = _cell(x, z)
    c = np.minimum(fc, _samples - 2).astype(np.int64)
    r = np.minimum(fr, _samples - 2).astype(np.int64)
    tc, tr = fc - c, fr - r
    top = _grid[r, c] * (1 - tc) + _grid[r, c + 1] * tc
    bottom = _grid[r + 1, c] * (1 - tc) + _grid[r + 1, c + 1] * tc
    return _meta["minElevation"] + (top * (1 - tr) + bottom * tr) * _SPAN - LAKE_SURFACE_ELEVATION


def height1m(x, z):
    """Like height() but sampled from the 1 m lidar window: metre-scale edges the 2 m grid's
    bilinear destroyed survive here. Outside the window, or over its NaN voids (shoreline/lake
    cells), it falls back to height() for those points, so it is a drop-in replacement that only
    ever adds detail. Same lake-relative datum as height()."""
    _ensure_window()
    X, Z = np.broadcast_arrays(np.asarray(x, dtype=np.float64), np.asarray(z, dtype=np.float64))
    shape = X.shape
    X, Z = X.reshape(-1), Z.reshape(-1)
    rows, cols = _W1.shape
    # Lidar sample centres are half a metre inside each registered cell. Keep unclipped indices
    # for the coverage check so points outside the window use the full-coverage base heightmap.
    fc = X - _W1_X0 - 0.5
    fr = _W1_ZN0 - Z - 0.5
    inside = (fc >= 0) & (fc <= cols - 1) & (fr >= 0) & (fr <= rows - 1)
    fc = np.clip(fc, 0, cols - 2)
    fr = np.clip(fr, 0, rows - 2)
    c = fc.astype(np.int64)
    r = fr.astype(np.int64)
    tc, tr = fc - c, fr - r
    # Convert only the sampled cells; converting the full memmap would copy more than a gigabyte.
    v = (_W1[r, c].astype(np.float64) * (1 - tc) * (1 - tr)
         + _W1[r, c + 1].astype(np.float64) * tc * (1 - tr)
         + _W1[r + 1, c].astype(np.float64) * (1 - tc) * tr
         + _W1[r + 1, c + 1].astype(np.float64) * tc * tr - LAKE_SURFACE_ELEVATION)
    bad = ~inside | np.isnan(v)
    if bad.any():
        v[bad] = height(X[bad], Z[bad])
    return v.reshape(shape)


def in_lake(x, z):
    fc, fr = _cell(np.asarray(x, dtype=np.float64), np.asarray(z, dtype=np.float64))
    return _lake[np.rint(fr).astype(np.int64), np.rint(fc).astype(np.int64)] == 1


def lake_cells(cell_metres):
    block = int(round(cell_metres / _STEP))
    count = int(SIZE_METRES // cell_metres)
    cut = _lake[:count * block, :count * block]
    return cut.reshape(count, block, count, block).max(axis=(1, 3))[::-1] == 1


# As lake_cells, but a cell is set only when every sample in it is lake.
def all_lake_cells(cell_metres):
    block = int(round(cell_metres / _STEP))
    count = int(SIZE_METRES // cell_metres)
    cut = _lake[:count * block, :count * block]
    return cut.reshape(count, block, count, block).min(axis=(1, 3))[::-1] == 1


def slope(x, z, step=2.0):
    dx = (height(x + step, z) - height(x - step, z)) / (2 * step)
    dz = (height(x, z + step) - height(x, z - step)) / (2 * step)
    return np.hypot(dx, dz)
