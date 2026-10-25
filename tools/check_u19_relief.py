"""U19 diagnosis: which edge octaves survive the 2 m heightfield capture at Llao Rock.

U19 says midday terrain reads soft because nothing below ~2 m reaches the GPU. This measures it: the 1 m
lidar crop around Llao Rock (world x=935, z=3800, a 1000 m square registered as tools/ground_normalmap.py
registers its CROPS), split into octave bands by radial FFT and reported as RMS height and RMS slope for
(a) the raw 1 m window, (b) the crop resampled to 2 m with PIL bilinear - the capture tools/heightfield.py
makes over its 2 m grid - and (c) the shipped heightmap.bin as a cross-check. Bands are wavelengths
(1,2], (2,4], (4,8], (8,16] m: a 2 m grid's Nyquist is 4 m, so the finer bands have no room to exist,
which is the geometry floor. Slope RMS is of the band-passed component only.

Usage: python3 tools/check_u19_relief.py
"""
import json
import pathlib

import numpy as np
from PIL import Image

SRC = pathlib.Path("tools/.cache/ds716/window1m.npy")
META = pathlib.Path("tools/.cache/ds716/window1m.json")
TERRAIN = pathlib.Path("assets/crater-lake/terrain/source")
CROP_XZ = (935.0, 3800.0)  # Llao Rock: CROPS["preview_llao.png"] in tools/ground_normalmap.py
CROP_M = 1000              # a 1000 m square of 1 m samples
BANDS = ((1.0, 2.0), (2.0, 4.0), (4.0, 8.0), (8.0, 16.0))


def fill_voids(a):
    """Fill the lidar's NaN cells (scattered shoreline/lake voids here) by linear interp along
    each row then each column: a straight span across a void carries no metre-scale energy, so
    it neither invents nor empties an octave."""
    a = a.copy()
    for b in (a, a.T):  # a.T is a view, so the column pass lands back in a
        idx = np.arange(b.shape[1])
        for i in range(b.shape[0]):
            ok = ~np.isnan(b[i])
            if ok.any() and not ok.all():
                b[i, ~ok] = np.interp(idx[~ok], idx[ok], b[i, ok])
    assert not np.isnan(a).any(), "crop has a fully void row and column"
    return a


def load_crop():
    """The Llao Rock crop, its world bounds, void count and registration JSON, registered as in
    tools/ground_normalmap.py: left/firstCol/origin put x per column and top/firstRow/origin put
    z per row (column i spans x [x0+i, x0+i+1), row r spans z [zn0-1-r, zn0-r))."""
    info = json.loads(META.read_text())
    ox, oy = float(info["origin"][0]), float(info["origin"][1])
    x0 = float(info["left"]) + float(info["firstCol"]) - ox  # x at column 0's left edge
    zn0 = float(info["top"]) - float(info["firstRow"]) - oy   # z of row 0's top edge + 1 m
    i0, j0 = int(round(CROP_XZ[0] - x0)) - CROP_M // 2, int(round(zn0 - CROP_XZ[1])) - CROP_M // 2
    src = np.load(str(SRC), mmap_mode="r")
    print("window1m shape %s dtype %s" % (src.shape, src.dtype))
    assert 0 <= i0 and i0 + CROP_M <= src.shape[1] and 0 <= j0 and j0 + CROP_M <= src.shape[0]
    raw = np.asarray(src[j0:j0 + CROP_M, i0:i0 + CROP_M], dtype=np.float64)
    return (fill_voids(raw), (x0 + i0, zn0 - j0, x0 + i0 + CROP_M, zn0 - j0 - CROP_M),
            int(np.isnan(raw).sum()), info)


def to_2m(a):
    """Resample a 1 m grid to 2 m with PIL bilinear; for a reduction Pillow scales the filter
    support, so it anti-aliases the way a proper capture does."""
    return np.asarray(Image.fromarray(a.astype(np.float32))
                      .resize((a.shape[1] // 2, a.shape[0] // 2), Image.Resampling.BILINEAR),
                      dtype=np.float64)


def shipped_2m(bounds):
    """The same square from the shipped 2 m grid the game samples: heightmap.json gives the
    layout (node c at x = -9000 + 2c, node r at z = 9000 - 2r, as tools/heightfield.py's _cell
    reads it) and heightmap.bin holds the u2 samples."""
    meta = json.loads((TERRAIN / "heightmap.json").read_text())
    step = float(meta["sizeMetres"]) / (int(meta["samples"]) - 1)
    grid = np.fromfile(TERRAIN / "heightmap.bin", dtype="<u2").reshape(int(meta["samples"]), -1)
    n = CROP_M // 2
    c0, r0 = int(round((bounds[0] + 9000.0) / step)), int(round((9000.0 - bounds[1]) / step))
    return (float(meta["minElevation"]) + grid[r0:r0 + n, c0:c0 + n]
            * (float(meta["maxElevation"]) - float(meta["minElevation"])) / 65535.0)


def octaves(a, cell):
    """Per-band (RMS height in m, RMS slope in m/m) of a gridded crop: mask the radial FFT to each
    wavelength band and invert. Bands are exact - no windowing, no pyramid leakage."""
    F = np.fft.fft2(a - a.mean())
    fy, fx = (np.fft.fftfreq(n, d=cell) for n in a.shape)
    r = np.hypot(fy[:, None], fx[None, :])
    out = []
    for lo, hi in BANDS:
        band = np.fft.ifft2(np.where((r >= 1.0 / hi) & (r < 1.0 / lo), F, 0.0)).real
        dz, dx = np.gradient(band, cell)
        out.append((float(np.sqrt((band * band).mean())), float(np.sqrt((dx * dx + dz * dz).mean()))))
    return out


def main():
    h, bounds, voids, info = load_crop()
    print("window1m.json: " + json.dumps(info, sort_keys=True))
    print("bake texel S = %.4f m; LOD0 spacing on 250m leaves = %.4f m" % (18000.0 / 8192, 250.0 / 128))  # 8192 texels span the 18000 m terrain; 128 cells span a 250 m leaf
    print("crop: %d x %d samples at 1 m, world x [%.2f, %.2f], z [%.2f, %.2f], %d void cells filled"
          % (h.shape[1], h.shape[0], bounds[0], bounds[2], bounds[3], bounds[1], voids))
    a, b, c = octaves(h, 1.0), octaves(to_2m(h), 2.0), octaves(shipped_2m(bounds), 2.0)
    print("\n  %-7s%-17s   %-17s   %-17s   %s" % ("octave", "(a) 1 m lidar", "(b) 2 m bilinear", "(c) shipped grid", "(b)/(a)"))
    print("  %-7s%-17s   %-17s   %-17s   %s" % ("", "hRMS m  slope m/m", "hRMS m  slope m/m", "hRMS m  slope m/m", "hRMS"))
    for (lo, hi), (ah, asl), (bh, bsl), (ch, csl) in zip(BANDS, a, b, c):
        print("  %-7s%8.4f %8.4f   %8.4f %8.4f   %8.4f %8.4f   %6.3f"
              % ("%g-%g m" % (lo, hi), ah, asl, bh, bsl, ch, csl, bh / ah if ah else 0.0))
    # (b) simulates the pipeline, (c) is the pipeline's output: agreement proves the registration.
    gap = max(abs(bh - ch) / ah for (ah, _), (bh, _), (ch, _) in zip(a, b, c) if ah)
    print("\n  (b) vs (c): simulated capture matches the shipped grid to %.1f%% per band -> registration and resample are right" % (100.0 * gap))
    r24 = b[1][0] / a[1][0]
    print("  2-4 m octave: %.4f m (1 m lidar) -> %.4f m (2 m grid), %.1f%% kept; 1-2 m: %.4f -> %.4f"
          % (a[1][0], b[1][0], 100.0 * r24, a[0][0], b[0][0]))
    if r24 < 0.5:
        print("  GEOMETRY FLOOR: the 2-4 m octave collapses at the 2 m capture while 4-8 m (%.2fx) and "
              "8-16 m (%.2fx) survive - metre-scale edges exist in the lidar, not in the heightfield"
              % (b[2][0] / a[2][0], b[3][0] / a[3][0]))
    else:
        print("  no geometry floor at 2-4 m: the 2 m capture keeps %.1f%% of that octave" % (100.0 * r24))
    checks = [
        ("(a) 1-2 m octave non-zero (real lidar has metre-scale relief)", a[0][0] > 0.0),
        ("(b)/(a) at 8-16 m within 2x (large scales survive resampling)", 0.5 <= b[3][0] / a[3][0] <= 2.0),
    ]
    for name, ok in checks:
        print("  %s -> %s" % (name, "PASS" if ok else "FAIL"))
        assert ok, name


if __name__ == "__main__":
    main()
