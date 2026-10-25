# Brief: piers, the moored ship and the places H cycles through

Do this work yourself, in this session. Repo: `/home/mirai/projects/sojourney`. Work in place on `main`.
Do not commit. Do not create branches. Do not start, stop, restart or install anything (no servers, no
dev server, no ollama). Do not run any tool under `tools/` and do not change anything under `public/`.
Do not ask the user anything: if unsure, pick the obvious default and note it in the report. Do not
touch, revert or "tidy" any file not listed below, even if `git status` shows it modified.

Runtime is Bun only (`bun run typecheck`); never `npm`, `npx` or `node`.

## Today

- `public/packs/crater-lake/props/props.json` describes three props. `stone_fire_pit` is used by
  `src/play/Campfire.ts`. `modular_wooden_pier` and `dutch_ship_medium` are built and verified but
  nothing in `src/` uses them. Read `props.json` first: every prop has `file`, `lodDistances`,
  `bounds`; the pier and ship have `walk` boxes and the ship has `blockers`. All of it is in the
  engine's frame, in metres, relative to the prop's origin: the pier's origin is the shore end of its
  deck with y = 0 at the deck top and the pier running along +z; the ship's origin is the hull centre at
  the waterline with the bow along +z.
- The player starts at `biome.spawn` and `H` toggles to `biome.viewpoint`
  (`src/engine/player/PlayerController.ts`, `src/biomes/Biome.ts`, `src/biomes/crater-lake/index.ts`).
- Lake level is y = 0 (`WATER_Y` in `src/engine/pack.ts`).

## Goal

1. A pier stands at Cleetwood Cove and another on Wizard Island, and the ship is moored beside the
   Cleetwood pier. The player can walk on the piers and the ship's decks and is stopped by the ship's
   rails.
2. The biome lists named places. The game starts at the first, and `H` cycles through all of them in
   order: Cleetwood Cove pier, Wizard Island pier, Wizard Island, rim viewpoint.

## You may edit only

`src/engine/props.ts` (new), `src/engine/pack.ts`, `src/engine/world.ts`, `src/biomes/Biome.ts`,
`src/biomes/crater-lake/index.ts`, `src/engine/player/PlayerController.ts`, and any other file under
`src/` **only** where it reads `biome.spawn` or `biome.viewpoint` and must change to compile (search
with grep and list each such file in the report).

Match the surrounding code's style (two-space indent, double quotes, terse). Comment what you add: what
it does and why, in plain sentences. No feature flags, no settings, nothing beyond the steps below. Use
Babylon as it ships: read the installed source under `node_modules/@babylonjs/` if unsure of an API.

## Steps

### 1. `src/biomes/Biome.ts` and `src/biomes/crater-lake/index.ts`: the data

In `Biome`, replace `spawn` and `viewpoint` with:

```ts
// Where the player can be put: the game starts at the first place and H cycles through them in order.
places: { name: string; position: [number, number, number]; headingDegrees: number }[];
// Props standing in the world: position is the prop's origin in world metres, heading turns it about +y.
props: { prop: string; position: [number, number, number]; headingDegrees: number }[];
```

A heading of h degrees points along the world direction (sin h, 0, cos h); it is used both as the
camera's `rotation.y` and as the prop's `rotation.y`, as `spawn.headingDegrees` is today.

In `crater-lake/index.ts` replace the `spawn` and `viewpoint` lines with exactly:

```ts
  places: [
    { name: "Cleetwood Cove pier", position: [4728.3, 0, 4228.5], headingDegrees: 114 },
    { name: "Wizard Island pier", position: [-285.5, 0, -499.0], headingDegrees: 180 },
    { name: "Wizard Island", position: [0, 0, 530], headingDegrees: 40 },
    { name: "Rim viewpoint", position: [80, 0, -2960], headingDegrees: -16.5 },
  ],
  props: [
    // Each pier's shore end sits where the ground is a metre above the lake, and it runs out over the water.
    { prop: "modular_wooden_pier", position: [4725.6, 1.0, 4229.7], headingDegrees: 114 },
    { prop: "modular_wooden_pier", position: [-285.5, 1.0, -496.0], headingDegrees: 180 },
    // Moored alongside the Cleetwood pier, 4.6 m to its right and 14 m out, bow to the lake.
    { prop: "dutch_ship_medium", position: [4736.5, 0, 4219.8], headingDegrees: 114 },
  ],
```

A place's y of 0 is fine: `PlayerController.teleport` lifts the eye onto whatever is under it.

### 2. `src/engine/player/PlayerController.ts`: places instead of spawn and viewpoint

Change `PlayerBiome` to `{ places: Biome["places"]; terrain: { worldSizeMetres: number } }` and build
`this.spawns` from `biome.places` (same mapping as today). Nothing else changes: `H` already cycles
`this.spawns`, and `spawn()` with no argument already goes to index 0.

### 3. `src/engine/pack.ts`: the manifest's type

Add types for `props.json` (`PropsManifest`, format 1): per prop `file`, `lodDistances`, `triangles`,
`bounds`, and optional `walk` and `blockers`. A walk entry is one of two shapes, both present in the
file: flat `{ x: [min, max], z: [min, max], thickness, yTop }` (the pier's deck, `kind: "deck"`) or
`{ x, z, thickness, y }` (the ship's decks; here `y` is the top), and the pier's ramp
`{ kind: "ramp", x: [min, max], from: { z, y }, to: { z, y }, thickness }`. A blocker is
`{ x: [min, max], y: [min, max], z: [min, max] }`. Write the types to match the file exactly.

### 4. `src/engine/props.ts` (new): draw the props and make them solid

Export `async function loadProps(scene: Scene, biome: Biome, shadows: ShadowGenerator): Promise<void>`.

- Fetch `packs/${biome.id}/props/props.json`. Do nothing if `biome.props` is empty.
- For each distinct prop name in `biome.props`, load its GLB once with `LoadAssetContainerAsync` and
  build its levels **the way `Campfire.load` in `src/play/Campfire.ts` does for the fire pit**: add the
  container to the scene, group the container's meshes by the level number in their name (names start
  `<prop>_LOD<n>`; a level may be several meshes, one per material, so collect all meshes of a level
  and pass them together to `mergeLevel` from `./flora`), call `computeWorldMatrix(true)` on each mesh
  before merging, disable the container's own meshes, chain the levels with `addLODLevel` using the
  prop's `lodDistances`, and set `isPickable = false` and `receiveShadows = true` on each level.
  Unlike the fire pit, do not disable the merged levels and do not change any material.
- For each placement, `createInstance` from level 0, set its `position` and `rotation.y` (heading in
  radians), and `shadows.addShadowCaster(instance)`. Import `"../core/ktx2"` and `"./meshopt"` as
  `Campfire.ts` does.
- Collision, one static body per box, written the way `wallTheEdge` in `src/engine/world.ts` makes its
  walls (`new PhysicsBody(new TransformNode(...), PhysicsMotionType.STATIC, false, scene)` with a
  `PhysicsShapeBox(centre, rotation, extents, scene)` in world space):
  - each flat walk box: its top is `yTop` (pier) or `y` (ship); centre y is the top minus half the
    thickness; `filterMembershipMask = GROUND_MASK` so the player's ground ray finds the deck;
  - the ramp: a box from `from` to `to`, tilted about the prop's x axis to follow the slope, its top
    face on the line between them; `GROUND_MASK`;
  - each blocker: `filterMembershipMask = OBSTACLE_MASK`.
  The world centre of a box is the placement's position plus the local centre turned by the heading
  about +y; the world rotation is the heading (times the ramp's tilt for the ramp). Masks come from
  `./player/ground`.

### 5. `src/engine/world.ts`

After `loadGround` and before `Flora.load`, `await loadProps(scene, biome, environment.shadows);`.

## Check

`bun run typecheck` must pass with no errors. There are no test files in this repo; do not add any.

## Report

List each file changed with one sentence on what changed, paste the output of `bun run typecheck`, and
state any default you chose or anything you could not do.
