# Brief: the boat tour

Do this work yourself, in this session. Repo: `/home/mirai/projects/sojourney`, in place on `main`.
Do not commit, branch, or start/stop any server. Bun only (`bun run typecheck`); never `npm`, `npx`,
`node`. Do not ask the user anything: choose, and say what you chose in the report. Do not revert or
tidy files you are not changing for this job. Read `AGENTS.md` first; its rules bind (Babylon as it
ships, checked against `node_modules/@babylonjs/`; comment the code you write; no feature flags).

## What to build

Everything under **Behaviour** and **Engine** in `docs/specs/2026-10-02-boat-tour-design.md`: the ship
goes round the lake for ever, calling at both piers, waits five real minutes at each dock, the player
walks on and off at the docks, walks the deck while it moves and turns, fishes from the deck, cannot lay
a fire on a deck, and swims if they go overboard. The places `H` cycles through stay as they are now.

The project lead added this, and it replaces the spec's "gangplank":

> Turn the boat so it's actually docked at the pier instead of alongside it, and then angle the pier so
> it meets the lowest point of the boat. We may need to provide a step off though, so keep that in mind.

Today the ship floats beside the Cleetwood pier with a 1.2 m gap and rails all round. The pier already
ends in a ramp; the player should be able to walk from the shore, along the pier, onto the main deck
and back, at both docks, without jumping.

## You may change only

Files under `src/`; a new `tools/build_route.py`; new files under `public/packs/crater-lake/route/`;
`public/packs/crater-lake/files.json` (only by running `python3 tools/build_pack_index.py crater-lake`);
`CREDITS.md`; `LICENSING-TODO.md`. Nothing else: no other tool, no prop or ground or flora pack file,
no config, no dependencies. Do not start, stop, restart or install anything, and run no server, browser
or model. The only commands you need are `bun run typecheck`, your route tool, and the pack index.

## Where to look

- `src/engine/props.ts` — draws the piers and ship and makes them solid. Each collision box is a static
  body placed once in world space, so nothing can move today. `src/biomes/crater-lake/index.ts` has the
  placements (`props`) and `places`; `src/biomes/Biome.ts` the types; `src/engine/pack.ts` the
  `props.json` types; `public/packs/crater-lake/props/props.json` the walk boxes and rail blockers
  (ship frame: bow +z, y = 0 at the waterline, main deck y 1.65; pier frame: +z out from the shore,
  y = 0 at the deck top, the end ramp drops 1.18 m).
- `src/engine/player/PlayerController.ts` and `src/engine/player/ground.ts` — Havok
  `PhysicsCharacterController`; ground height is a ray from above against `GROUND_MASK`.
- `src/engine/world.ts` — assembles everything; the lake mirror's render list is built at the end
  (props are not in it yet and should be); `environment.isPaused` is true while a panel is open.
- `src/play/Fishing.ts` (`castTo`, bobber, ripple are fixed world points), `src/play/Campfire.ts` and
  `canLayFire` in `src/play/targeting.ts`, `src/core/Settings.ts` (`dayLengthMinutes`).
- `tools/build_props.py` — how the ship and pier metadata are measured. Do not run it bare: it would
  rebuild the fire pit, which must not change. Prefer not to rebuild any prop; angle the pier where it
  is placed.
- `tools/heightfield.py` — lake-bed height and lake mask for pipeline code. `tools/build_pack_index.py`
  must be re-run after adding pack files (`python3 tools/build_pack_index.py crater-lake`).
- `tools/.cache/route/way_429536581.json` — the OpenStreetMap tour route, already downloaded (65
  points, closed loop, 24.6 km). `tools/.cache/props_preview/ship_side.png` shows the ship.

## Things already found out (do not rediscover)

- **Map coordinates.** World x/z = NAD83 / UTM zone 10N (`EPSG:26910`) easting/northing minus
  `ORIGIN_UTM` = (569609, 4754367) from `tools/build_heightmap.py` (not the legacy
  `ISLAND_SUMMIT_UTM` in the same file, which is 215 m off). With it the route's dock points fall
  within 10 m of both piers. Python: `uv run --quiet --with pyproj --with numpy python tools/<tool>.py`.
- **Route.** It does not have to be the exact mapped route. The project lead: "as long as the ship
  doesn't run aground and basically navigates the deeper waters of the lake toward the piers it doesn't
  have to be the exact route", and "we can probably just use physics here to steer the boat in the
  general directions it needs to go". So: a loop that leaves Cleetwood Cove westward, calls at Wizard
  Island and comes back round the south and east, staying where the lake is deep (bed well below the
  ship's 2 m draught). Use the mapped route as a guide for waypoints; several of its points near both
  docks are on land in our terrain, so the approaches have to be made. Steering the boat toward the next
  waypoint with a limited turn rate is welcome in place of a fixed curve; whether the boat is moved by
  Havok forces or by setting its pose is your choice, but read the frame-rate note below first. If
  waypoints are written by a tool, put it in `tools/build_route.py` and the result in the pack. If the
  OpenStreetMap points are shipped, credit OpenStreetMap in `CREDITS.md` (© OpenStreetMap contributors,
  ODbL) and add a line to `LICENSING-TODO.md` asking the project lead to confirm ODbL is acceptable.
- **The ship's side.** Measured from the hull: the rail top is lowest in the waist, about 2.6 m above
  the water for z between −1 and 3, where the hull is about 2.5 m either side of the centreline; the
  deck there is at 1.65 m. The rail blockers in `props.json` are a full metre high everywhere.
- **Frame rate is 9–14 fps on this machine** and `PlayerController.step` caps its time step at 0.05 s,
  while the boat does up to 55 m/s. Anything that carries the player by integrating a surface velocity
  will leave them behind. A way that does not depend on the frame rate: move the boat's collision
  bodies by teleport (`body.disablePreStep = false` makes Havok take the node's transform each step;
  `PhysicsPrestepType.TELEPORT` in `Physics/v2/Plugins/havokPlugin.js`), and move the player, the
  camera yaw, a seat they are sitting on and a cast fishing line by the same rigid step each frame.
  Mind the order within a frame so the player and the rails never disagree about where the boat is.
- `ground.hit(x, z, GROUND_MASK)` returns a raycast result with `.body`, so code can tell which
  surface is under a point.
- `PlayerController.step` subtracts `averageSurfaceVelocity` after `calculateMovementToRef` and never
  adds it back; harmless on static ground, wrong on a moving one.
- The swimming test uses the ground height from above, so a swimmer under the pier or hull stops
  swimming and sinks. It should use what is below the player.
- A second `H` or movement during `PlayerController.travel` is ignored; leave that as it is.

## For testing

In DEV builds `world.ts` puts handles on `window` (`__player`, `__scene`, …). Add `__boat` with what is
needed to test quickly from the console: where it is on the route, the time left at a dock, and a way
to set both.

## Check and report

`bun run typecheck` must pass. You cannot run the game; the reviewer will. Report: the files changed
with a sentence each, the docking arrangement you chose with its numbers (boat position and heading at
each dock, pier angle, any step), the route's length and its shallowest clearance, what you could not
do, and anything the reviewer should look at first in the game.
