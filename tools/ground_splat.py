"""Paint the ground's splat map from what is really there, not from noise.

The red, green and blue channels weigh the gravel, needles and soil layers; what is left of 1 is
bare rock. Slope comes from the lidar heightfield, and tree cover, the vegetation map's open
pumice and cliff-and-scree units and the islands come from the masks staged by
tools/ground_structure.py.
"""
import pathlib

import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import distance_transform_edt

from heightfield import SIZE_METRES, height, in_lake, slope

SIZE = 4096
STRUCTURE = pathlib.Path(__file__).resolve().parent.parent / "assets/crater-lake/ground/structure"
ROWS = 256
# Metres per splat texel (18 km over 4096 texels).
METRES_PER_TEXEL = SIZE_METRES / SIZE
# Texel-centre world coordinates, row 0 = north, matching the mask arrays.
_TEXEL = (np.arange(SIZE) + 0.5) / SIZE * SIZE_METRES - SIZE_METRES / 2
X_WORLD, Z_WORLD = np.meshgrid(_TEXEL, _TEXEL[::-1])
# Edge softening for the binary structure masks (scree, pumice, island). Their
# pixel-staircase edges otherwise go straight into the splat map as hard
# material boundaries. Each mask becomes a signed distance (metres) from its
# edge, that distance is jittered by fixed-seed value noise so real deposit
# margins read as irregular instead of map-polygon straight, and a smoothstep
# over +-EDGE_SOFTNESS_M turns it into a soft weight. The noise amplitude is
# small next to deposit scale, so only the contact zone moves and the mean
# weights stay essentially unchanged.
EDGE_SOFTNESS_M = 8.0        # half-width of the soft contact, in metres
NOISE_AMPLITUDE_M = 8.0      # summed edge jitter, in metres
NOISE_OCTAVES = (            # (wavelength m, amplitude m)
    (80.0, 3.0),
    (30.0, 3.0),
    (12.0, 2.0),
)
NOISE_SEED = 20261017        # fixed seed: deterministic rebuilds
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


def _hash_ij(i, j, seed):
    """Deterministic integer hash of a grid cell, in [0, 1)."""
    i = i.astype(np.uint64)
    j = j.astype(np.uint64)
    n = i * np.uint64(374761393) + j * np.uint64(668265263) + np.uint64(seed)
    n = n ^ (n >> np.uint64(13))
    n = n * np.uint64(1274126177)
    n = n ^ (n >> np.uint64(16))
    return n.astype(np.float64) / np.float64(18446744073709551616.0)


def _value_noise(x, y, octaves, seed):
    """Multi-octave value noise in world metres, deterministic given `seed`."""
    result = np.zeros_like(x, dtype=np.float64)
    for wavelength, amplitude in octaves:
        scale = 1.0 / float(wavelength)
        sx = x * scale
        sy = y * scale
        ix = np.floor(sx).astype(np.int64)
        iy = np.floor(sy).astype(np.int64)
        fx = sx - ix
        fy = sy - iy
        u = fx * fx * (3.0 - 2.0 * fx)
        v = fy * fy * (3.0 - 2.0 * fy)
        h00 = _hash_ij(ix, iy, seed)
        h10 = _hash_ij(ix + 1, iy, seed)
        h01 = _hash_ij(ix, iy + 1, seed)
        h11 = _hash_ij(ix + 1, iy + 1, seed)
        top = h00 * (1.0 - u) + h10 * u
        bottom = h01 * (1.0 - u) + h11 * u
        value = top * (1.0 - v) + bottom * v
        result += (value * 2.0 - 1.0) * float(amplitude)
    return result


def soften_mask(mask):
    """Turn a binary structure mask into a soft, irregularly-edged weight.

    The mask becomes a signed distance (metres) from its edge, jittered by
    fixed-seed value noise so deposit margins read as irregular rather than
    map-polygon straight, then a smoothstep over +-EDGE_SOFTNESS_M makes the
    contact soft. Deep inside or outside the mask the weight is unchanged;
    only the contact zone moves.
    """
    inside = distance_transform_edt(mask > 0.5)
    outside = distance_transform_edt(mask <= 0.5)
    signed = (inside - outside) * METRES_PER_TEXEL
    warped = signed + _value_noise(X_WORLD, Z_WORLD, NOISE_OCTAVES, NOISE_SEED)
    return smoothstep(-EDGE_SOFTNESS_M, EDGE_SOFTNESS_M, warped).astype(np.float32)


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
    # Soften the genuinely binary structure masks: their pixel-staircase edges
    # otherwise become hard material boundaries in the splat map. Canopy is
    # already blurred for litter; re-binarizing it via soften_mask would sharpen
    # its core edge and *add* hard edges, so the pre-existing soft blurred weight
    # is used for both the talus gate and the litter term (it is wide enough --
    # about 3 texels -- that neighbouring gravel stays under 0.5 apart).
    soft_scree = soften_mask(scree)
    soft_pumice = soften_mask(pumice)
    soft_island = soften_mask(island)
    canopy_soft = mask("canopy.png", LITTER_SPREAD_TEXELS)
    # Wizard Island has no pale ground: its steep cinder is dark, and what the vegetation map calls
    # pumice there is blocky lava, which is painted as rock.
    cliff = np.maximum(smoothstep(*CLIFF, s), soft_island * soft_pumice)
    loose = 1 - cliff
    talus = np.maximum(smoothstep(*TALUS, s), soft_scree) * (1 - canopy_soft)
    # Soft shore reach: 1 at the lake, fading to 0 over SHORE_REACH_TEXELS texels
    # from shore, with the reach distance jittered by noise so the reach boundary
    # is irregular instead of a MaxFilter rectangle.
    lake_dist = distance_transform_edt(~lake) * METRES_PER_TEXEL
    reach_m = SHORE_REACH_TEXELS * METRES_PER_TEXEL
    shore_jitter = _value_noise(
        X_WORLD, Z_WORLD, ((40.0, 1.0), (15.0, 0.8), (6.0, 0.5)), NOISE_SEED + 1)
    beside_lake = np.clip(
        1.0 - smoothstep(0.0, reach_m, lake_dist + shore_jitter), 0.0, 1.0).astype(np.float32)
    shore = (1 - smoothstep(*SHORE, h)) * beside_lake
    gravel = np.clip(np.maximum(np.maximum(talus, shore), soft_pumice) * (1 - soft_island), 0, 1) * loose
    # Scree bleeding: dark fragments break off the cliffs and trail down, so the talus just
    # below a crag carries tongues of bare rock instead of clean gravel. The blur spreads each
    # cliff about 25 m downhill in every direction; the (1 - cliff) gate keeps it off the crag
    # and the slope gate keeps it off the flat aprons, where a dike must cut clean (Gemini).
    # (GaussianBlur needs an 8-bit image, so the mask round-trips through one like mask() does.)
    fallen = np.asarray(Image.fromarray((cliff * 255).round().astype(np.uint8), "L").filter(
        ImageFilter.GaussianBlur(6)), dtype=np.float32) / 255
    bleed = np.clip(fallen * 1.5, 0, 1) * (1 - cliff) * loose * smoothstep(0.35, 0.50, s)
    gravel = np.clip(gravel * (1 - 0.6 * bleed), 0, 1)
    needles = canopy_soft * LITTER_UNDER_FULL_CANOPY * (loose - gravel)
    soil = loose - gravel - needles

    weights = np.stack([gravel, needles, soil], axis=-1)
    # Alpha carries mapped substrate, not transparency. Preserve the existing
    # RGB weights byte-for-byte and keep geology in the same runtime binding.
    geology = Image.open(STRUCTURE / "geology.png").convert("L")
    image = Image.fromarray((weights * 255).round().astype(np.uint8), "RGB")
    image.putalpha(geology)
    image.save(path)
    return [*weights.mean(axis=(0, 1)), 1 - weights.sum(axis=-1).mean()]


if __name__ == "__main__":
    # Repaints the pack's splat map on its own; tools/build_ground.py does the same as part of a full build.
    out = pathlib.Path(__file__).resolve().parent.parent / "public/packs/crater-lake/ground/splatmap.png"
    print("mean splat weights (gravel, needles, soil, rock):", *[f"{v:.3f}" for v in build_splatmap(out)])
