# Biome pack architecture — research (read-only)

Goal: split Crater Lake out of the core game into a downloadable "pack," selected at a
loading/destination screen, so a future Flaming Gorge biome can ship the same way. Also: data-driven
ground cover (huckleberries etc.) and fauna. This document is investigation + a proposed design; no
source was changed.

## 1. Asset inventory

`assets/` (566 MB, gitignored, untracked) is a Babylon Playground scratch dump — confirmed: nothing
in `src/` references a path under `assets/`, and `.gitignore:5` excludes it. It is dead weight on
disk, not part of the shipped game. Ignore it for packaging purposes.

Everything the game actually loads lives under `public/` (88 MB) and is fetched at runtime by
relative path string (`fetch(...)`, `new Texture(path, ...)`, `SceneLoader.ImportMeshAsync(dir, file,
...)`) — **never** via a Vite `import` of the binary. Confirmed by `grep` for `import .*\.(glb|png|jpg|wav|bin|env)` across `src/`: zero hits. This matters a lot for the pack design (§7): Vite's
bundler never touches these files, so moving them to a different URL prefix (`packs/<id>/...`)
requires no build-tool change, only path edits in the loaders.

Sizes (`du -sh`), grouped and classified:

| Group | Path | Size | Core or Crater-Lake-specific |
|---|---|---|---|
| Icons/manifest | `public/icons/`, `manifest.webmanifest` | 68 KB | Core (icons could stay core; per-pack theming is optional polish) |
| Stars/sky data | `public/sky/` (`stars.bin`, `moon.jpg`, `milkyway.jpg`) | 356 KB | Core — real star catalogue + moon texture, same sky anywhere on Earth |
| Ambient nature loops | `public/sounds/*.wav` | 3.8 MB | **Biome** — "ambient_nature_1/2" are Crater-Lake-forest loops (see `src/world/AmbientAudio.ts:9-16`); Flaming Gorge (desert canyon) wants different loops |
| Generic sky env/skybox | `public/textures/environment.env`, `env/TropicalSunnyDay_*.jpg`, `skybox_*.jpg`, `skybox2_*.jpg` | ~4.4 MB | Mixed: `environment.env` is the IBL used everywhere (core); the two skybox cubemap sets look like leftover/unused alternates — worth confirming if `Skybox.ts` (procedural `SkyMaterial`, no texture) even uses them. `Atmosphere.ts:43` only loads `environment.env`. The `skybox*.jpg` / `env/` folders appear **unreferenced** (grep found no loader referencing `skybox_px.jpg` etc. or `TropicalSunnyDay`) — likely dead assets, flag for removal regardless of packs. |
| Rock/tree/shrub models+textures | `public/textures/models/**` | 60 MB | **Biome** — CC0 Poly Haven fir/pine/rock/shrub (`AssetRegistry.ts:12-15`), Crater Lake's specific flora |
| Terrain data | `public/textures/terrain/heightmap.bin+json`, `bathymetry_2m.bin.z+json`, `splatmap.png`, ground-texture jpgs | 17 MB | **Biome** — literally Crater Lake's DEM (`tools/build_heightmap.py` bakes USGS DEM centred on Wizard Island's summit) |
| Misc generic textures | `flare.png`, `grass.png`, `ground.jpg`, `rock.png`, `sand.jpg`, `waterbump.png` | ~1.7 MB | Mostly biome (ground/sand/rock look) except `flare.png` (dust motes, core VFX) and `waterbump.png` (used by both `WaterSystem.ts:41` and `Underwater.ts:42` — generic ripple normal map, could be core) |

Everything else the game needs is **code**, not data: fish list, weather schedule, lighting
keyframes, fire rules, sounds (all synthesised via Web Audio in `src/play/sounds.ts`, no files) — see
§2 for why these need to move too.

Build output (`bun run build`, dist size **99 MB total**, of which `dist/assets` — the JS bundle
chunks — is only **8.5 MB**; the rest, 86 MB, is `dist/textures` + `dist/sounds` + `dist/sky` copied
verbatim from `public/`, byte-identical: confirmed `diff -q` on `heightmap.bin`). So today, "core"
and "Crater Lake" are **already physically separable on disk** — they're just not separated logically
in the code that decides what to fetch.

## 2. Hard-coded Crater Lake assumptions in `src/`

| What | File:line | Value |
|---|---|---|
| Real-world lat/lon (sun/moon position) | `src/sky/Astronomy.ts:5` | `CRATER_LAKE = { lat: 42.94, lon: -122.11 }`, default param at `Astronomy.ts:64` |
| Timezone | `src/sky/GameClock.ts:8` | `UTC_OFFSET_HOURS = -7` (PDT) |
| Stay calendar (season) | `src/sky/GameClock.ts:3-6` | starts July 15, 60-day stay |
| World size / DEM centring | `tools/build_heightmap.py` (`ISLAND_SUMMIT_UTM`, `SIZE_M=18000`, `LAKE_SURFACE_M=1882.0`), consumed via `heightmap.json` | baked into the data files, not code, but `PlayerController.ts:10` `WORLD_BOUNDARY_LIMIT = 9000` (half of 18000) is hand-duplicated in code |
| Water level | `src/world/WaterSystem.ts:8` | `WATER_LEVEL = 18` (metres above the lake-bed datum) — read by `TerrainManager`, `PlayerController`, `BioPlacement`, `Underwater`, shaders |
| Water colour | `src/world/WaterSystem.ts:11-12` | `WATER_COLOUR`/`WATER_COLOUR_2`, comment: "Calibrated at golden hour — DO NOT CHANGE without testing" |
| Lake-finding seed/params | `src/world/TerrainManager.ts:21-24` | `LAKE_CELL_METRES=100`, `LAKE_SEED=[300,-900]`, `ROAM_MARGIN_CELLS=3` |
| Ground splat layers (species/photos) | `src/world/TerrainManager.ts:14-18` | sand/needles/dirt JPGs and tile sizes |
| Lake-bed texture | `src/world/TerrainManager.ts:29` | `aerial_beach_01_*` |
| Fish species/sizes | `src/play/fish.ts:1-15` | `"rainbow trout" | "kokanee salmon"`, `KOKANEE_SHARE=0.6`, `SIZES` table — comment: "The fish that really live in Crater Lake" |
| Tree/shrub species + zones/densities | `src/world/AssetRegistry.ts:12-15` (species→GLB), `src/world/BioPlacement.ts:44-78` (`BEACH_LINE=22`, `FOREST_LINE=40`, `TREE_LINE=180`, per-band probabilities, 15000-sample loop, seaweed bed params `93-110`) | all hard-coded elevation bands and species tables |
| Weather climate numbers | `src/sky/Weather.ts:13-35` | `RAIN_WINDOW`, `RAIN_HOURS`, shower chance/gap, `CALM_WIND`, wet-rise/dry times — comment: "Oregon weather...always with rain while the sun is up" |
| Weather RNG seed | `src/sky/DayNight.ts:40` | `WEATHER_SEED = 20260715` |
| Lighting/atmosphere keyframe colours | `src/sky/LightingKeyframes.ts:26-31` | `COLOUR_STOPS` per time-of-day (night/twilight/golden/midday) |
| Underwater hue/visibility defaults | `src/core/Settings.ts` (search `underwaterHue`, `underwaterVisibility`) and `src/world/Underwater.ts:57-59` | Crater-Lake-blue defaults |
| Spawn point | `src/core/PlayerController.ts:7-8` | `SPAWN_POSITION = (0, 45.5, 530)`, `SPAWN_HEADING = 40°` — "In the trees on the island's gentle north side" |
| World boundary / fall-out height | `src/core/PlayerController.ts:10,12` | `WORLD_BOUNDARY_LIMIT=9000`, `FALL_OUT_HEIGHT=-1000` |
| Ambient audio files | `src/world/AmbientAudio.ts:9-21` | `ambient_nature_1/2.wav` paths hard-coded |
| Sky physical params | `src/sky/SkyModel.ts` (`SKY_PARAMS`) | tuned for this atmosphere/turbidity — not checked line-by-line here but is a single exported const object, easy to move |

Net: essentially every world/data module (`TerrainManager`, `BioPlacement`, `AssetRegistry`,
`WaterSystem`, `fish.ts`, `Weather.ts`, `LightingKeyframes.ts`, `GameClock`, `Astronomy`,
`PlayerController` spawn) has Crater-Lake constants baked in at module scope as plain exported
`const`s. This is actually a **good** sign for migration: they're already isolated per-module, named,
and commented with *why* they're the value they are — turning each into a field read from a `Biome`
object is mechanical, not a redesign.

## 3. Boot flow

`src/main.ts` (21 lines): grabs the canvas, creates the Babylon `Engine`/`Scene`, starts the HUD and
fullscreen toggle, registers `sw.js`, constructs `PlayerController`, then calls
`buildWorld(scene, camera)` (`src/core/SceneManager.ts:37-105`) and awaits it before starting the
render loop.

`buildWorld` is a single async function that: creates `Atmosphere`, `Skybox`, `TerrainManager`
(await `waitForMaterial()`), `WaterSystem`, `BioPlacement` (await `populate()`, which itself awaits
`AssetRegistry.preloadAll()` — the GLB/texture fetches), wires terrain streaming callbacks, then
`DayNight`, `NightSky`, `Moon`, `Clouds`, ambient audio, weather audio, rain, and finally `Play` +
`Chopping`/`Campfire`/`Fishing`. Everything is synchronous construction except the two `await`s
above.

**Where a destination-choice screen slots in**: before `buildWorld` is called. `main.ts:15-19` is the
natural insertion point — show a menu, let the player pick a biome id, resolve/download its pack, get
back a `Biome` object, then call `buildWorld(scene, camera, biome)` instead of the parameterless
version. `buildWorld` itself would need every hard-coded module in §2 to accept `biome.*` fields
instead of importing top-level consts — that's the bulk of the migration work, not the boot flow.

**Service worker** (`public/sw.js`, 2 lines): `self.addEventListener("fetch", () => {})` — an empty
handler that satisfies "installable PWA" requirements but does **no caching at all**; every request,
every load, always hits the network. `public/manifest.webmanifest` declares `display: fullscreen`,
icons, name/description ("A pocket vacation at Crater Lake" — will need per-pack or generic wording
once other biomes exist). There is currently no Cache Storage usage anywhere in the codebase (`grep
caches\.` finds nothing) — this is the biggest gap for "downloaded pack stays offline" (§7).

## 4. Vite build

`vite.config.ts` is minimal: `publicDir: 'public'` (default), one dev-only middleware plugin that
lets `TreeImpostor.ts` POST baked sprite PNGs back into `public/` when opened with `?bakeImpostors`.
No manual chunking, no asset inlining config, no `define`.

`bun run build` output: **dist/ = 99 MB total**.
- `dist/assets/` (bundled JS) = **8.5 MB across 263 chunks**. Babylon's own ES modules split into
  many small per-feature chunks (7–160 KB each — water shader, PBR functions, animation, etc.), but
  the **game's own code + whatever of Babylon it touches collapses into one entry chunk**,
  `index-*.js` = **6.4 MB minified / 1.4 MB gzip** — because `main.ts` statically imports
  `SceneManager` which statically imports every world/sky/play module; there is not one `import()` in
  the whole `src/` tree (confirmed by grep). Vite/Rolldown can't split what's never dynamically
  imported.
- `dist/textures` + `dist/sounds` + `dist/sky` (86 MB) are `public/` copied through unchanged —
  confirmed identical bytes to source. Vite treats them as static passthrough, not bundled or
  hashed(!) — filenames keep their original names, so cache-busting for these currently relies on
  nothing (a redeploy with changed terrain data would need a hard refresh or the sw needing an update
  mechanism).

Takeaway for packs: the JS bundle is core-only already in spirit (it's all engine/UI/gameplay logic —
none of it currently branches on "which biome"), and the 86 MB of data is exactly what should move to
`public/packs/<id>/`. The single missing piece is code-splitting: introducing `import()` boundaries
per biome module (`src/biomes/<id>/index.ts`) is what would shrink the initial JS the player downloads
before choosing a destination, and let each biome's index.ts pull in only that biome's constants.

## 5. Existing placement systems (reuse for ground cover + fauna)

**`AssetRegistry`** (`src/world/AssetRegistry.ts`) is a static class keyed by string id → one shared
`Mesh` per id (with LOD chain for close-up detail, or a sprite impostor for cheap far ones — decided
by `IMPOSTOR_IDS` at `:18`). `preloadAll()` (`:142-154`) is the one place that knows the full species
list and their file paths. **This is the natural extension point for a data-driven flora/fauna list**:
instead of a hard-coded `TREES` record and a hard-coded `preloadAll` body, both would iterate a
`biome.flora` / `biome.fauna` array.

**`BioPlacement`** (`src/world/BioPlacement.ts`) does everything scatter-placement related:
- Two placement strategies: instanced (`createInstance`, one Babylon node per placed object — used
  for boulders/pebbles/near-tree-models) vs. thin-instanced sprites (`sprites` map, one draw call per
  species regardless of count — used for the impostor billboards, `buildSprites():130-143`).
- `trunks: TrunkGrid` (spatial hash, §below) makes trees collidable and fell-able without a mesh
  collider per tree.
- `populate()` (`:40-90`) is one big procedural loop over 15,000 random (x,z) samples, hard-coded
  elevation bands (`BEACH_LINE`/`FOREST_LINE`/`TREE_LINE`) and per-band species/probability logic —
  this is the part that most needs to become table-driven (a `zones: [{minY,maxY,species,density,...}]`
  array read per biome).
- `updateNearModels()` (`:180-211`) swaps sprite↔real-model within a settings-controlled radius —
  reusable verbatim for any thin-instanced ground cover (huckleberry bushes) since it's already
  generic over "any sprite-drawn id."
- **Ground cover (huckleberries)**: reuse the shrub pipeline directly — add a new asset id (e.g.
  `huckleberry_bush`) to `AssetRegistry`, add a placement rule to `BioPlacement`'s zone table, and
  make it a thin-instanced sprite exactly like `shrub_dense`. Picking berries needs one more thing:
  a per-placement "has berries" / "picked" state (parallel to `felled: Set<Placement>` at `:35`,
  which already tracks a boolean per-placement removal state for trees) and a lookup from world
  position back to a `Placement` (parallel to `trees: Map<string,...>` keyed by `trunkKey` at `:33`,
  or reuse `TrunkGrid`-style spatial hash for arbitrary forageables instead of only trunks).
- **Fauna**: `BioPlacement` has no analogue for *moving* things — it's all static placement. Wandering
  animals/birds would be a new small system (a `Fauna` class parallel to `BioPlacement`, not a
  fork of it), but it can reuse `AssetRegistry` for the model, `TerrainManager.getHeight` for
  ground-following, and the same near/far LOD or impostor swap idea if animals need it. Simplest
  version: animate `InstancedMesh` positions per-frame along a wander path, generated per spawn point
  from the biome's fauna table (species, count, home-range radius, sound cue).

**`TrunkGrid`** (`src/world/TrunkGrid.ts`) is a tiny, already-pure, already-tested (see
`tests/trunkGrid.test.ts`) spatial hash: `add`/`remove`/`within`/`blocked`. It's generic over "a
point with a reach radius" and has zero Babylon dependency — directly reusable for huckleberry bush
positions (block-free, since bushes shouldn't block the player) or fauna home-ranges (`within` to find
nearby wildlife for a footstep-triggered flush/flight behaviour).

**`TreeImpostor`** (`src/world/TreeImpostor.ts`) bakes/loads billboard sprites for any mesh, keyed by
id, with a hand-tunable `SPRITE_COLOUR` table (`:17-23`). Already generic enough to impostor a
huckleberry bush the same way `shrub_dense` is done — just add its id to `SPRITE_COLOUR` (or fall back
to the default `tree` entry) and to `IMPOSTOR_IDS` in `AssetRegistry.ts:18`.

**Targeting/interaction reuse** — `src/play/targeting.ts` is pure geometry functions (`V3`, ray-vs-
cylinder `rayTrunk`, ray-vs-point `rayNear`, ray-vs-plane `rayWater`, marched ray-vs-heightfield
`rayGround`) with **no Babylon types**, fully unit-testable (see `tests/targeting.test.ts`). Chopping
uses `rayTrunk` for tree trunks and `rayNear` for logs (`src/play/Chopping.ts:46-51`). **Berry-picking
would reuse `rayNear`** exactly as logs do: a `Found`-returning `find(ray)` that walks a list of
un-picked berry-bush placements and calls `rayNear(origin, dir, bush.position, PICK_RADIUS, REACH)`,
then a `perform()` that marks that placement picked and adds an item to the rucksack. The whole
`Chopping` class (`src/play/Chopping.ts`) is close to a template for this: implements the `Activity`
interface (`find`+`update`, see `src/play/Play.ts:36-40`), so a `Foraging implements Activity` sibling
class, registered the same way (`play.add(new Foraging(...))` in `SceneManager.ts`), is the
idiomatic shape — not a modification of `Chopping`.

**`src/play/actions.ts`** is the single, pure (`Target`→`Action`) decision function `decide()` — the
`Target` union (`:6-9`) and `Action` union (`:21`) would need one more variant each for berries
(e.g. `{ kind: "berries" }` / `"pick"` action), wired into `handsFreeAction()` (`:45-54`).

**`src/play/rucksack.ts`** models carried items as: a `Set<Tool>` for equippable tools (axe, pole,
flint, rations, flashlight — 5 fixed slots, `SLOTS` array `:5`), plus ad-hoc counters/arrays for
consumables (`logs: number`, `rawFish: Fish[]`, `cookedFish: Fish[]`). There's no generic "inventory
item" concept — foraged berries would most naturally be a new counter (`berries: number`) plus a
`nextFood()`-style rule addition, following the existing pattern rather than introducing a generic
item system (per CLAUDE.md's "don't add abstractions not requested" — a generic inventory would be
speculative here; the codebase's own pattern is one field per consumable type).

## 6. Tests

`tests/*.test.ts` (17 files) uses `bun:test` (`import { expect, test } from "bun:test"`), one file per
pure-logic source module, testing exported functions/classes directly with no mocking — e.g.
`tests/trunkGrid.test.ts` imports `TrunkGrid` and calls `add`/`blocked`/`within`/`remove` with plain
numbers. Modules with zero Babylon dependency (`targeting.ts`, `fish.ts`, `Weather.ts`,
`LightingKeyframes.ts`, `GameClock.ts`, `Astronomy.ts`, `rucksack.ts`, `actions.ts`, `fireRules.ts`,
`Heightfield.ts`, `lakeCells.ts`, `TrunkGrid.ts`, `QuadtreeSelector.ts`, `stars.ts`,
`fishingLog.ts`, `groundMotion.ts`, `SkyModel.ts`) all have a matching test file already — this
project already keeps "pure data/logic" separate from "Babylon scene code" as a matter of habit, which
is exactly the split a `Biome` manifest needs: the manifest itself and any new placement-rule/zone
logic should be plain TypeScript, testable the same way, while only the *consumers* (`BioPlacement`,
`AssetRegistry`, `TerrainManager`) touch Babylon.

## 7. Proposed architecture (not implemented)

### 7.1 `Biome` manifest type

```ts
// src/biomes/Biome.ts — no Babylon imports; pure data description.
export interface Biome {
  id: string;                 // "crater-lake", "flaming-gorge"
  name: string;                // display name for the destination screen
  packVersion: string;         // bump to invalidate a cached SW copy

  location: { lat: number; lon: number; utcOffset: number };
  calendar: { startMonth: number; startDay: number; stayLengthDays: number; startHour: number };

  terrain: {
    baseUrl: string;           // "packs/<id>/terrain/" — heightmap.bin/json, bathymetry, splatmap
    worldSizeMetres: number;
    boundaryMargin: number;    // fall-outside-world guard
    groundLayers: { sampler: string; file: string; tileMetres: number; tint: number }[];
  };

  water: {
    level: number;
    colour: [number, number, number]; colour2: [number, number, number];
    lakeSeed?: [number, number]; lakeCellMetres?: number; roamMarginCells?: number;
    bed: { albedo: string; normal: string; tileMetres: number };
  } | null;                    // null biomes with no lake/sea (Flaming Gorge is a reservoir — probably non-null, but keep optional for a landlocked biome later)

  flora: {
    id: string; modelUrl: string; impostor: boolean;
    zones: { minElevation: number; maxElevation: number; maxSlope: number; density: number }[];
  }[];

  groundCover: {               // huckleberries etc. — separate from flora because they're forageable
    id: string; modelUrl: string;
    zones: { minElevation: number; maxElevation: number; maxSlope: number; density: number }[];
    forage?: { itemId: string; regrowDays: number };
  }[];

  fauna: {
    id: string; modelUrl: string; soundUrl?: string;
    kind: "ground" | "bird";
    spawnCount: number; wanderRadius: number;
  }[];

  fish: { species: string; share: number; mean: number; spread: number; min: number; max: number }[];

  climate: {
    rainWindow: [number, number]; rainHours: [number, number];
    showerChance: number; calmWind: number; weatherSeed: number;
  };

  lighting: { colourStops: Record<string, { sun: RGB; fill: RGB; fog: RGB; daylight: number }> };

  ambientAudio: string[];      // pack-relative URLs, looped

  spawn: { position: [number, number, number]; headingDegrees: number };

  thumbnailUrl: string;        // for the destination screen
}
```

### 7.2 Directory layout

```
public/
  packs/
    crater-lake/
      manifest.json                  (mirrors the Biome fields that are pure data, or generated from index.ts)
      terrain/heightmap.bin, .json, bathymetry_2m.bin.z, .json, splatmap.png, *_diff_1k.jpg
      models/trees/*.glb, rocks/*.glb, shrubs/*.glb, impostors/*.png
      sounds/ambient_nature_1.wav, ambient_nature_2.wav
      thumbnail.jpg
    flaming-gorge/
      ...same shape...
src/
  biomes/
    Biome.ts                 (the interface above)
    crater-lake/index.ts      (default-exports a Biome, imports nothing biome-specific from Babylon —
                                just the manifest object; species/zone tables that are today's
                                module-scope consts in BioPlacement.ts/fish.ts/Weather.ts move here)
    flaming-gorge/index.ts
    registry.ts               ({ [id]: () => import("./crater-lake") } — the dynamic-import map)
```

Because each `biomes/<id>/index.ts` is loaded via `import("./biomes/" + id)`, Vite/Rolldown gives it
its own chunk automatically — no manual `manualChunks` config needed, confirmed this is standard Vite
behaviour and consistent with the 263-chunk output already seen from Babylon's own ESM structure.

### 7.3 Pack loader with progress

```ts
// src/biomes/PackLoader.ts
export interface LoadProgress { loaded: number; total: number; }

export async function loadBiome(id: string, onProgress: (p: LoadProgress) => void): Promise<Biome> {
  const { default: biome } = await import(`./biomes/${id}/index.ts`); // code chunk (small, KB-scale)
  await cacheAssets(biome, onProgress);                               // data (MB-scale), see 7.4
  return biome;
}
```

The **code** import is near-instant (a few KB of constants). The **data** — GLBs/textures/terrain —
is what needs a progress bar; that's a `fetch` + `Cache.put` loop over every URL the manifest
references (terrain files, each flora/fauna model, ambient audio), summing `Content-Length` headers
for the total. `AssetRegistry.preloadAll()` already awaits a `Promise.all` of loads (`:142-154`) —
extending it to report per-file completion is a small, additive change, not a rewrite.

### 7.4 Service worker / Cache Storage for offline packs

Current `sw.js` (`self.addEventListener("fetch", () => {})`) does nothing. Replace with a
cache-first-for-pack-assets strategy:

```js
// public/sw.js (sketch)
const PACK_CACHE = "packs-v1";
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (!url.pathname.startsWith("/packs/")) return;      // core app: network, as today
  e.respondWith(caches.open(PACK_CACHE).then(async (cache) => {
    const hit = await cache.match(e.request);
    if (hit) return hit;
    const res = await fetch(e.request);
    if (res.ok) cache.put(e.request, res.clone());
    return res;
  }));
});
```

The pack loader (7.3) would call `cache.addAll(urls)` (or the same fetch+put loop, to report
progress) up front rather than relying on lazy fetch-through-SW, so "download this pack" is an
explicit, awaitable action the loading screen can show a bar for, and a re-visit is fully offline
even before the SW's fetch handler runs. `packVersion` in the manifest (7.1) becomes the cache-busting
key when a pack updates.

### 7.5 Incremental migration order (Crater Lake stays playable after each step)

1. **Extract pure data with no behaviour change.** Move each hard-coded table (§2) into
   `src/biomes/crater-lake/*.ts` as named exports; have the existing modules import from there instead
   of declaring the consts inline. Zero runtime change. Verify: `bun test` all green, `bun run build`
   succeeds, manual smoke test unchanged. This is safe because every constant identified in §2 is
   already a standalone, named, single-purpose export — no entanglement to untangle.
2. **Introduce the `Biome` interface and one concrete `craterLake: Biome` object** assembled from the
   step-1 exports. Nothing consumes it yet. Verify: `tsc --noEmit` passes (`bun run typecheck`).
3. **Thread `Biome` through `buildWorld`** (`SceneManager.ts:37`) as a parameter, replacing each
   direct import of a Crater-Lake const with `biome.foo`. Do this module by module (start with
   `fish.ts`/`Weather.ts` — leaf modules with existing tests — before `BioPlacement`/`TerrainManager`,
   which have the procedural zone logic). Verify after each module: its unit test still passes, `bun
   run dev` still boots into the same-looking island (since `craterLake` is still the only biome and
   its values are unchanged).
4. **Move `public/textures/...`, `public/textures/models/...`, `public/sounds/ambient_*` to
   `public/packs/crater-lake/...`**, updating the path strings the loaders use (`AssetRegistry.ts`,
   `TerrainManager.ts`, `Heightfield.ts`, `AmbientAudio.ts`) to `biome.*.baseUrl`-relative paths.
   Verify: `bun run build`, then load the built site and confirm terrain/trees/water/audio appear —
   this is the step most likely to have a typo'd path, so test by loading, not just by build success.
5. **Add the dynamic-`import()` registry** (`src/biomes/registry.ts`) and change `main.ts` to `await
   loadBiome("crater-lake", ...)` before `buildWorld`, with no UI yet (hard-coded id). Verify: `bun run
   build` now shows a separate chunk for `crater-lake/index-*.js`; game still boots identically.
6. **Add the destination/loading screen** (new `src/ui/DestinationScreen.ts`, simple DOM overlay like
   the existing `#play-card`/`#settings` overlays in `index.html`) that lists biome ids from the
   registry, calls `loadBiome` with a progress callback, and only then calls `buildWorld`. Still only
   one real biome, but the seam now exists. Verify: manual click-through.
7. **Implement the service worker cache** (7.4) and wire the pack loader's `fetch` calls through it.
   Verify: DevTools Application tab shows the `packs-v1` cache populated after selecting Crater Lake;
   reload with network throttled to offline still boots the game.
8. **Ground cover + fauna data-drive**: extend `BioPlacement.populate()`'s zone logic to read
   `biome.flora`/`biome.groundCover` arrays instead of the hard-coded `BEACH_LINE`/`FOREST_LINE`/
   `TREE_LINE` bands (keeping Crater Lake's current numbers as the `crater-lake` biome's zone table,
   so behaviour is unchanged), then add the huckleberry ground-cover asset + a `Foraging implements
   Activity` class (§5) and a small `Fauna` class. Verify: new unit tests for any new pure logic
   (zone-lookup function, forage pick/regrow), plus visual smoke test that huckleberries appear and
   are pickable.
9. **Only then build Flaming Gorge** as a second `src/biomes/flaming-gorge/index.ts` + `public/packs/
   flaming-gorge/...` — by this point it's "fill in a manifest + supply assets," not "write new
   engine code."

### 7.6 Risks / open questions

- **`WATER_LEVEL` and similar constants are imported directly by many modules**
  (`import { WATER_LEVEL } from "./WaterSystem"`) — not just `BioPlacement`/`TerrainManager` but also
  `PlayerController.ts:2`, `Underwater.ts:2`. Step 3 needs to catch every import site; a
  `grep -rn WATER_LEVEL src/` sweep right before that step is cheap insurance.
- **Biomes without a lake**: `SceneManager.ts` constructs `WaterSystem`/`Underwater`/lake cells
  unconditionally. Flaming Gorge (a reservoir) is probably fine, but don't assume every future biome
  has water.
- **`Astronomy.ts` default params fall back to `CRATER_LAKE`** (`equatorialToHorizontal(eq, date, lat =
  CRATER_LAKE.lat, lon = CRATER_LAKE.lon)` at `:64`) — a silent-bug risk if a call site relies on the
  default instead of passing `biome.location` after migration.
- **GLB/texture URLs are relative strings resolved against the page origin**, no leading slash
  (`AssetRegistry.ts:144-147`), so a `public/packs/<id>/...` layout means every path string needs the
  pack prefix. Thread one `PACK_BASE_URL` through `AssetRegistry`/`TerrainManager`/`Heightfield` rather
  than editing each literal.
- **The single 6.4 MB JS entry chunk (§4)** means even the destination screen ships with the whole
  engine today. If it must be lightweight, consider a second Vite entry point (menu vs. game) — outside
  this doc's scope but worth flagging since "small core download" was an explicit goal.
- **No existing Cache Storage usage** — the SW cache-first sketch in 7.4 is new territory here; test
  `packVersion` cache invalidation carefully, since a stale cached `heightmap.bin` would be a confusing
  silent bug.
- **`assets/` (566 MB untracked Playground dump)** — confirmed unused; delete it, or at least never
  treat it as a pack source.
- **Two apparently-unused skybox texture sets** (`skybox_*.jpg`, `skybox2_*.jpg`,
  `env/TropicalSunnyDay_*.jpg`, ~4 MB) — no loader references found by grep; confirm before packing
  (don't ship dead weight into core or a biome pack).
