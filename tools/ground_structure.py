"""Stage what the ground is made of, from survey data, as whole-map masks for tools/ground_splat.py.

Usage: uv run --quiet --with numpy --with scipy --with pillow --with rasterio --with geopandas --with pyogrio python tools/ground_structure.py

Reads the reference layers under tools/.cache/reference/crater-lake/layers (see
docs/research/crater-lake-reference-imagery.md) and writes 8-bit masks, north up and one texel per
splat-map texel, into assets/crater-lake/ground/structure/:

  canopy.png  share of each texel under tree crowns, from the 2010 lidar canopy-height grid
  pumice.png  the vegetation map's "Pumice/Sand" unit (the Pumice Desert and other open flats)
  scree.png   the vegetation map's "Cliff, Scree & Rock Vegetation" unit
  island.png  land surrounded by the lake (Wizard Island, Phantom Ship)

Both layers are in NAD83 / UTM 10N, the projection of the terrain, so a map position is an offset
from the world origin and nothing is reprojected.
"""
import pathlib

import geopandas as gpd
import numpy as np
import rasterio
from PIL import Image
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.windows import Window
from scipy import ndimage

from ground_splat import SIZE
from heightfield import SIZE_METRES, in_lake

LAYERS = pathlib.Path("tools/.cache/reference/crater-lake/layers")
CANOPY = LAYERS / "lidar_dogami2010_nps/canopyheight_dm_uint16.tif"
VEGETATION = LAYERS / "vegetation_vmi/crla_vegmap.gpkg"
OUT = pathlib.Path("assets/crater-lake/ground/structure")

# The world origin (Wizard Island summit) in NAD83 / UTM 10N, as in tools/build_heightmap.py.
ORIGIN_E, ORIGIN_N = 569609.0, 4754367.0
WEST, NORTH = ORIGIN_E - SIZE_METRES / 2, ORIGIN_N + SIZE_METRES / 2
TEXEL = SIZE_METRES / SIZE
# The canopy grid stores tenths of a foot. Anything taller than 2 m counts as a tree crown, which
# leaves out shrubs, boulders and the survey's noise over bare scree.
CROWN_TENTHS_OF_FEET = 2.0 / 0.3048 * 10
NO_DATA = 65535
STRIP = 128


def save(name, mask):
    Image.fromarray(np.clip(mask * 255, 0, 255).round().astype(np.uint8), "L").save(OUT / name)
    print(f"{name}: mean {mask.mean():.3f}")


def canopy_cover():
    cover = np.zeros((SIZE, SIZE), dtype=np.float32)
    with rasterio.open(CANOPY) as src:
        cell = src.res[0]
        col0 = (WEST - src.bounds.left) / cell
        cols = SIZE_METRES / cell
        for row in range(0, SIZE, STRIP):
            top = (src.bounds.top - (NORTH - row * TEXEL)) / cell
            window = Window(round(col0), round(top), round(cols), round(STRIP * TEXEL / cell))
            heights = src.read(1, window=window)
            crowns = ((heights > CROWN_TENTHS_OF_FEET) & (heights != NO_DATA)).astype(np.float32)
            # A box filter gives each texel the share of the ~23 survey cells in it that are crown.
            cover[row:row + STRIP] = np.asarray(Image.fromarray(crowns).resize((SIZE, STRIP), Image.BOX))
    return cover


def vegetation_unit(units, name):
    shapes = units[units.Primary_MapUnit == name].geometry
    return rasterize(shapes, out_shape=(SIZE, SIZE), transform=from_origin(WEST, NORTH, TEXEL, TEXEL),
                     all_touched=True, dtype=np.uint8).astype(np.float32)


def islands():
    centres = (np.arange(SIZE) + 0.5) * TEXEL - SIZE_METRES / 2
    X, Z = np.meshgrid(centres, centres[::-1])
    land, _ = ndimage.label(~in_lake(X, Z))
    # The mainland is the land that reaches the edge of the map; every other piece is an island.
    mainland = land[0, 0]
    return ((land != 0) & (land != mainland)).astype(np.float32)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    save("canopy.png", canopy_cover())
    units = gpd.read_file(VEGETATION, layer="CRLA_VegMap_Final", engine="pyogrio")
    save("pumice.png", vegetation_unit(units, "Pumice/Sand"))
    save("scree.png", vegetation_unit(units, "Cliff, Scree & Rock Vegetation"))
    save("island.png", islands())


if __name__ == "__main__":
    main()
