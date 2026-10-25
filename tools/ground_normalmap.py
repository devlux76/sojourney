"""Bake whole-map terrain normal + sky-visibility map from the 1 m DS716 window.

Usage: uv run --quiet --with numpy --with scipy --with pillow python tools/ground_normalmap.py

NaN cells (data voids in the shoreline ring and the lake floor) are filled by solving
Laplace's equation over them from their known neighbours, the same approach as
tools/build_heightmap.py, so voids interpolate smoothly instead of going flat.
"""
import json
import os
import pathlib
import resource
import time

import numpy as np
from PIL import Image
from scipy import sparse
from scipy.sparse.linalg import spsolve

SRC = pathlib.Path("tools/.cache/ds716/window1m.npy")
META = pathlib.Path("tools/.cache/ds716/window1m.json")
OUT = pathlib.Path("tools/.cache/ground_normalmap")
N_OUT = 8192
SPAN = 18000.0
S = SPAN / N_OUT
N_AO = 4500
STEP_AO = 4.0
DISTANCES = (8, 16, 24, 40, 64, 96, 144, 216, 320, 480)
CROPS = {
    "preview_llao.png": (935.0, 3800.0),
    "preview_hillman.png": (-1762.0, 1478.0),
    "preview_south_rim.png": (80.0, -2960.0),
}


def axis_weights(n_out, t0, step, u0, width):
    t_start = t0 + np.arange(n_out, dtype=np.float64) * step
    t_end = t_start + step
    c_lo = np.floor(t_start - u0 - 1).astype(np.int64) + 1
    c_hi = np.ceil(t_end - u0).astype(np.int64) - 1
    cnt = c_hi - c_lo + 1
    m = int(cnt.max())
    assert m <= width and int(cnt.min()) >= 1
    w = np.zeros((n_out, width), dtype=np.float64)
    for k in range(m):
        c = c_lo + k
        lo = np.maximum(t_start, u0 + c)
        hi = np.minimum(t_end, u0 + c + 1.0)
        w[:, k] = np.maximum(0.0, hi - lo)
    w /= w.sum(axis=1, keepdims=True)
    return c_lo, w, cnt


def locate_nans(src, h, w):
    rows, cols = [], []
    for r0 in range(0, h, 2000):
        m = np.isnan(np.asarray(src[r0:r0 + 2000]))
        rr, cc = np.nonzero(m)
        if rr.size:
            rows.append(rr + r0)
            cols.append(cc)
    if not rows:
        return np.empty(0, np.int64), np.empty(0, np.int64), np.empty(0, np.float32)
    fr = np.concatenate(rows).astype(np.int64)
    fc = np.concatenate(cols).astype(np.int64)
    fv = laplace_fill(src, fr, fc, h, w)
    return fr, fc, fv


def laplace_fill(src, fr, fc, h, w):
    n = fr.size
    pos = fr * w + fc
    degree = np.zeros(n, dtype=np.float64)
    rhs = np.zeros(n, dtype=np.float64)
    rows, cols = [], []
    for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        nr, nc = fr + dr, fc + dc
        on = (nr >= 0) & (nr < h) & (nc >= 0) & (nc < w)
        npos = np.where(on, nr * w + nc, -1)
        k = np.searchsorted(pos, npos)
        km = np.minimum(k, n - 1)
        hit = on & (k < n) & (pos[km] == npos)
        degree += on
        known = on & ~hit
        rhs[known] += np.asarray(src[nr[known], nc[known]], dtype=np.float64)
        rows.append(np.nonzero(hit)[0])
        cols.append(km[hit])
    r_all = np.concatenate(rows)
    c_all = np.concatenate(cols)
    system = sparse.csr_matrix((np.full(r_all.size, -1.0), (r_all, c_all)), shape=(n, n))
    system = system + sparse.diags(degree)
    fv = spsolve(system.tocsc(), rhs)
    if not np.all(np.isfinite(fv)):
        raise SystemExit("Laplace fill diverged; NaN regions may be isolated from all known cells")
    return fv.astype(np.float32)


def fill_block(src, e0, e1, fr, fc, fv):
    lo = int(np.searchsorted(fr, e0))
    hi = int(np.searchsorted(fr, e1))
    if hi == lo:
        return np.asarray(src[e0:e1], dtype=np.float32)
    ext = np.array(src[e0:e1], dtype=np.float32)
    ext[fr[lo:hi] - e0, fc[lo:hi]] = fv[lo:hi]
    return ext


def main():
    t0 = time.perf_counter()
    OUT.mkdir(parents=True, exist_ok=True)
    info = json.loads(META.read_text())
    print("window1m.json: " + json.dumps(info, sort_keys=True))
    ox, oy = float(info["origin"][0]), float(info["origin"][1])
    src = np.load(str(SRC), mmap_mode="r")
    H, W = int(src.shape[0]), int(src.shape[1])
    print("input shape: %d x %d dtype %s" % (H, W, src.dtype))
    fr, fc, fv = locate_nans(src, H, W)
    print("NaN count before fill: %d (%.4f%%)" % (fr.size, 100.0 * fr.size / (H * W)))
    X0 = float(info["left"]) + float(info["firstCol"]) - ox
    ZN0 = float(info["top"]) - float(info["firstRow"]) - oy
    print("registration from JSON: input col c spans x [%.4f, %.4f] + c, row r spans z [%.4f, %.4f] - r"
          % (X0, X0 + 1, ZN0 - 1, ZN0))
    print("output pixel (j, i) spans x [-9000 + i*S, -9000 + (i+1)*S], z [9000 - (j+1)*S, 9000 - j*S], S = %.6f" % S)
    acs, awc, accnt = axis_weights(N_AO, -9000.0, STEP_AO, X0, 6)
    ars, awr, arcnt = axis_weights(N_AO, -9000.0, STEP_AO, -ZN0, 6)
    arlo = ars
    arhi = ars + arcnt - 1
    aidx = np.clip(acs[:, None] + np.arange(6)[None, :], 0, W - 1)
    awcf = awc.astype(np.float32)
    hsum = np.zeros((N_AO, N_AO), dtype=np.float32)
    wsum = np.zeros((N_AO, N_AO), dtype=np.float32)
    M2 = 100
    NB2 = 1000
    r0 = 0
    while r0 < H:
        r1 = min(H, r0 + NB2)
        e0 = max(0, r0 - M2)
        e1 = min(H, r1 + M2)
        ext = fill_block(src, e0, e1, fr, fc, fv)
        nb = r1 - r0
        l0 = r0 - e0
        here = ext[l0:l0 + nb]
        T = np.zeros((nb, N_AO), dtype=np.float32)
        for k in range(6):
            T += awcf[None, :, k] * here[:, aidx[:, k]]
        del here, ext
        a_lo = max(0, int(np.searchsorted(arhi, r0, side="left")))
        a_hi = min(N_AO - 1, int(np.searchsorted(arlo, r1 - 1, side="right")) - 1)
        for a in range(a_lo, a_hi + 1):
            for k in range(int(arcnt[a])):
                rr = int(arlo[a]) + k - r0
                if 0 <= rr < nb:
                    hsum[a] += awr[a, k] * T[rr]
                    wsum[a] += awr[a, k]
        del T
        r0 = r1
    Hg = (hsum / np.maximum(wsum, 1e-12)).astype(np.float32)
    del hsum, wsum
    P = 120
    Hp = np.pad(Hg, P, mode="edge")
    vis = np.zeros((N_AO, N_AO), dtype=np.float32)
    for k in range(16):
        a = 2.0 * np.pi * k / 16.0
        e, nn = np.cos(a), np.sin(a)
        hor = np.zeros((N_AO, N_AO), dtype=np.float32)
        for d in DISTANCES:
            dc = int(round(e * d / STEP_AO))
            dr = int(round(-nn * d / STEP_AO))
            there = Hp[P + dr:P + dr + N_AO, P + dc:P + dc + N_AO]
            ang = np.arctan2(there - Hg, np.float32(d))
            np.maximum(hor, ang, out=hor)
        hor[hor < 0.0] = 0.0
        vis += 1.0 - np.sin(hor)
    vis /= 16.0
    vf = vis.astype(np.float64)
    print("visibility min/max/mean: %.4f %.4f %.5f" % (vf.min(), vf.max(), vf.mean()))
    del Hg, Hp, hor, vf
    cs, wc, ccnt = axis_weights(N_OUT, -9000.0, S, X0, 4)
    rs, wr, rcnt = axis_weights(N_OUT, -9000.0, S, -ZN0, 4)
    rlo = rs
    rhi = rs + rcnt - 1
    cidx = np.clip(cs[:, None] + np.arange(4)[None, :], 0, W - 1)
    wcf = wc.astype(np.float32)
    avg = np.zeros((N_OUT, N_OUT, 3), dtype=np.float32)
    M = 200
    NB = 800
    cols = np.arange(W)
    cm = np.clip(cols - 1, 0, W - 1)
    cp = np.clip(cols + 1, 0, W - 1)
    r0 = 0
    while r0 < H:
        r1 = min(H, r0 + NB)
        e0 = max(0, r0 - M)
        e1 = min(H, r1 + M)
        ext = fill_block(src, e0, e1, fr, fc, fv)
        E = ext.shape[0]
        l0 = r0 - e0
        loc = np.arange(l0, l0 + (r1 - r0))
        rm = np.clip(loc - 1, 0, E - 1)
        rp = np.clip(loc + 1, 0, E - 1)
        here = ext[loc]
        dzdx = (here[:, cp] - here[:, cm]) * 0.5
        dzds = (ext[rp][:, cols] - ext[rm][:, cols]) * 0.5
        dzdn = -dzds
        if r0 == 0:
            dzdn[0, :] = (ext[l0, :] - ext[l0 + 1, :]).astype(np.float64)
        if r1 == H:
            dzdn[-1, :] = (ext[E - 2, :] - ext[E - 1, :]).astype(np.float64)
        dzdx[:, 0] = here[:, 1] - here[:, 0]
        dzdx[:, -1] = here[:, -1] - here[:, -2]
        inv = 1.0 / np.sqrt(dzdx * dzdx + 1.0 + dzdn * dzdn)
        nrm = np.empty((r1 - r0, W, 3), dtype=np.float32)
        nrm[:, :, 0] = (-dzdx * inv).astype(np.float32)
        nrm[:, :, 1] = inv.astype(np.float32)
        nrm[:, :, 2] = (-dzdn * inv).astype(np.float32)
        nb = r1 - r0
        T = np.zeros((nb, N_OUT, 3), dtype=np.float32)
        for k in range(4):
            T += wcf[None, :, k, None] * nrm[:, cidx[:, k], :]
        del nrm
        j_lo = int(np.searchsorted(rhi, r0, side="left"))
        j_hi = int(np.searchsorted(rlo, r1 - 1, side="right")) - 1
        j_lo = max(0, j_lo)
        j_hi = min(N_OUT - 1, j_hi)
        for j in range(j_lo, j_hi + 1):
            for k in range(int(rcnt[j])):
                rr = int(rlo[j]) + k - r0
                if 0 <= rr < nb:
                    avg[j] += np.float32(wr[j, k]) * T[rr]
        del T, ext, here
        r0 = r1
    del src
    lng = np.sqrt(avg[:, :, 0] ** 2 + avg[:, :, 1] ** 2 + avg[:, :, 2] ** 2)
    avg /= lng[:, :, None]
    nx = avg[:, :, 0]
    ny = avg[:, :, 1]
    nz = avg[:, :, 2]
    print("nx min/max/mean: %.4f %.4f %.5f" % (nx.min(), nx.max(), nx.mean()))
    print("nz min/max/mean: %.4f %.4f %.5f" % (nz.min(), nz.max(), nz.mean()))
    print("ny min/max/mean: %.4f %.4f %.5f" % (ny.min(), ny.max(), ny.mean()))
    print("fraction ny < 0.5: %.6f; ny < 0.26: %.6f" % (float((ny < 0.5).mean()), float((ny < 0.26).mean())))
    ci = int(round((0.0 + 9000.0) / S))
    cj = int(round((9000.0 - 0.0) / S))
    blk = avg[cj - 1:cj + 2, ci - 1:ci + 2, :].reshape(-1, 3).mean(axis=0)
    blk = blk / np.linalg.norm(blk)
    print("Wizard Island summit normal at pixel (%d, %d): nx=%.5f ny=%.5f nz=%.5f" % (cj, ci, blk[0], blk[1], blk[2]))

    L = np.array([-0.5, 0.7, 0.5], dtype=np.float32)
    L = (L / np.linalg.norm(L)).astype(np.float32)
    shade = (np.clip(avg[:, :, 0] * L[0] + avg[:, :, 1] * L[1] + avg[:, :, 2] * L[2], 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)

    def w2p(x, z):
        return (x + 9000.0) / S, (9000.0 - z) / S

    def crop_of(arr, x, z):
        fi, fj = w2p(x, z)
        i0 = min(max(int(round(fi)) - 500, 0), N_OUT - 1000)
        j0 = min(max(int(round(fj)) - 500, 0), N_OUT - 1000)
        return arr[j0:j0 + 1000, i0:i0 + 1000], i0, j0

    Image.fromarray(shade).resize((2048, 2048), Image.BILINEAR).save(OUT / "preview_overview.png")
    south_crop = None
    for name, (x, z) in CROPS.items():
        c, i0, j0 = crop_of(shade, x, z)
        Image.fromarray(c).save(OUT / name)
        if name == "preview_south_rim.png":
            south_crop = (i0, j0)
    vis_big = np.asarray(Image.fromarray(vis, mode="F").resize((N_OUT, N_OUT), Image.BILINEAR), dtype=np.float32)
    del vis
    bbig = (np.clip(vis_big, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    i0, j0 = south_crop
    Image.fromarray(bbig[j0:j0 + 1000, i0:i0 + 1000]).save(OUT / "preview_ao_south_rim.png")
    R = (np.clip(nx * 0.5 + 0.5, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    G = (np.clip(nz * 0.5 + 0.5, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    rgb = np.dstack([R, G, bbig])
    Image.fromarray(rgb).save(OUT / "terrain_normal_ao.png")
    for (x, z, want, label) in [(80.0, -2700.0, "positive", "south wall below rim"), (935.0, 3600.0, "negative", "north wall below Llao Rock")]:
        fi, fj = w2p(x, z)
        ii, jj = int(round(fi)), int(round(fj))
        half = 22
        v = float(avg[jj - half:jj + half + 1, ii - half:ii + half + 1, 2].reshape(-1).mean())
        c = float(avg[jj, ii, 2])
        ok = (v > 0) if want == "positive" else (v < 0)
        print("sign check %s at world (%.0f, %.0f) pixel (%d, %d): centre nz = %+.5f, 45x45 block nz = %+.5f, want %s -> %s"
              % (label, x, z, jj, ii, c, v, want, "PASS" if ok else "FAIL"))
        assert ok
    del rgb, R, G, bbig, shade, vis_big
    dt = time.perf_counter() - t0
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
    print("run time: %.1f s; peak memory (ru_maxrss): %.1f MB" % (dt, rss))
    for name in ["terrain_normal_ao.png", "preview_overview.png"] + list(CROPS) + ["preview_ao_south_rim.png"]:
        print("%s: %.2f MB" % (name, os.path.getsize(OUT / name) / 1048576.0))


if __name__ == "__main__":
    main()
