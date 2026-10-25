"""Derive guide-look aim targets from GNIS + heightfield. Read-only analysis."""
import json, pathlib, sys
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import heightfield as terrain
from build_heightmap import ORIGIN_UTM

ROOT = pathlib.Path(__file__).resolve().parent.parent
route = json.loads((ROOT / "public/packs/crater-lake/route/boat_tour.json").read_text())
pts = np.array(route["points"])
length = route["length"]

from pyproj import Transformer
to_utm = Transformer.from_crs("EPSG:4326", "EPSG:26910", always_xy=True)

def world_of(lon, lat):
    e, n = to_utm.transform(lon, lat)
    return np.array([e - ORIGIN_UTM[0], n - ORIGIN_UTM[1]])

def boat_at(dist):
    f = (dist / length) * len(pts)
    i0 = int(f) % len(pts)
    i1 = (i0 + 1) % len(pts)
    t = f - int(f)
    return pts[i0] * (1 - t) + pts[i1] * t

print(f"route length {length} m, {len(pts)} samples")
for s in route["sights"]:
    b = boat_at(s["distance"])
    print(f"sight {s['name']}: dist {s['distance']} boat=({b[0]:.0f},{b[1]:.0f}) lake={terrain.in_lake(b[0], b[1])} bed={terrain.height(b[0], b[1]):.0f}")
for d in route["docks"]:
    print(f"dock {d['name']}: dist {d['distance']} pos=({d['position'][0]:.0f},{d['position'][1]:.0f}) hdg={d['headingDegrees']}")

SIGHTS = {
    "Pumice Castle": (-122.05754, 42.92902),
    "Phantom Ship": (-122.09254, 42.91097),
    "Devils Backbone": (-122.15816, 42.96094),
    "Llao Rock": (-122.13338, 42.97208),
}
for name, (lon, lat) in SIGHTS.items():
    w = world_of(lon, lat)
    h = float(terrain.height(w[0], w[1]))
    print(f"{name}: world=({w[0]:.0f},{w[1]:.0f}) h={h:.0f} lake={bool(terrain.in_lake(w[0], w[1]))}")

# Wizard Island: summit = max height within 1.2km of water stop [0,530]
wx, wz = 0.0, 530.0
xs = np.arange(wx - 1200, wx + 1200, 20)
zs = np.arange(wz - 1200, wz + 1200, 20)
X, Z = np.meshgrid(xs, zs)
H = terrain.height(X, Z)
land = ~terrain.in_lake(X, Z)
Hland = np.where(land, H, -9999)
i = np.unravel_index(np.argmax(Hland), Hland.shape)
print(f"Wizard summit search: ({X[i]:.0f},{Z[i]:.0f}) h={Hland[i]:.0f}")

# profile boat->each GNIS to see wall face (for Pumice/Llao/Backbone band choice)
for name, (lon, lat) in SIGHTS.items():
    w = world_of(lon, lat)
    dist = next(s["distance"] for s in route["sights"] if s["name"] == name)
    b = boat_at(dist)
    for t in [0.55, 0.7, 0.85, 0.95, 1.0]:
        p = b + (w - b) * t
        print(f"  {name} t={t}: ({p[0]:.0f},{p[1]:.0f}) h={float(terrain.height(p[0], p[1])):.0f} lake={bool(terrain.in_lake(p[0], p[1]))}")
