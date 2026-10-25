"""Paint the ground's splat map from what is really there, not from noise.

The red, green and blue channels weigh the gravel, needles and soil layers; what is left of 1 is
bare rock. Slope comes from the lidar heightfield, and tree cover, the vegetation map's open
pumice and cliff-and-scree units and the islands come from the masks staged by
tools/ground_structure.py.
"""
import pathlib

import numpy as np
from PIL import Image, ImageFilter

from heightfield import SIZE_METRES, height, in_lake, slope

SIZE = 4096
STRUCTURE = pathlib.Path(__file__).resolve().parent.parent / "assets/crater-lake/ground/structure"
ROWS = 256
# Slopes as rise over run. The pale cover is glacial deposits (mixed rock, dirt and boulders)
# mantling everything gentle, and the dark is raw basalt left bare where it steepens: deposits
# start on ground as gentle as 0.40 (22 degrees) and bare rock takes over from 0.68 (34 degrees),
# finishing fast so a dike reads as a wall tearing through, not a stain (Gemini's sharpening).
CLIFF = (0.68, 0.84)
TALUS = (0.40, 0.50)
# Metres above the lake over which the pale shore of the caldera wall fades out, and how far from the
# water it can reach. Much of the land outside the caldera is lower than the lake and is not shore.
SHORE = (1.0, 3.0)
SHORE_REACH_TEXELS = 3
# Needle litter spreads a little beyond the crowns that drop it; the rest of a forest floor is soil.
LITTER_SPREAD_TEXELS = 1.5
LITTER_UNDER_FULL_CANOPY = 0.85


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mask(name, blur=0.0):
    path = STRUCTURE / name
    if not path.exists():
        raise SystemExit(f"{path} is missing: run tools/ground_structure.py first (see its docstring)")
    image = Image.open(path)
    if blur:
        image = image.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(image, dtype=np.float32) / 255


# Dark-rock sights that wear the lake bed's basalt above the waterline (world metres east/north
# of Wizard Island summit, from the GNIS points in tools/build_route.py): each is the circle the
# boat's stop sits in, so the rock the tour came to see is basalt and the scree around it stays pale.
# Pumice Castle is left out on purpose: it is orange pumice, a different fix.
BASALT_SIGHTS = [
    ((1059.9, 3711.7), 500.0),   # Llao Rock
    ((-948.4, 2454.0), 400.0),   # Devils Backbone
    ((4463.5, -3039.4), 250.0),  # Phantom Ship
]
# Only craggy faces go basalt; talus and scree (up to about 0.50) stay pale gravel.
BASALT_SLOPE = (0.70, 0.90)
# The white pumice waterline stays gravel: basalt starts where the shore band ends.
BASALT_HEIGHT = (1.0, 3.0)


def build_basalt_mask(path):
    """Bake where the dark basalt shows above the water: steep ground near the dark-rock sights."""
    xs = (np.arange(SIZE) + 0.5) / SIZE * SIZE_METRES - SIZE_METRES / 2
    h = np.empty((SIZE, SIZE), dtype=np.float32)
    s = np.empty((SIZE, SIZE), dtype=np.float32)
    for r in range(0, SIZE, ROWS):
        X, Z = np.meshgrid(xs, xs[::-1][r:r + ROWS])
        h[r:r + ROWS] = height(X, Z)
        s[r:r + ROWS] = slope(X, Z)
    steep = smoothstep(*BASALT_SLOPE, s) * smoothstep(*BASALT_HEIGHT, h)
    near = np.zeros((SIZE, SIZE), dtype=np.float32)
    centres = (np.arange(SIZE) + 0.5) / SIZE * SIZE_METRES - SIZE_METRES / 2
    X, Z = np.meshgrid(centres, centres[::-1])
    for (sx, sz), radius in BASALT_SIGHTS:
        dist = np.hypot(X - sx, Z - sz)
        near = np.maximum(near, 1 - smoothstep(radius * 0.7, radius, dist))
    mask = np.clip(near * steep, 0, 1)
    Image.fromarray((mask * 255).round().astype(np.uint8), "L").filter(
        ImageFilter.GaussianBlur(2)).save(path)
    return float(mask.mean())


def build_splatmap(path):
    xs = (np.arange(SIZE) + 0.5) / SIZE * SIZE_METRES - SIZE_METRES / 2
    h = np.empty((SIZE, SIZE), dtype=np.float32)
    s = np.empty((SIZE, SIZE), dtype=np.float32)
    lake = np.empty((SIZE, SIZE), dtype=bool)
    for r in range(0, SIZE, ROWS):
        X, Z = np.meshgrid(xs, xs[::-1][r:r + ROWS])
        h[r:r + ROWS] = height(X, Z)
        s[r:r + ROWS] = slope(X, Z)
        lake[r:r + ROWS] = in_lake(X, Z)

    canopy, pumice, scree, island = mask("canopy.png"), mask("pumice.png"), mask("scree.png"), mask("island.png")
    # Wizard Island has no pale ground: its steep cinder is dark, and what the vegetation map calls
    # pumice there is blocky lava, which is painted as rock.
    cliff = np.maximum(smoothstep(*CLIFF, s), island * pumice)
    loose = 1 - cliff
    talus = np.maximum(smoothstep(*TALUS, s), scree) * (1 - canopy)
    beside_lake = np.asarray(Image.fromarray(lake).convert("L").filter(ImageFilter.MaxFilter(2 * SHORE_REACH_TEXELS + 1))) > 0
    shore = (1 - smoothstep(*SHORE, h)) * beside_lake
    gravel = np.clip(np.maximum(np.maximum(talus, shore), pumice) * (1 - island), 0, 1) * loose
    # Scree bleeding: dark fragments break off the cliffs and trail down, so the talus just
    # below a crag carries tongues of bare rock instead of clean gravel. The blur spreads each
    # cliff about 25 m downhill in every direction; the (1 - cliff) gate keeps it off the crag
    # and the slope gate keeps it off the flat aprons, where a dike must cut clean (Gemini).
    # (GaussianBlur needs an 8-bit image, so the mask round-trips through one like mask() does.)
    fallen = np.asarray(Image.fromarray((cliff * 255).round().astype(np.uint8), "L").filter(
        ImageFilter.GaussianBlur(6)), dtype=np.float32) / 255
    bleed = np.clip(fallen * 1.5, 0, 1) * (1 - cliff) * loose * smoothstep(0.35, 0.50, s)
    gravel = np.clip(gravel * (1 - 0.6 * bleed), 0, 1)
    needles = mask("canopy.png", LITTER_SPREAD_TEXELS) * LITTER_UNDER_FULL_CANOPY * (loose - gravel)
    soil = loose - gravel - needles

    weights = np.stack([gravel, needles, soil], axis=-1)
    Image.fromarray((weights * 255).round().astype(np.uint8), "RGB").save(path)
    return [*weights.mean(axis=(0, 1)), 1 - weights.sum(axis=-1).mean()]


if __name__ == "__main__":
    # Repaints the pack's splat map on its own; tools/build_ground.py does the same as part of a full build.
    out = pathlib.Path(__file__).resolve().parent.parent / "public/packs/crater-lake/ground/splatmap.png"
    print("mean splat weights (gravel, needles, soil, rock):", *[f"{v:.3f}" for v in build_splatmap(out)])
