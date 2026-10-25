# Crater Lake terrain from USGS Data Series 716 — design

Date: 2026-10-02. Replaces the 10 m DEM + 4 km bathymetry tile as the ground's source.

## Source

USGS Data Series 716 (Robinson, 2012): a 1 m mosaic of the August–September 2010 lidar (bare earth) and
the July 2000 multibeam bathymetry. https://pubs.usgs.gov/ds/716/ — US Government work, access
constraints "None". NAD83 UTM zone 10N (EPSG:26910), NAVD88 metres, 36415 × 28359 cells, float32.

Measured against the current map (18 km square around Wizard Island):

- It covers the whole square. 0.109% of cells are empty, all in a thin ring of shallow water between
  the lidar shoreline and the sonar edge (median width 3.5 m, 99th percentile 35 m, maximum 74 m).
- The lidar shoreline sits at 1882.26 m (median); the game used 1882.0.
- World origin (Wizard Island summit) in DS 716 coordinates: (569609.0, 4754367.0), fitted on land to
  about ±3 m. The old 10 m land DEM and the old bathymetry tile disagree with each other by about 10 m;
  DS 716 is used for both land and lake floor, so that disagreement goes away.
- Outside the old 4 km tile the old lake floor was flat and about 50 m too high on average.
- Wall zone (land within 1.5 km of the shore): the share steeper than 75° rises from 0.11% to 0.70%.
  A 2 m mesh reproduces the 1 m surface to 0.21 m RMS, 4 m to 0.46 m, 10 m to 1.11 m.

## Decisions

1. **One source surface at 2 m.** `tools/build_heightmap.py` cuts the 18 km window from DS 716 and
   writes one 9001² grid to `assets/crater-lake/terrain/source/`. The empty shoreline ring is filled by
   interpolating between the lidar shore and the sonar edge. `tools/heightfield.py` samples that one
   grid; the separate bathymetry tile and its blend are removed. The 1 m window stays in
   `tools/.cache/ds716/` for baking.
2. **Lake level 1882.25 m.** `LAKE_SURFACE_ELEVATION` moves to the lidar shoreline so the water meets
   the shore.
3. **A lake mask ships in the pack.** The lake is the flood-filled water body, not "everything below
   the lake level"; land outside the caldera that lies lower is dry. Every `WATER_Y` test in the engine
   uses the mask.
4. **Mesh step chosen per tile by error.** Each tile takes the coarsest step from 2, 4, 8, 16 m whose
   error against the 2 m source stays inside a budget, so walls, the island and the shore get 2 m and
   gentle flanks and the deep lake floor get less. LOD levels and skirts work as they do now.
5. **Collision follows the mesh.** Height grids ship per tile at the tile's own step; the engine keeps
   Havok height-field shapes for the tiles near the player and drops the rest.
6. **A baked normal map carries the detail at distance.** The far wall is drawn with coarse LOD
   levels, so its shading comes from a whole-map normal map baked from the 1 m surface, sampled by the
   ground material alongside the splat map.
7. **Map size stays 18 km for now.** The data covers 28 × 36 km, the whole park; the window size is a
   single constant in the pipeline.

## Order of work

1. Source grid, gap fill, lake level, lake mask, `heightfield.py`.
2. Adaptive tiles, per-tile collision, engine loader, lake mask in the engine; rebuild ground and flora.
3. Baked normal map in the ground material.
4. Then the handoff's ground painting from structure (cliff, talus, forest floor, snow).

## Verification

- Numeric: the built source matches DS 716 within resampling error; no empty cells; shoreline at 0 m.
- Hillshades of Llao Rock, Hillman Peak and the south rim from the built source, beside the old ones.
- In game: the rim viewpoint (80, y, −2960) comparison shot against the rim reference photo, the
  Cleetwood Cove trail view against its reference photo, a walk across a tile boundary between two
  different steps (no cracks, feet on the ground), and frame rate against the 13.4 fps baseline.
- Running outside the rim to (−3000, −6000): dry land, no underwater fog, no swimming.
