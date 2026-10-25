import json
import subprocess
from pathlib import Path

import numpy as np

import heightfield as terrain

ROOT = Path(__file__).resolve().parent.parent
SEED = 20261001
# The scatter the island had before the forest came from survey data: attempts in a square of this
# many metres. tools/build_forest.py keeps the same densities over the whole map.
SCATTER_ATTEMPTS = 15000
ROCK_ATTEMPTS = 40000
SCATTER_AREA = 1200.0
CLUSTER_AREA = 1480.0
TREE_ROOT_DEPTH = 0.8
TRUNK_RADIUS = 1.5


def load_flora():
    code = (f"import b from '{ROOT}/src/biomes/crater-lake/index.ts';"
            "console.log(JSON.stringify(b.flora,(k,v)=>v===Infinity?1e9:v))")
    out = subprocess.run(["bun", "-e", code], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def slope_old(x, z):
    h = terrain.height(x, z)
    hx, hz = terrain.height(x + 1, z), terrain.height(x, z + 1)
    return np.sqrt((hx - h) ** 2 + (hz - h) ** 2)


def zone_density(entry, elevation, slope):
    density = np.zeros(len(elevation))
    matched = np.zeros(len(elevation), bool)
    for z in entry["zones"]:
        m = ~matched & (elevation >= z["minElevation"]) & (elevation < z["maxElevation"]) & (slope < z["maxSlope"])
        density[m] = z["density"]
        matched |= m
    return density, matched
