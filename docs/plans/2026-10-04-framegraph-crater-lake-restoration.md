# Framegraph and Crater Lake World Restoration Implementation Plan

> **For agentic workers:** Execute the phases in order. For Babylon render graphs and node materials, use the supplied Babylon.js MCP editors to build, inspect, validate, and export the graphs. Work in place on `main`, keep each phase reviewable, and do not overwrite the preserved WIP stash.

**Goal:** Move Sojourney to a Babylon.js 9 framegraph render path, measure it against the restored full-scene baseline, then rebuild the Crater Lake world with geology-led high-relief terrain, NME materials, accurately placed existing boat/pier props, and survey-driven PBR vegetation.

**Architecture:** Use a Node Render Graph as the replacement for `scene.render()`'s normal render path, with Babylon owning clear, culling, object rendering, antialiasing, image processing, and existing post effects. Keep per-frame game state and movement on the existing Scene observables and render-loop callback. Preserve the in-progress stripped/material experiment in `stash@{0}`; only after the first full-scene framegraph A/B should useful parts be selectively reapplied or rebuilt through Node Material Editor graphs. Terrain classification and macroform edits stay build-time products from DS 716, SIM 2832, NPS VMI, and canopy/orthophoto survey data; runtime terrain materials are NME-authored shader graphs.

**Tech Stack:** Bun, TypeScript, Babylon.js 9.29, Babylon Node Render Graph MCP, Babylon Node Material MCP, Python terrain pipeline, headed Chromium started with `start-game.sh`.

---

## Preserved State and Working Rules

- Current tracked WIP was stashed as `stash@{0}` with message `wip: stripped scene and terrain material experiment before framegraph baseline`. It includes the stripped-scene test and the removal of a terrain shader implementation. Do not drop or blindly pop it. Inspect it and selectively recover improvements after the baseline capture.
- Untracked research photos, `references/`, screenshots, `start-game.sh`, tests, and fetch scripts were left in place. Treat them as user work and do not clean them up.
- The current committed scene already includes the full flora/props/gameplay implementations; `start-game.sh` launches the Vite server and Chromium using Vulkan/Dawn flags and full-screen mode. Keep using that script for headed visual checks.
- Do not write additional documentation. The plan here is the requested planning artifact. Update `CREDITS.md` only when an asset is actually added/changed for shipping, recording source, author, licence, and any negotiated rights.
- Use whole-package Babylon imports as already established. Do not introduce render-quality flags or new performance controls. The only quality/performance setting remains target FPS through `SceneOptimizer`.
- Comment code in any files changed, describing the new behavior and its reason.

## File Map

### Framegraph slice

- `src/core/startGame.ts` — replace the direct `scene.render()` call in the engine loop with the scene framegraph path while retaining `player.update()` and game timing.
- `src/engine/environment/index.ts` — keep the environment, atmosphere, shadow generator, tone mapping, bloom, sharpening, exposure animation, and MSAA setting behavior coherent with the render graph.
- `src/core/Perf.ts` — retain / adapt instrumentation to report frame, GPU, draw-call, render-target and shader-compilation readings on the graph path.
- `src/engine/framegraph/` — add the exported NRG JSON and a small runtime loader/owner if the integration needs lifecycle or settings rebuild handling. Keep graph ownership out of gameplay modules.
- `tests/` — add only focused tests for pure graph-selection/configuration logic if any is introduced; Babylon graph correctness is verified through MCP validation, build, and runtime.

### Terrain and look restoration

- `src/engine/ground.ts`, `src/engine/pack.ts`, `src/engine/TerrainMaterial.ts` — replace the flat ground material with an NME-loaded material and bind current ground data without a handwritten runtime shader path.
- `tools/build_ground.py`, `tools/ground_structure.py`, `tools/ground_splat.py`, and focused new build tools — bake geology, substrate, height/relief and splat masks from source data; preserve adaptive geometry/LOD and collision contracts.
- `public/packs/crater-lake/ground/` — generated terrain material textures, geological classification/splat masks, or rebuilt mesh data only as produced by the pipeline.
- `CREDITS.md` — record provenance/licensing for textures, generated textures and any model/material inputs actually included in shipped packs.

### Restored scene content and visual validation

- `src/engine/world.ts`, `src/core/startGame.ts`, `src/engine/flora.ts`, `src/engine/props.ts`, `src/biomes/crater-lake/index.ts` — restore and position existing boat/pier/vegetation/gameplay systems, retaining the current surveyed placement data and correcting only what comparison proves wrong.
- `tools/build_forest.py`, `tools/flora_place.py`, `tools/build_flora.py` — retain aerial-survey tree locations and rebuild/assign valid PBR material sets and LOD data as required.
- `CREDITS.md` and actual pack assets — keep provenance paired with the precise asset/source.
- `start-game.sh` — use as-is to launch the headed browser; append query parameters in the browser for a fixed time and perf instrumentation.

---

## Phase 1 — Framegraph, Full-Scene Baseline, and FPS Comparison

### Task 1: Capture the committed full-scene pre-framegraph baseline

**Files:** none; output is local measurement notes in the execution report, not a new document.

- [ ] Run the current full-scene build with `bun run typecheck`, `bun test`, and `bun run build`; record any pre-existing failures without changing unrelated files.
- [ ] Start the headed game with `./start-game.sh`, preserving its Chromium Vulkan, Dawn unsafe timing, and fullscreen launch flags.
- [ ] In the browser, use the existing `?perf&hour=11` development path. Record browser-reported backend/GPU, viewport size, camera position, average FPS after warmup, GPU-frame time, JS frame time, active-mesh evaluation, render-target time, draw calls, and shader compile time.
- [ ] Record at the standard established rim view (position near `(80, 286, -2956)` looking north) and the current initial location; keep time, camera, resolution, graphics backend, and optimizer/target-FPS state fixed for after measurements.
- [ ] Take a headed-browser screenshot at each recorded viewpoint. Do not use an image-only FPS claim: retain the instrumentation readings.

### Task 2: Construct the minimal replacement render graph with the NRG MCP

**Files:** `src/engine/framegraph/sojourney.json` (exported by the MCP), runtime integration to be finalized in Task 3.

- [ ] Use `babylonjs-node-render-graph_create_render_graph` to create `SojourneyMainRenderGraph`.
- [ ] Add inputs through the NRG MCP with required `additionalConstructionParameters`: a colour texture `[1]`, depth/stencil attachment `[8]`, camera `[16777216]`, and object list `[33554432]`. Set render texture `creationOptions` to full output size (`sizeIsPercentage: true`, 100% width/height), correct colour/depth formats, and `settings.msaaSamples`; do not connect a backbuffer texture to the clear block because Babylon's clear block excludes backbuffer inputs.
- [ ] Connect the Babylon default replacement path: colour/depth inputs → `NodeRenderGraphClearBlock` → `NodeRenderGraphObjectRendererBlock`; camera/object-list → `NodeRenderGraphCullObjectsBlock` → object renderer; renderer output → post-process chain matching the existing pipeline order → `NodeRenderGraphOutputBlock` (which copies to the backbuffer). Prefer Babylon-provided blocks; do not create custom render passes for standard rendering.
- [ ] Add NRG image-processing, bloom and sharpen blocks and copy the current scene's ACES tone-map, live exposure, bloom threshold/weight/kernel, and sharpen edge amount only after checking `DefaultRenderingPipeline`'s installed 9.29 order. Keep particles and sprites enabled, clustered lighting enabled, and shadows enabled in the object renderer; connect the actual scene camera/object list and required shadow-generator resources based on its installed port contract.
- [ ] Use `describe_graph` and `get_block_type_info` to confirm exact port names and settings. Run `validate_graph`; fix every required-input, output, and missing-construction-parameter issue before export.
- [ ] Export the valid graph JSON using `babylonjs-node-render-graph_export_graph_json` to `src/engine/framegraph/sojourney.json`. This graph is only the baseline replacement graph; do not add speculative visual effects or alter scene quality in this step.

### Task 3: Integrate the graph as Babylon's scene render path

**Files:** `src/core/startGame.ts`; new `src/engine/framegraph/index.ts` (or the smallest focused runtime module); `src/engine/environment/index.ts` only for integration changes required by verified NRG behavior.

- [ ] Verify installed Babylon 9.29 `NodeRenderGraph.Parse`, `buildAsync`, `scene.frameGraph`, `Scene._renderWithFrameGraph`, and object-renderer behavior before editing. `scene.frameGraph` replaces the ordinary scene render function; do not additionally call `frameGraph.execute()` in `onAfterRenderObservable`.
- [ ] Parse the MCP-exported JSON through the installed Node Render Graph API, assign external camera/object-list inputs from the current scene, set `scene.cameraToUseForPointers` to the gameplay camera, and build with automatic resize rebuilding enabled where compatible with graph-owned sample settings.
- [ ] Keep the main render callback ordered so Babylon scene callbacks (environment, ground stream, flora, player interaction observers, animation and physics) run as they do now. Keep `player.update()` executed once per frame after `scene.render()`; do not call it from both the normal loop and graph callbacks.
- [ ] Ensure shadow maps, the lake mirror, procedural textures, particles, atmosphere sky layers, utility layers/GUI, render-target callbacks, and scene observables still execute. Where the NRG object renderer omits an existing Scene render stage, use the matching Babylon NRG task/block or a small explicit dependency block rather than hand-rendering the feature.
- [ ] The current `DefaultRenderingPipeline` was built on the camera and has bloom, sharpen, image processing, and changing exposure. Verify in source/runtime whether it remains compatible with NRG replacement. Do not leave a post-process pass silently bypassed or double-applied. Transfer the same existing image-processing configuration and effects into NRG blocks or use Babylon's supported integration, keeping bloom threshold/weight/kernel, sharpen edge amount, ACES tone map and live exposure behavior equivalent.
- [ ] Keep `msaaSamples` live: if changing its value requires rebuilding the graph, route the existing setting apply callback through a single graph rebuild and await/catch errors without freezing rendering; use Babylon NRG texture creation options rather than a custom MSAA implementation.
- [ ] Add disposal/rebuild ownership only if needed to prevent graph/task leaks. Document each lifecycle action in code comments.
- [ ] Run `bun run typecheck`, `bun test`, and `bun run build` before browser validation.

### Task 4: Validate framegraph correctness and compare FPS in the headed game

**Files:** integration fixes in `src/core/startGame.ts`, `src/engine/framegraph/`, and `src/engine/environment/index.ts` only.

- [ ] Relaunch through `./start-game.sh`; use the same browser launch flags, fullscreen viewport, `?perf&hour=11`, camera locations, target-FPS/optimizer state, and warmup interval as Task 1.
- [ ] Check console and runtime errors for graph build/readiness errors, duplicate rendering, missing camera/pointer selection, shader failures, black screens, or lost post-process effects.
- [ ] Compare baseline and graph readings at the fixed views: FPS, GPU frame, CPU frame, mesh evaluation, render targets, draw calls, and compilation. Report the numbers and conditions without attributing a gain unless the measurements show one.
- [ ] Inspect the paired screenshots for atmosphere, tone mapping/exposure, water/mirror, shadows, sky layers, particles, ground, transparency, and AA. Test both WebGPU in the provided Chromium launch and the normal WebGL2 fallback if locally available without changing browser setup.
- [ ] If the graph produces an unacceptable visual regression or loses a core Scene path, fix it before moving to terrain work. The phase is complete only with a functioning framegraph replacement and a comparable before/after report.

---

## Phase 2 — Restore the Whole Scene Without Blindly Reverting WIP

### Task 5: Review and selectively recover the stashed work

**Files:** inspect `stash@{0}`; apply selected hunks only to their intended files.

- [ ] Inspect `git stash show --stat stash@{0}` and the full stash diff after Phase 1. It contains some purposeful performance/settings work as well as a deliberate stripped-world/flat-material state.
- [ ] Compare each candidate hunk with the now-measured committed full-scene and NRG implementation. Retain only verified work that aligns with the user's requirements; do not `git stash pop` and do not restore the flat-ground test state.
- [ ] Re-establish the real start location/boat/pier/tour, `Flora`, props, gameplay activities, carried items, dynamic world features and their callbacks from committed code or selected WIP changes. Confirm no feature is suppressed by `bareScene`, no test-only optimizer state persists, and boat/pier placements remain at surveyed positions.
- [ ] Keep the boat and both pier models as current placeholders; alter coordinates/heading only after visually checking against current POI references and the actual prop origin contracts.
- [ ] Run `bun run typecheck`, `bun test`, and `bun run build`; use headed Chromium to verify the boat, docks, flora, gameplay, water and interactive world are present.

---

## Phase 3 — Geological Terrain and High Relief

### Task 6: Establish geology labels and build-time classification inputs

**Files:** terrain tools under `tools/`; generated inputs under `assets/crater-lake/ground/` and `public/packs/crater-lake/ground/`; relevant provenance entries in `CREDITS.md`.

- [ ] Read the SIM 2832 pamphlet descriptions and inspect the existing geologic package before assigning codes. Use the descriptions of lithology/process to choose material identity; use references/photos only to judge visible presentation, not to infer geology.
- [ ] Resolve the known SIM 2832 quad overlap/approximate CRS risk. Confirm critical geology classes (Wizard Island, west lava flow, Llao Rock, Devils Backbone, Phantom Ship, Pumice Castle, caldera walls) against map source/pamphlet and survey position; do not use an ambiguous polygon sample as a hard truth.
- [ ] Build explicit survey-aligned masks for at least black scoria, oxidized upper-cone scoria, blocky andesite lava, pale pumice/ash deposits, talus/scree, forest duff/needle litter, and exposed rock. Preserve the existing calibrated splat inputs as candidate channels; add channels/masks only where needed and within device binding budgets.
- [ ] Keep classification computation offline/build-time. Do not sample geodata, derive normals, or create/downscale material assets at runtime.
- [ ] Add numeric/visual checks for mask orientation, dimensions, valid coverage, correct lake/land separation, and representative points/regions. Ensure the new masks map to the DS-716 world origin and pack orientation.

### Task 7: Correct macro relief where source geometry is too soft

**Files:** `tools/build_heightmap.py`, `tools/heightfield.py`, `tools/build_ground.py`, `tools/ground_mesh.py`, new focused terrain tool(s) only if necessary, generated ground pack assets.

- [ ] Start from the current DS 716 2 m common surface and adaptive 2/4/8/16 m tile geometry. Preserve established collision-heightfield, quadtree, LOD, block batching, edge skirt, and lake-mask contracts.
- [ ] Compare hillshades and in-game views for Wizard Island cone/crater and base, westward lava lobe, steep caldera wall, Llao Rock, Devils Backbone, Phantom Ship, Pumice Castle, and shoreline against the numeric survey and geology descriptions.
- [ ] Where the 2 m/10 m input has genuinely rounded a feature that the geologic descriptions identify as shear/angular, make deterministic bake-time edits or inject source-referenced higher-resolution relief; do not add arbitrary runtime vertex noise. Preserve the 35-degree cone, crater approximately 300 ft wide by 90 ft deep, block-lava macroscale ridges/troughs, and sharp cliff boundaries when corroborated by survey/geology.
- [ ] Retain fit-to-source and tile-boundary error checks; verify changed forms against source DSM/DEM, collision surface, and adjacent LODs. Confirm players cannot see tile cracks or stand above/below the modified surface.
- [ ] Rebuild only the needed terrain products through the established tools. Do not replace the DS 716 surface with procedural noise or photo-derived shape.

### Task 8: Construct each terrain material in NME using the MCP

**Files:** NME graph JSON assets under an agreed material subfolder in `public/packs/crater-lake/ground/` (or a source graph folder under `assets/`); `src/engine/ground.ts`; `src/engine/pack.ts`; `CREDITS.md`.

- [ ] Use the Node Material MCP to create/inspect/validate every new or replaced terrain/world surface material graph. Export each as NodeMaterial JSON; do not hand-author a parallel GLSL/WGSL implementation. Existing unmodified glTF prop/tree materials remain their authored glTF materials.
- [ ] Use `InputBlock`, `TextureBlock`/`ImageSourceBlock`, supported triplanar projection, `PerturbNormalBlock`, and Babylon PBR/output blocks for rock/scoria/pumice/soil/duff materials. For geology masks, use NME connections to select/blend appropriate physical material layers with packed albedo/normal/AO inputs. If a single focused `CustomBlock` is required for a GPU-side mask/blend expression that the registered graph blocks cannot represent, author that CustomBlock through the NME MCP and explain the gap; do not manually patch generated shader source.
- [ ] Separate material assets by genuinely different physical surfaces where that improves fidelity (e.g. block-lava faces versus granular scoria and pale pumice), while avoiding per-tile material duplication. Keep shared graph/material instances, textures and sampler counts within Babylon/WebGPU guarantees.
- [ ] Encode colour textures as sRGB and normals/masks as linear; author full mip chains and a consistent texel-density target. Prefer high-quality captured material textures where their physical appearance matches the geology. AI/generated material sets are for uncovered material types, not a blanket replacement for good scans.
- [ ] Include fine relief via normal maps and coarse relief via surveyed mesh geometry; do not fake shear edges with a high-frequency bump alone. Keep normal influence plausible for volcanic substrate and smooth/glassy block faces without making whole lava fields shiny.
- [ ] MCP workflow for every graph: `create_material` → add/connect NME blocks → describe/inspect → `validate_material` → export NME JSON. Start/get an NME editor session URL for visual graph inspection when needed. Parse/apply the exported JSON in the game with Babylon NodeMaterial API and wait for compilation/readiness before assigning it to terrain.
- [ ] Preserve dithered LOD fade support and existing atmosphere/PBR integration. Verify both WGSL/WebGPU and GLSL/WebGL2 code paths via actual runtime shader compilation.
- [ ] Record source URL/name, artist/author, licence or pending written-rights status, and whether the source was used as reference, texture input, generated output input, or shipped texture. Add/refresh `CREDITS.md` entries for assets that ship.

### Task 9: Wire material and geological coverage; visually iterate

**Files:** `src/engine/ground.ts`, `src/engine/pack.ts`, `tools/build_ground.py`, NME graph/pack manifest and generated images.

- [ ] Replace `createFlatGroundMaterial` with the NME NodeMaterial loader and bind the verified pack classification maps/material data. Remove obsolete shader plugin code only after NME replacement renders identically or better and all consumers have migrated.
- [ ] Restore real terrain and lake-bed materials. Keep the current lake bed arrays as candidate sources; check the green moss band under the flashlight, particularly because the last issue report says it reads as yellow straw. Change only the incorrect biological/geological layer and keep the sourced depth-band roles.
- [ ] Inspect at 30 cm, walking height, mid-distance and rim scale in clear noon, low sun, wet ground, and under-water views. Use existing reference imagery for appearance comparisons, but choose materials according to geology, not image colour alone.
- [ ] Check caldera dark rock/talus relationships, pumice deposits, shoreline cobbles, vegetation duff, POI geology and surveyed layer extents for seams, camouflage-like noise, repetitive tiling, false horizontal contour bands and uniform over-darkness.
- [ ] Validate material graph, pack format, texture orientation, layer channels and all NME shader variants. Rebuild and re-open with the actual `start-game.sh` browser launch.

---

## Phase 4 — Forest, Props and Remaining Scene Quality

### Task 10: Restore aerial-survey vegetation and PBR response

**Files:** `src/engine/flora.ts`, `src/engine/world.ts`, `src/biomes/crater-lake/index.ts`, `tools/build_forest.py`, `tools/build_flora.py`, model materials/assets only when necessary.

- [ ] Reuse the current lidar/NPS vegetation survey placements, canopy sizes, and existing LOD/streaming patterns; do not randomize away measured individual tree positions.
- [ ] Compare park-wide vegetation classes and actual Wizard Island flora facts. Island uses western hemlock in lower elevations, whitebark pine around the upper rim, sparse species diversity, and bare scoria/rock/cinder patches. Wider caldera zones follow the NPS VMI map classes and canopy records. Do not spread park-wide species uniformly onto Wizard Island.
- [ ] Inspect current GLB PBR channels, normals, alpha cards, handedness, KTX2 maps, and material response under current physical environment lighting. Repair materials/assets in the authoring/build pipeline where necessary; preserve authored LOD sizes and keep copies/shared materials efficient.
- [ ] Add only evidence-supported shrubs/ground cover where survey and facts support them; keep bare pumice/scoria/talus dominant where the ecological descriptions say sparse cover.
- [ ] Keep source and licensing records for any changed models or foliage textures and rebuild the relevant assets without touching unrelated output files.

### Task 11: Place and validate the boat and piers in the right locations

**Files:** `src/biomes/crater-lake/index.ts`, `src/engine/props.ts`, `src/engine/boat.ts`, only if measured corrections are required.

- [ ] Retain the Dutch ship placeholder and existing pier models. Do not replace these two models in this pass.
- [ ] Confirm each model's local origin, deck/waterline and heading from `props.json` and the earlier props brief. Verify existing Cleetwood Cove and Wizard Island pier positions/pitches against shoreline, dock evidence and gameplay boarding route.
- [ ] Use existing NPS/USGS/Commons reference records for placement only with source metadata; note image licensing even though these photos are not automatically shipped.
- [ ] Keep boat route/starting berth, tour positions and collision decks coherent; visually inspect from shore, on the pier, aboard, and from lake surface. Change coordinates only if the current placement demonstrably conflicts with the real geography or mesh contracts.

---

## Phase 5 — Full Verification and Asset Provenance

### Task 12: Run full regression checks and headed-browser visual review

**Files:** implementation files only; no extra report/document requested.

- [ ] Run `bun test`, `bun run typecheck`, and `bun run build` after final changes.
- [ ] Run `./start-game.sh` for every final headed check. Confirm it remains the source of browser flags and fullscreen mode; append only visual/perf query parameters in the opened page.
- [ ] Recheck the same fixed full-scene FPS locations and metrics from Phase 1, then check boat route, docks, terrain boundary crossings, current LOD transitions, water reflection, gameplay interactions, time-of-day effects, rain, shadowing, lake-floor depth, and responsive settings.
- [ ] Check Chromium WebGPU and WebGL2 where available. Report shader compilation/backend coverage accurately; do not claim unsupported backend coverage.
- [ ] Compare final material/terrain screenshots with the relevant documented geologic units and the sources listed in the reference registry. Ensure the final scene has high relief and no missing original game features.
- [ ] Check `git status` and the diff so the final changes do not include accidental user images/references or old shaders/assets unintentionally kept after the new graph path is adopted.
- [ ] Preserve `stash@{0}` until the project lead explicitly confirms the WIP can be discarded.

## Completion Criteria

- The full scene renders through Babylon's replacement framegraph and remains interactive with existing shadows, mirrors, particles, atmosphere, tonemapping, exposure, bloom/sharpen, MSAA behavior and render-target observables intact.
- A reproducible headed-browser A/B baseline and graph-path measurement exist under matching hardware, view, time, window, optimizer and instrumentation conditions.
- Terrain surface appearance follows geological unit descriptions and DS-716/VMI structure with visibly crisp cliffs and correct high relief; no critical surface material remains the flat test placeholder.
- Each procedural/terrain material is authored and validated through NME MCP. Material normal/color-space/texture-array data is correct and optimized for GPU use.
- Survey-derived forest patterns and their near/far representations return with corrected PBR/lighting response; boat and piers remain the existing models at verified approximate locations.
- Tests, typecheck, build, WebGPU runtime checks and applicable WebGL2 runtime checks pass; licence/provenance is tracked for changed shipping assets.
