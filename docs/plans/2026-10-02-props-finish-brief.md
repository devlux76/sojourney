# Brief: finish and check the pier and ship props (for an opencode delegate)

Delegate with `~/.claude/skills/delegate-to-opencode/delegate.sh --model opencode/muse-spark-1.3-contributor-free`
(or `opencode/mimo-v2.6-flash-free`). The lead reviews the previews and the diff afterwards.

Repo: `/home/mirai/projects/sojourney`. Work in place on `main`. Do not commit. Do not create branches. Do not
start, stop, restart or install anything (no servers, no ollama, no dev server). Do not ask the user anything: if
unsure, pick the obvious default and note it in the report.

## State

`tools/build_props.py` builds the Crater Lake props into `public/packs/crater-lake/props/` and writes `props.json`.
All three props are built: `stone_fire_pit` (in use by the campfire, verified in game), `modular_wooden_pier`
(29 MB; LOD triangles 154370 / 25423 / 6235 / 1289) and `dutch_ship_medium` (37 MB; 69162 / 17999 / 4499 / 898).
The pier and the ship have **not been looked at by anyone**: there are no preview renders, and their `props.json`
numbers (origins, deck heights, walk boxes, blockers) are unchecked. `CREDITS.md` has no rows for them.

## You may edit only

`tools/build_props.py`, `CREDITS.md`, files under `public/packs/crater-lake/props/`, and scratch files under
`tools/.cache/`. Nothing under `src/`. Do not run `tools/build_ground.py` or `tools/build_flora.py`. Do not rebuild
`stone_fire_pit` (its md5 must not change; print it before and after). Comment the code you change (what and why).
Python via `python3`, or `uv run --with <pkg> python` for missing packages; JS tools via `bun` / `bun x` only.

## Tasks

1. **Previews.** With Blender in background mode (see how `tools/flora_models.py` invokes it), import each prop's
   staged pre-meshopt GLB (the path `build_props.py` writes under `tools/.cache/`) and render 1280x720 PNGs into
   `tools/.cache/props_preview/`: `pier_side.png`, `pier_top.png`, `pier_far_side.png` (cheapest LOD),
   `ship_side.png`, `ship_top.png`, `ship_far_side.png`. In each, add a 1.8 m tall, 0.5 m wide box standing on
   the deck for scale, and a flat plane for the water: at y = 0 for the ship, at y = -1.0 for the pier.
2. **Check the conventions against the renders and the mesh, and fix `build_props.py` if they are wrong:**
   - pier: origin at the shore end of the deck, centred across the width, y = 0 at the top of the deck, running
     along +z; poles reach at least 8 m below the deck;
   - ship: origin at the hull centre, y = 0 at the waterline (about a third of the hull depth above the keel),
     bow along +z; the cheapest LOD still shows the masts;
   - `props.json` `walk` boxes lie on the real deck surfaces (sample the mesh top surface to confirm), and the
     ship's rail/hull `blockers` enclose the deck.
3. **Pier weight.** LOD0 is 154,370 triangles for a ~25 m walkway. List the kit modules used with their triangle
   counts and say whether LOD0 can drop (for example by using LOD1 as the walking level) without visible loss at
   2 m viewing distance. Do not change it; recommend.
4. **Credits.** In the Poly Haven table of `CREDITS.md` add, in the existing style:
   `public/packs/crater-lake/props/modular_wooden_pier.glb` → [Modular Wooden Pier](https://polyhaven.com/a/modular_wooden_pier) by Rico Cilliers, CC0;
   `public/packs/crater-lake/props/dutch_ship_medium.glb` → [Dutch Ship Medium](https://polyhaven.com/a/dutch_ship_medium), CC0, with the
   author from `https://api.polyhaven.com/info/dutch_ship_medium` (send `User-Agent: sojourney-packsmith`).
5. `bun tools/check_glb.ts <staged.glb>` for the pier and the ship; paste the output.

## Report

Numbers measured (deck heights, waterline, mast height, bounds), what you changed and why, the six preview
paths with one honest sentence each on what they show, the pier recommendation, md5 of the pit before/after,
and anything you could not do.
