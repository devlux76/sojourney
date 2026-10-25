# Sojourney 2 — targets for the rewrite

Work that needs a substantial rewrite of the engine, and features and content that v1 will not have,
so it waits for the v2 game. Nothing here blocks Sojourney v1; the issues that do are in `ISSUES.md`.

## Engine work deferred to a rebuild

### Frame Graph

Rendering stays on Babylon's classic loop for now. Moving to the Frame Graph is the main reason for a
rebuild:

- **SSAO2 is off** (`src/engine/environment/index.ts`, commented out). It is built for the Frame
  Graph; on the classic loop it fought the SceneOptimizer (frames ghosted and the fog lit the far
  shore once the optimizer stepped).
- **The Atmosphere addon has no Frame Graph hookup in 9.29.** It draws through
  `scene.onBeforeCameraRenderObservable` and the scene's own `renderingManager` groups. The Frame
  Graph's object renderer has its own RenderingManager, and the per-camera hook only fires in the classic
  loop, so the sky would need custom glue. Check the then-current Babylon before starting.
- `mirrorTheSky` (`src/engine/world.ts`) hand-draws the atmosphere into the lake mirror because the addon
  never draws into render targets. A Frame Graph build should replace it with a stock path if one exists.

### Large world rendering (floating origin)

Babylon 9.29 ships `useLargeWorldRendering` (engine option: 64-bit matrices plus floating origin on
every scene) and `useFloatingOrigin` (per scene), with Havok multi-region physics to match
(https://doc.babylonjs.com/features/featuresDeepDive/scene/large_world/). **Not enabled, and not needed
at Crater Lake's size for positions:** the farthest point (a map corner) is about 12.7 km from the
origin, where a float32 still resolves about 1 mm. The docs' case is around 1,000,000 units, about 6 cm
per step. **It does matter for depth**, which was missed when this was first written: see "The
atmosphere and the depth buffer" below. A millimetre of rounding in a position becomes metres of depth
at a kilometre with the near plane at 0.1 m.
Turn it on if a destination is much larger (tens of km or more) or near-camera items visibly
wobble at the map edge. It is one engine option, but the custom shaders (star field in `NightSky.ts`,
`TerrainMaterialPlugin`, `mirrorTheSky`) must then be checked to use Babylon's standard uniform names.

### The atmosphere and the depth buffer

Found on 2026-10-03 while fixing ground that flickered along ridge tops (ISSUES.md U12, `123fb66`).

**How coarse depth is in v1.** The camera sees from 0.1 m to 20 km. The textbook figure for 24 bits of
depth is the distance squared times 6e-7: about 1 m at 1.3 km. What we measured is ten times worse. Two
surfaces 2.7 m apart, 1,270 m from the eye, changed order from frame to frame, and still did when one
was moved 4 m farther back; a twentieth of the distance (64 m there) settles it with room to spare. The
cause is where positions are worked out: in 32-bit floats, from world coordinates thousands of metres
from the origin. The rounding is only about a millimetre, but depth near the far end of the range is so
compressed that a millimetre there is worth about a hundredth of the distance.

**What v1 does about it.** Only the one visible case is treated: ground skirts are marked in the pack
and drawn farther back in depth by the ground material (`skirtBack` in
`src/engine/TerrainMaterial.ts`). Every other pair of surfaces that lie close together far away (tree
cards against the ground behind them, a ridge against the next one) still has the coarse depth.

**Why the stock cure is closed.** Babylon ships `engine.useReverseDepthBuffer`, which spreads depth
precision evenly and is the normal answer. With it on, the sky was black and the haze far too blue. The
Atmosphere addon (9.29) is written for the ordinary depth direction:

- Its sky compositor is drawn at a fixed depth of 1 with the depth test set to EQUAL
  (`drawSkyCompositor` in `node_modules/@babylonjs/addons/atmosphere/atmosphere.js`), so it fills only
  pixels whose depth is still the far value. With reverse depth the far value is 0 and nothing passes.
- Its aerial perspective, when given a depth texture, "expects an infinite far plane on the camera
  (camera.maxZ = 0) and the non-linear depth accessible in red channel" (the addon's own comment). We
  do not give it one: the haze is applied per material by `AtmospherePBRMaterialPlugin`, which is also
  why every material in the scene must be a `PBRMaterial`.
- No option in the addon mentions reverse depth; a search of its source finds none.

So in 9.29 the choice is the addon or reverse depth, not both. Check the then-current Babylon first: a
reverse-depth-aware compositor is a small change upstream and may exist by the time v2 starts.

**What would cure it in a rebuild**, in the order to try:

1. Reverse depth with a sky that respects it: the stock addon if it has learnt to, otherwise the Frame
   Graph route above, where the sky is our own pass and its depth test is ours to set.
2. Floating origin (`useFloatingOrigin`, previous section): positions are worked out relative to the
   camera, which takes out the rounding that costs the factor of ten. It does not need the addon to
   change, but every custom shader that reads world position must be checked (the ground's splat map
   and triplanar lookups use it).
3. A nearer far plane or a farther near plane. The near plane cannot go much past 0.2 m (the player's
   body is 0.3 m in radius), which buys a factor of two.

**A sky of our own, as a fallback.** If the volumetric atmosphere cannot be made to work with the depth
the game needs, the fallback the project lead has in mind is to build our own. What it would have to
replace, from what v1 uses of the addon: the sky itself (drawn behind everything, at whatever the far
depth is), the sun's and sky's light on every material (`additionalDiffuseSkyIrradiance`, the
transmittance on the sun), the haze with distance (aerial perspective, which v1 leans on for the far
rim and sets to 1.4), exposure through the day, and the sky in the lake's mirror (`mirrorTheSky`
already hand-draws that). A baked or analytic sky with distance fog in our own material plugin would
cover these and has none of the addon's constraints (PBR only, classic loop only, ordinary depth
only), at the cost of the look the addon gives for free at sunrise and sunset. This goes against
"Babylon first" and is only for the case where the addon blocks something v2 must have.

### From the Babylon v9 audit

- WebGPU runs in compatibility mode (WebGL semantics); native WebGPU features are unused.
- No snapshot rendering.
- The ground material binds 18 textures. The WebGPU floor is 16 per stage, so this may fail on weaker
  devices. Texture arrays (Babylon's KTX2 loader does not upload them today) or a Node Material are
  the durable fix. A Node Material cannot take the Atmosphere addon's material plugin, which attaches
  only to `PBRMaterial`.
- `needAlphaTesting()` in `src/engine/flora.ts` is deprecated.
- `src/vendor/dynamicTerrain/` and `harness/dynamicTerrain.*` are dead code (spike not adopted).

## Content deferred to v2

### Fauna and NPCs

Moved from `ISSUES.md` (was B2) on 2026-10-02 by the project lead. Crater Lake's `fauna` is empty
(`src/biomes/crater-lake/index.ts`) and stays empty for v1: animal and character models that look good
and allow commercial use are not available, apart from the rat on Poly Haven.

Fauna is also engine work the game does not have yet. Everything placed in the world today is a static
object or an impostor card; animals need animated, skinned meshes, moving collision and behaviour, none
of which exists in `src/`.

## Features deferred to v2

### Player avatar and third-person view

Project lead, 2026-10-02. Give the player a body and the option of an over-the-shoulder third-person
camera, as in The Legend of Zelda: Breath of the Wild. v1 is first person with no body. It needs the same
groundwork as fauna (a skinned mesh, animation blending, a moving collider), so the two go together.

The character mesh and its animations have to be sourced under a commercial licence (a licensed or
commissioned model, or a generated one cleaned up; motion-capture clips for walking, rowing, fishing,
sitting). Rigging, skinning, retargeting, LOD levels and the glTF export can be scripted in Blender in
`tools/`, like the rest of the pipeline.

### Camp with friends

Project lead, 2026-10-02. Friends join the same destination by invite and camp together. It needs
networking, invites and a **world sync mechanism**: everything that changes or moves must be the same
for everyone present, or one person sees a wolf running along a cliff line and the others do not. That
covers fauna, and by the same reasoning the time of day, the weather, the ship, and what players do to
the world (chopped trees, fires). It also needs the player avatar above, so friends can see each other.
