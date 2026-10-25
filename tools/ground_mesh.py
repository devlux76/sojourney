import numpy as np

from heightfield import height


def _grid_indices(n):
    j, i = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
    a = (j * (n + 1) + i).ravel()
    b = a + (n + 1)
    c = a + 1
    d = b + 1
    return np.concatenate([np.stack([a, c, b], 1), np.stack([b, c, d], 1)])


def _ring(n):
    w = n + 1
    ring = [i for i in range(n + 1)]
    ring += [j * w + n for j in range(1, n + 1)]
    ring += [n * w + i for i in range(n - 1, -1, -1)]
    ring += [j * w for j in range(n - 1, 0, -1)]
    return np.array(ring)


# Largest gap along the four edges between the source (2 m samples) and the leaf edge as drawn at each level
# (factors = vertex strides 1, 2, 4, 8, 16). Neighbouring leaves differ by up to the sum of their two errors,
# which is what the skirt has to hide.
def edge_error(x0, z0, size, h0, factors):
    step = size / (len(h0) - 1)
    along = np.arange(int(size / 2) + 1) * 2.0
    nodes = np.arange(len(h0))
    edges = [(h0[0, :], height(x0 + along, z0)), (h0[-1, :], height(x0 + along, z0 + size)),
             (h0[:, 0], height(x0, z0 + along)), (h0[:, -1], height(x0 + size, z0 + along))]
    worst = 0.0
    for f in factors:
        for edge, truth in edges:
            worst = max(worst, float(np.abs(np.interp(along / step, nodes[::f], edge[::f]) - truth).max()))
    return worst


def tile_heights(x0, z0, size, step, levels):
    n0 = round(size / step)
    pad = 2 ** (levels - 1)
    xs = x0 + (np.arange(n0 + 1 + 2 * pad) - pad) * step
    zs = z0 + (np.arange(n0 + 1 + 2 * pad) - pad) * step
    X, Z = np.meshgrid(xs, zs)
    return n0, pad, height(X, Z)


# Two zero-area vertices at the leaf's lowest and highest y pin every level's bounding box to the same box, so
# meshopt quantisation gives all levels the same node transform (levels are drawn with the LOD master's matrix).
def pin_bounds(positions):
    return float(positions[:, 1].min()), float(positions[:, 1].max())


# Returns positions, normals, uvs and indices. The skirt is a strip hanging from the level's edge that
# hides the cracks between neighbours at different levels. It has its own vertices, top and bottom, and
# they alone have u = 1: the ground material draws them a little farther back in depth, so a skirt never
# shows through the face of a cliff that stands just in front of it (the depth buffer cannot tell the
# two apart a kilometre off, and they flickered).
def build_level(x0, z0, step, n0, pad, hp, k, depth, pin=None):
    f = 2 ** k
    n = n0 // f
    s = step * f
    idx = pad + f * np.arange(n + 1)
    J, I = np.meshgrid(idx, idx, indexing="ij")
    h = hp[J, I]
    dx = (hp[J, I + f] - hp[J, I - f]) / (2 * s)
    dz = (hp[J + f, I] - hp[J - f, I]) / (2 * s)
    normals = np.stack([-dx, np.ones_like(dx), -dz], -1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    x = x0 + np.arange(n + 1) * s
    z = z0 + np.arange(n + 1) * s
    X, Z = np.meshgrid(x, z)
    positions = np.stack([X, h, Z], -1).reshape(-1, 3)
    normals = normals.reshape(-1, 3)
    ring = _ring(n)
    skirt_bottom = positions[ring].copy()
    skirt_bottom[:, 1] -= depth
    count = len(positions)
    t = np.arange(len(ring))
    t1 = (t + 1) % len(ring)
    top0, top1, bot0, bot1 = count + t, count + t1, count + len(ring) + t, count + len(ring) + t1
    skirt = np.concatenate([np.stack([top0, bot0, top1], 1), np.stack([top1, bot0, bot1], 1)])
    uvs = np.zeros((count + 2 * len(ring), 2))
    uvs[count:, 0] = 1.0
    positions = np.concatenate([positions, positions[ring], skirt_bottom])
    normals = np.concatenate([normals, normals[ring], normals[ring]])
    indices = np.concatenate([_grid_indices(n), skirt])
    if pin is not None:
        centre = n0 * step / 2
        count = len(positions)
        positions = np.concatenate([positions, [[x0 + centre, pin[0], z0 + centre], [x0 + centre, pin[1], z0 + centre]]])
        normals = np.concatenate([normals, [[0.0, 1.0, 0.0], [0.0, 1.0, 0.0]]])
        uvs = np.concatenate([uvs, [[0.0, 0.0], [0.0, 0.0]]])
        indices = np.concatenate([indices, [[count, count, count + 1]]])
    gltf_positions = positions * np.array([-1, 1, 1])
    gltf_normals = normals * np.array([-1, 1, 1])
    return gltf_positions, gltf_normals, uvs, indices
