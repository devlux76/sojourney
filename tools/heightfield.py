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
