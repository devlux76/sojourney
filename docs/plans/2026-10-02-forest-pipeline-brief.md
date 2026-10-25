# Brief: the forest, pipeline half

Do this work yourself, in this session. Repo: `/home/mirai/projects/sojourney`, in place on `main`.
Do not commit, branch, or start/stop any server. Do not ask the user anything: choose, and say what you
chose in the report. Read `AGENTS.md` first; its rules bind. **Another session is editing TypeScript
under `src/` right now (the boat tour). In this job touch no file under `src/` except to add types to
`src/engine/pack.ts`, and do not run `bun run typecheck` to judge your own work: it may fail because of
the other session's half-finished edits.** Python tools only.

## What to build

The pipeline side of `docs/specs/2026-10-02-forest-from-canopy-design.md`. Read it all; the sections
"Decisions" and "The pack, as the engine will read it" are what you are building to. In short: real
trees over the whole map from the lidar canopy grid (position and height of every crown), with species
from the vegetation map; rocks and shrubs over the whole map by today's rules; everything written per
ground leaf in compact records; a thinned middle-band set per leaf; lighter second and third tree
levels; the fixed cull distances replaced by a size per species.

The engine still reads the old files until the second half of this work lands, so **leave
`flora/flora.json` and `flora/placements.bin` working as they are** and write the new files beside
them (a new manifest name, e.g. `flora/forest.json`, and a folder of per-leaf files). The tree models
(`fir.glb`, `pine.glb`) keep their mesh names and level count, so rebuilding them lighter is safe.

## You may change only

Python files under `tools/` whose names start with `flora_` or `build_flora`, plus new tools you add
for this job; `src/engine/pack.ts` (types only); new files under `public/packs/crater-lake/flora/`
(and `fir.glb` / `pine.glb` there when rebuilt lighter); `public/packs/crater-lake/files.json` (only by
running `python3 tools/build_pack_index.py crater-lake`); `CREDITS.md`; `LICENSING-TODO.md`. Nothing
else: no ground, prop or route file, no config, no dependencies. Do not start, stop, restart or install
anything, and run no server, browser or model.

## Where to look

- `tools/build_flora.py` (entry point; `LOD_DISTANCES`, `CULL`, cells), `tools/flora_place.py` (today's
  seeded scatter in a 1.2 km square, zone rules from `src/biomes/crater-lake/index.ts`),
  `tools/flora_models.py` (`TREE_TOTAL` level budgets; Blender decimation, slow), `tools/flora_glb.py`.
- `tools/ground_structure.py` — already reads the canopy grid
  (`tools/.cache/reference/crater-lake/layers/lidar_dogami2010_nps/canopyheight_dm_uint16.tif`, 0.91 m
  cells, 1.1 GB: read it in strips) and the vegetation map (`vegetation_vmi/crla_vegmap.gpkg`), with
  the world origin and the `uv run --with …` line it needs. Heights are stored as tenths of a foot; the
  forest spec says the unit is unconfirmed — check it against the metadata in that folder and say what
  you found.
- `tools/ground_quadtree.py`, `tools/build_ground.py` and `public/packs/crater-lake/ground/ground.json`
  — the leaves (1,311 of them, 250–2000 m) whose ids the per-leaf files must use.
- `tools/heightfield.py` — ground height, slope, lake mask.
- `src/engine/pack.ts` — the pack contract; add the new manifest's types here with comments, since the
  engine half will be written against them. `src/engine/flora.ts` shows how placements are used today
  (16-float matrices, trunk colliders, rock seats, felling) so the records carry what it needs.
- `tools/build_pack_index.py crater-lake` must be re-run after adding pack files.
- `CREDITS.md`, `LICENSING-TODO.md` — the canopy grid and vegetation map are US Government data
  (public domain, credit only); make sure both are credited.

## Things to keep in mind

- About 3 million trees: the tool must stream and be re-runnable in minutes, not hold everything in
  one array of matrices. Give it a way to build one area only, for quick checks.
- Crown tops are local maxima of the canopy grid; one tree per crown, not one per cell. Check the
  counts against the table in the spec (for example about 5,400 trees per km² and a 21 m median on
  Wizard Island) and report yours.
- Trees must not stand in the lake, on the piers, or on the caldera's bare cliffs where the grid shows
  no crowns. The two tree models are about 20 m tall; scale each tree to its measured height.
- Never run a bare `python3 tools/build_props.py`; nothing in this job needs the props tool.

## Report

Files changed with a sentence each; the record layout; totals (trees, rocks, shrubs, middle-band
cards, bytes on disk); tree counts per km² at the five places in the spec's table; the new level
triangle counts; how long a full run takes; anything you could not do.
