import json

import numpy as np
from PIL import Image

SIZE = 2048
INFO = json.load(open("public/packs/crater-lake/terrain/heightmap.json"))
TERRAIN_SIZE = INFO["sizeMetres"]
RAISE = 18.0
rng = np.random.default_rng(7)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def noise(scales):
    out = np.zeros((SIZE, SIZE))
    for cells, weight in scales:
        grid = Image.fromarray((rng.random((cells, cells)) * 255).astype(np.uint8))
        out += weight * np.asarray(grid.resize((SIZE, SIZE), Image.BICUBIC), dtype=float) / 255
    return np.clip(out / sum(w for _, w in scales), 0, 1)


n = INFO["samples"]
raw = np.fromfile("public/packs/crater-lake/terrain/heightmap.bin", dtype="<u2").reshape(n, n).astype(np.float32)
elevation = INFO["minElevation"] + raw / 65535 * (INFO["maxElevation"] - INFO["minElevation"])
elevation = np.asarray(Image.fromarray(elevation, "F").resize((SIZE, SIZE), Image.BILINEAR), dtype=float)
h = elevation - INFO["lakeSurfaceElevation"] + RAISE
gy, gx = np.gradient(h, TERRAIN_SIZE / SIZE)
slope = np.hypot(gx, gy)

patches = noise([(12, 1.0), (40, 0.5), (120, 0.25)])

gentle = 1 - smoothstep(0.7, 1.0, slope)
outcrops = smoothstep(0.62, 0.75, noise([(30, 1.0), (90, 0.5), (250, 0.25)]))
low = 1 - smoothstep(34, 46, h)
shore = 1 - smoothstep(21, 25, h)
xs = (np.arange(SIZE) + 0.5) / SIZE * TERRAIN_SIZE - TERRAIN_SIZE / 2
island = 1 - smoothstep(650, 750, np.hypot(xs[None, :], xs[::-1, None]))
ground = np.maximum(gentle * (1 - outcrops), island)
forest = smoothstep(38, 48, h) * (1 - 0.7 * smoothstep(100, 250, h)) * (1 - smoothstep(255, 275, h)) * (1 - smoothstep(0.35, 0.6, slope))
needles = forest * smoothstep(0.3, 0.55, patches) * 0.6
gravel = np.maximum(shore, ground * low)
soil = ground * (1 - low) * (1 - needles)

weights = np.stack([gravel, needles, soil], axis=-1)
total = weights.sum(axis=-1, keepdims=True)
weights = np.where(total > 1, weights / np.maximum(total, 1e-6), weights)

Image.fromarray((weights * 255).round().astype(np.uint8), "RGB").save("public/packs/crater-lake/terrain/splatmap.png")
print("wrote public/packs/crater-lake/terrain/splatmap.png; mean weights (gravel, needles, soil, rock):",
      *[f"{v:.2f}" for v in [*weights.mean(axis=(0, 1)), 1 - weights.sum(axis=-1).mean()]])
