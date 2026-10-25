import numpy as np

WELD = 1e4


class Corners:
    def __init__(self, pos, nor, uv, mat):
        self.pos = np.asarray(pos, np.float32).reshape(-1, 3)
        self.nor = np.asarray(nor, np.float32).reshape(-1, 3)
        self.uv = np.asarray(uv, np.float32).reshape(-1, 2)
        self.mat = np.asarray(mat, np.int32)

    @property
    def tris(self):
        return len(self.mat)

    def take(self, tri_mask):
        c = np.repeat(tri_mask, 3)
        return Corners(self.pos[c], self.nor[c], self.uv[c], self.mat[tri_mask])

    @staticmethod
    def concat(parts):
        parts = [p for p in parts if p.tris]
        return Corners(np.concatenate([p.pos for p in parts]), np.concatenate([p.nor for p in parts]),
                       np.concatenate([p.uv for p in parts]), np.concatenate([p.mat for p in parts]))


def load(npz, prefix):
    return Corners(npz[prefix + "_pos"], npz[prefix + "_nor"], npz[prefix + "_uv"], npz[prefix + "_mat"])


def weld_ids(pos):
    key = np.round(pos.astype(np.float64) * WELD).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    return inv.ravel()


def islands(pos):
    tri = weld_ids(pos).reshape(-1, 3)
    n = tri.max() + 1
    lab = np.arange(n)
    a = np.concatenate([tri[:, 0], tri[:, 1], tri[:, 2]])
    b = np.concatenate([tri[:, 1], tri[:, 2], tri[:, 0]])
    while True:
        m = np.minimum(lab[a], lab[b])
        new = lab.copy()
        np.minimum.at(new, a, m)
        np.minimum.at(new, b, m)
        new = new[new]
        if (new == lab).all():
            break
        lab = new
    return lab[tri[:, 0]]


def smooth_normals(pos):
    tri = pos.reshape(-1, 3, 3).astype(np.float64)
    face = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    ids = weld_ids(pos)
    acc = np.zeros((ids.max() + 1, 3))
    for k in range(3):
        np.add.at(acc, ids.reshape(-1, 3)[:, k], face)
    n = acc[ids]
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    return n.astype(np.float32)


def triangle_areas(pos):
    tri = pos.reshape(-1, 3, 3).astype(np.float64)
    return 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)


def indexed(corners):
    data = np.concatenate([corners.pos, corners.nor, corners.uv], axis=1).astype(np.float32)
    view = np.ascontiguousarray(data).view([("", np.float32)] * data.shape[1]).ravel()
    uniq, inv = np.unique(view, return_inverse=True)
    uniq = uniq.view(np.float32).reshape(-1, data.shape[1])
    return uniq[:, 0:3], uniq[:, 3:6], uniq[:, 6:8], inv.astype(np.uint32).reshape(-1, 3)


def morton(points):
    lo, hi = points.min(0), points.max(0)
    q = ((points - lo) / np.maximum(hi - lo, 1e-9) * 1023).astype(np.uint64)
    code = np.zeros(len(points), np.uint64)
    for bit in range(10):
        for axis in range(3):
            code |= ((q[:, axis] >> np.uint64(bit)) & np.uint64(1)) << np.uint64(3 * bit + axis)
    return code


class Islands:
    def __init__(self, corners):
        self.corners = corners
        label = islands(corners.pos)
        _, self.island_of_tri = np.unique(label, return_inverse=True)
        self.count = self.island_of_tri.max() + 1
        self.tri_counts = np.bincount(self.island_of_tri, minlength=self.count)
        tri_pos = corners.pos.reshape(-1, 3, 3)
        self.centroid = np.zeros((self.count, 3))
        np.add.at(self.centroid, self.island_of_tri, tri_pos.mean(1))
        self.centroid /= self.tri_counts[:, None]
        self.area = np.bincount(self.island_of_tri, weights=triangle_areas(corners.pos), minlength=self.count)
        corner_island = np.repeat(self.island_of_tri, 3)
        radial = np.hypot(corners.pos[:, 0], corners.pos[:, 2])
        order = np.lexsort((radial, corner_island))
        first = np.searchsorted(corner_island[order], np.arange(self.count))
        self.base = corners.pos[order[first]].astype(np.float64)
        self.order = np.argsort(morton(self.centroid), kind="stable")

    def tri_mask(self, island_mask):
        return island_mask[self.island_of_tri]


def pick_evenly(order, cost, budget):
    lo, hi = 0.0, 1.0
    chosen = np.ones(len(order), bool)
    if cost[order].sum() <= budget:
        return order
    for _ in range(30):
        f = (lo + hi) / 2
        k = np.arange(len(order))
        keep = np.floor((k + 1) * f) > np.floor(k * f)
        if cost[order][keep].sum() <= budget:
            lo, chosen = f, keep
        else:
            hi = f
    return order[chosen]


def enlarge(corners, isl, kept_mask, area_all, area_kept, max_scale):
    s = min(np.sqrt(area_all / max(area_kept, 1e-9)), max_scale)
    corner_island = np.repeat(isl.island_of_tri, 3)
    base = isl.base[corner_island]
    pos = (base + s * (corners.pos - base)).astype(np.float32)
    return Corners(pos, corners.nor, corners.uv, corners.mat), s


def thin(corners, budget, max_scale=3.0):
    isl = Islands(corners)
    if corners.tris <= budget:
        return corners, 1.0
    keep_islands = pick_evenly(isl.order, isl.tri_counts.astype(np.float64), budget)
    mask = np.zeros(isl.count, bool)
    mask[keep_islands] = True
    kept = corners.take(isl.tri_mask(mask))
    sub = Islands(kept)
    out, s = enlarge(kept, sub, mask, isl.area.sum(), isl.area[mask].sum(), max_scale)
    return out, s


def fit_quads(corners):
    isl = Islands(corners)
    tri_order = np.argsort(isl.island_of_tri, kind="stable")
    starts = np.searchsorted(isl.island_of_tri[tri_order], np.arange(isl.count + 1))
    quads = []
    areas = np.zeros(isl.count)
    quality = np.zeros(isl.count)
    for i in range(isl.count):
        tris = tri_order[starts[i]:starts[i + 1]]
        idx = (tris[:, None] * 3 + np.arange(3)).ravel()
        uv, pos = corners.uv[idx].astype(np.float64), corners.pos[idx].astype(np.float64)
        design = np.concatenate([np.ones((len(uv), 1)), uv], axis=1)
        coef, *_ = np.linalg.lstsq(design, pos, rcond=None)
        resid = np.linalg.norm(design @ coef - pos, axis=1)
        extent = np.linalg.norm(pos.max(0) - pos.min(0)) + 1e-9
        quality[i] = resid.mean() / extent
        lo, hi = uv.min(0), uv.max(0)
        corners_uv = np.array([[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]])
        corner_pos = np.concatenate([np.ones((4, 1)), corners_uv], axis=1) @ coef
        normal = corners.nor[idx].astype(np.float64).mean(0)
        normal /= max(np.linalg.norm(normal), 1e-9)
        edge_u, edge_v = corner_pos[1] - corner_pos[0], corner_pos[3] - corner_pos[0]
        areas[i] = np.linalg.norm(np.cross(edge_u, edge_v))
        quads.append((corner_pos, corners_uv, normal, int(corners.mat[tris[0]])))
    return isl, quads, areas, quality


def quads_to_corners(quads, selected, scale_about=None, scale=1.0):
    pos, nor, uv, mat = [], [], [], []
    for i in selected:
        cp, cuv, n, m = quads[i]
        if scale_about is not None:
            cp = scale_about[i] + scale * (cp - scale_about[i])
        geometric = np.cross(cp[1] - cp[0], cp[3] - cp[0])
        tris = ((0, 1, 2), (0, 2, 3)) if geometric @ n >= 0 else ((0, 2, 1), (0, 3, 2))
        for tri in tris:
            for k in tri:
                pos.append(cp[k])
                nor.append(n)
                uv.append(cuv[k])
            mat.append(m)
    return Corners(np.array(pos, np.float32), np.array(nor, np.float32), np.array(uv, np.float32), np.array(mat))


def thin_islands(corners, budget):
    isl = Islands(corners)
    chosen = pick_evenly(isl.order, isl.tri_counts.astype(np.float64), budget)
    mask = np.zeros(isl.count, bool)
    mask[chosen] = True
    return corners.take(isl.tri_mask(mask))


class QuadSet:
    def __init__(self, corners, planar_limit=0.05, area_limit=3.0):
        self.corners = corners
        self.isl, self.quads, self.areas, quality = fit_quads(corners)
        self.flat = (quality <= planar_limit) & (self.areas <= area_limit * self.isl.area)

    def select(self, budget, max_scale=3.0):
        isl = self.isl
        flat_ids = isl.order[self.flat[isl.order]]
        chosen_flat = pick_evenly(flat_ids, np.full(isl.count, 2.0), budget)
        left = budget - 2.0 * len(chosen_flat)
        rest_ids = isl.order[~self.flat[isl.order]]
        chosen_rest = pick_evenly(rest_ids, isl.tri_counts.astype(np.float64), left) if left > 0 and len(rest_ids) else rest_ids[:0]
        chosen = np.concatenate([chosen_flat, chosen_rest]).astype(int)
        mask = np.zeros(isl.count, bool)
        mask[chosen] = True
        s = min(np.sqrt(self.areas.sum() / max(self.areas[mask].sum(), 1e-9)), max_scale)
        centres = np.array([q[0].mean(0) for q in self.quads])
        out = [quads_to_corners(self.quads, [i for i in chosen if self.flat[i]], centres, s)]
        rest = mask & ~self.flat
        if rest.any():
            kept = self.corners.take(isl.tri_mask(rest))
            enlarged, _ = enlarge(kept, Islands(kept), rest, self.areas.sum(), self.areas[mask].sum(), max_scale)
            out.append(enlarged)
        return Corners.concat(out), s
