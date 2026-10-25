import numpy as np
from PIL import Image, ImageFilter

from heightfield import SIZE_METRES, height, in_lake, lake_cells

# The ground is a quadtree: 2000 m roots split into four until the leaf grid (128 quads) is close enough
# to the 2 m source or the leaf is 250 m. Leaf steps are 15.6, 7.8, 3.9 and 1.95 m.
ROOT_METRES = 2000.0
MIN_METRES = 250.0
QUADS = 128
SAMPLE_METRES = 2.0
# Error is the 99th percentile of |leaf surface - source| at 2 m samples, so a single spike cannot force a split.
PERCENTILE = 99
DEEP_METRES = 30.0
# Lake floor deeper than 30 m is only seen underwater: it may be 4 times as coarse.
DEEP_ALLOWANCE = 4.0
# Beyond 1.5 km of the lake (a square around the lake mask) the player rarely looks closely: twice the error.
FAR_ALLOWANCE = 2.0
SHORE_REACH_METRES = 1500.0
ZONE_CELL_METRES = 24.0


def _shore_zone():
    cells = lake_cells(ZONE_CELL_METRES)
    reach = 2 * int(SHORE_REACH_METRES / ZONE_CELL_METRES) + 1
    return np.asarray(Image.fromarray(cells.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(reach))) > 0


SHORE_ZONE = _shore_zone()


def _near_shore(X, Z):
    n = len(SHORE_ZONE)
    col = np.clip(((X + SIZE_METRES / 2) // ZONE_CELL_METRES).astype(int), 0, n - 1)
    row = np.clip(((Z + SIZE_METRES / 2) // ZONE_CELL_METRES).astype(int), 0, n - 1)
    return SHORE_ZONE[row, col]


def _interpolation(points, origin, step):
    f = np.clip((points - origin) / step, 0, QUADS - 1e-9)
    i = f.astype(int)
    t = f - i
    w = np.zeros((len(points), QUADS + 1))
    rows = np.arange(len(points))
    w[rows, i] = 1 - t
    w[rows, i + 1] = t
    return w


# Heights at the 129 x 129 nodes of a leaf, rows by z ascending, columns by x ascending.
def leaf_heights(x0, z0, size):
    step = size / QUADS
    xs = x0 + np.arange(QUADS + 1) * step
    zs = z0 + np.arange(QUADS + 1) * step
    X, Z = np.meshgrid(xs, zs)
    return height(X, Z)


# Bilinear interpolation of the leaf grid compared with the source at every 2 m, as a separable matrix product.
def tile_error(x0, z0, size):
    step = size / QUADS
    h0 = leaf_heights(x0, z0, size)
    points = np.arange(int(size / SAMPLE_METRES) + 1) * SAMPLE_METRES
    wx, wz = _interpolation(x0 + points, x0, step), _interpolation(z0 + points, z0, step)
    approx = wz @ h0 @ wx.T
    X, Z = np.meshgrid(x0 + points, z0 + points)
    truth = height(X, Z)
    allowance = np.where(_near_shore(X, Z), 1.0, FAR_ALLOWANCE)
    allowance = np.where((truth < -DEEP_METRES) & in_lake(X, Z), DEEP_ALLOWANCE, allowance)
    return float(np.percentile(np.abs(approx - truth) / allowance, PERCENTILE))


def build_leaves(budget):
    count = round(SIZE_METRES / ROOT_METRES)
    origin = -SIZE_METRES / 2
    leaves = []

    def visit(x0, z0, size):
        if size > MIN_METRES and tile_error(x0, z0, size) > budget:
            half = size / 2
            for dz in (0, half):
                for dx in (0, half):
                    visit(x0 + dx, z0 + dz, half)
        else:
            leaves.append((x0, z0, size))

    for tz in range(count):
        for tx in range(count):
            visit(origin + tx * ROOT_METRES, origin + tz * ROOT_METRES, ROOT_METRES)
    return leaves


# For each leaf, the indices of the leaves touching its perimeter (on a 250 m cell map).
def adjacent(leaves):
    count = round(SIZE_METRES / MIN_METRES)
    owner = np.full((count, count), -1)
    spans = []
    for n, (x0, z0, size) in enumerate(leaves):
        c0, r0, span = round((x0 + SIZE_METRES / 2) / MIN_METRES), round((z0 + SIZE_METRES / 2) / MIN_METRES), round(size / MIN_METRES)
        owner[r0:r0 + span, c0:c0 + span] = n
        spans.append((c0, r0, span))
    result = []
    for n, (c0, r0, span) in enumerate(spans):
        ring = set()
        for i in range(span):
            for c, r in ((c0 + i, r0 - 1), (c0 + i, r0 + span), (c0 - 1, r0 + i), (c0 + span, r0 + i)):
                if 0 <= c < count and 0 <= r < count:
                    ring.add(int(owner[r, c]))
        result.append(ring)
    return result
