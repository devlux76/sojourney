"""Author terrain substrate classes from the original USGS SIM 2832 coverage.

Run with the geospatial Python environment used by ground_structure.py.
The cached sim2832_geology.gpkg has a displaced projection; read ArcInfo PAL
polygons with their original NAD27 Oregon South CRS instead. The output is the
splat map's alpha channel, leaving its RGB layer weights and binding unchanged.
"""
from pathlib import Path

import geopandas as gpd
import numpy as np
from PIL import Image
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely.geometry import Point, box

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "tools/.cache/reference/crater-lake/layers/geology_sim2832/unz/crater-lake"
OUTPUT = ROOT / "assets/crater-lake/ground/structure/geology.png"
SIZE = 4096
METRES = 18000
ORIGIN = (569609.0, 4754367.0)
# Dark glassy lava, cinder, Pumice Castle deposits, pale loose deposits,
# neutral rock. Shader palette order lives in TerrainMaterial.ts.
SUBSTRATE = {
    "rh": 0, "rhc": 0, "rcc": 0, "rpb": 0,
    "awp": 64,
    "dcp": 128,
    "cp": 192, "cb": 192, "cf": 192, "cu": 192, "t": 192, "g": 192,
}
# Independent surveyed landmarks catch the north-displaced cached conversion
# before it can silently paint the wrong rocks into the game.
ANCHORS = [("Wizard Island cinder", 0, 0, "awp"),
           ("Phantom Ship andesite", 4543, -3027, "apn")]


def build():
    west, north = ORIGIN[0] - METRES / 2, ORIGIN[1] + METRES / 2
    extent = box(west, north - METRES, west + METRES, north)
    shapes, found = [], set()
    sources = sorted(SOURCE.glob("*/geo"))
    if not sources:
        raise FileNotFoundError(f"Extract the original USGS crater-lake.zip coverage under {SOURCE}")
    for source in sources:
        units = gpd.read_file(source, layer="PAL").to_crs(26910)
        units = units[units.geometry.intersects(extent)]
        for _, unit in units.iterrows():
            if not isinstance(unit.PTYPE, str):
                continue
            for name, x, z, expected in ANCHORS:
                if unit.PTYPE == expected and unit.geometry.covers(Point(ORIGIN[0] + x, ORIGIN[1] + z)):
                    found.add(name)
            shapes.append((unit.geometry, SUBSTRATE.get(unit.PTYPE.rstrip("?"), 255)))
    missing = {name for name, *_ in ANCHORS} - found
    if missing:
        raise ValueError(f"USGS geological registration failed at {sorted(missing)}")
    classes = rasterize(shapes, out_shape=(SIZE, SIZE),
                        transform=from_origin(west, north, METRES / SIZE, METRES / SIZE),
                        fill=255, dtype=np.uint8)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(classes).save(OUTPUT)
    print(f"Registered {len(shapes)} USGS polygons; anchors verified: {sorted(found)}")
    print("Substrate texels:", dict(zip(*np.unique(classes, return_counts=True))))
    return classes


if __name__ == "__main__":
    build()
