# Sojourney Asset Pack Pipeline — Design Doc (v0.1, Sept 2026)

**Status:** Draft for review. Synthesizes the eight research docs in this project into one pipeline.
**Proving ground:** replace the existing Wizard Island (Crater Lake) pack end to end.
**Working name for the tool:** `packsmith` (a CLI + an agent skill that drives it).

Related docs (all in `docs/research/`): `biome-classification-research.md`, `source-registry.md`, `surface-data-layers.md`, `wizard-island-fact-check.md`, `3d-asset-generation-research.md`, `2d-and-audio-asset-generation-research.md`, `fauna-rigging-ik-pipeline-research.md`, `additional-questions.md`.


## Status as of 2026-10-02

This document was withdrawn with the other designs on 2026-10-01 and restored on 2026-10-02 at the
project lead's request. The sections below the line are the original v0.1 text, unrevised. Where they
conflict with `AGENTS.md` (Babylon first, everything on, one target frame rate, assets carry the
quality), `AGENTS.md` wins, and the pack contract in `src/engine/pack.ts` supersedes §5 and §7. Its
related research docs are in `docs/research/`; its roadmap is `docs/plans/2026-09-28-packsmith-roadmap.md`.

What exists today, by stage. There is no `packsmith` CLI yet: each stage is a separate tool in `tools/`,
run by hand for Crater Lake.

| Stage | Today |
|---|---|
| 2–3 Data, terrain, water | `tools/build_heightmap.py` builds a 2 m grid of the 18 km map from USGS Data Series 716 (1 m lidar + multibeam bathymetry), fills the shoreline gap and writes a flood-filled lake mask; `tools/heightfield.py` is the one surface every tool samples. `tools/build_ground.py` is being rebuilt around quadtree tiles whose mesh step is chosen by error, with detail and collision streamed near the player (`docs/specs/2026-10-02-terrain-ds716-design.md`). `tools/ground_normalmap.py` bakes a whole-map normal and sky-visibility map from the 1 m surface (`docs/specs/2026-10-02-ground-normal-ao-contract.md`). |
| 4 Classification maps | Not built. The inputs are catalogued and downloaded (`docs/research/crater-lake-reference-imagery.md`): NPS vegetation map, lidar canopy height, NAIP orthophotos, NHD hydrography, NPS trails/roads/facilities, the USGS geologic map. Ground painting is still noise-based (`tools/ground_splat.py`). |
| 5 Look-dev | By eye against two reference photos (south rim, Cleetwood Cove trail), using the Chrome DevTools MCP. |
| 6 Ground materials | Poly Haven CC0 layers as KTX2. The material is a hand-written plugin at the 16-sampler limit; it is to be re-authored as a Node Material through the Babylon node-material MCP. |
| 7 Vegetation | `tools/build_flora.py` builds LOD models and seeded placements; placements do not yet use the vegetation or canopy data. |
| 8 Props | `tools/build_props.py` builds props (fire pit, pier, boat) with LOD levels and a `props.json` of bounds and walkable surfaces. |
| 9–11 Fauna, audio, climate | Not started under the new engine. |
| 12 Packaging | `tools/build_pack_index.py` writes the pack file index. |
| 13 In-engine verification | Done per change through the Chrome DevTools MCP: screenshots from fixed viewpoints, frame rate, console. |

Decisions since v0.1 that change the design:

- **Authoring goes through the Babylon MCP servers where one exists** (node materials, node geometry,
  node particles, node render graphs, smart filters, flow graphs, GUI), so assets land in the engine's
  own formats. Meshes, textures and terrain tiles stay glTF + KTX2 + meshopt per Babylon's asset guide.
- **The engine does not bake, derive or downscale assets at runtime**; everything in §3–§5 that implies
  runtime derivation moves into the pipeline.
- **Performance has one input**, the target frame rate driving Babylon's `SceneOptimizer`; the device
  budgets in §5.3 become asset budgets set by how many assets are on screen at once.
- **The whole park matters**, not just the caldera: the elevation data covers 28 × 36 km and the map
  size is one constant.

A full revision of the sections below is still to be done.

---

## 1. Summary

The goal is a tool where someone says *"I'd like to experience Flaming Gorge"* and gets a complete Sojourney asset pack: terrain, water, ground materials, vegetation, fauna, audio, climate and weather, all traceable to real sources.

**Is fully hands-off generation possible?** Partly, and more than it sounds. The research splits the work into three kinds:

| Kind of work | Examples | Can it run unattended? |
|---|---|---|
| **Data-derived** | Terrain, bathymetry, substrate map, vegetation class map, tree density and snags, species list, climate profile | **Yes, for most of the US.** These come from national datasets (3DEP, NAIP, LANDFIRE, TreeMap, GBIF, Köppen). |
| **Generated, then checked by rules** | Tree meshes from species presets, ground materials from CC0 libraries, hero rocks, ambience audio, packaging, budgets, licensing | **Mostly.** Generation is automatic; automated gates catch most failures. |
| **Judged by eye** | "Does the daylight look real?", "Does this rock read as block lava?", "Does the squirrel move like a squirrel?" | **Agent-directed.** Claude can look at screenshots and compare to reference photos, but a human should sign off on a pack before it's marked verified. |

So the design has two modes that share one pipeline:

- **Autopilot:** one prompt produces a **Draft pack** automatically. Every stage runs, every gate runs, and the result loads and plays. It's accurate where data exists and labelled "plausible" where it doesn't.
- **Director mode:** Claude (or a person) iterates on the Draft: reviews renders against reference photos, regenerates weak assets, fixes placement. This produces a **Verified pack**.

Director mode is where quality comes from. The design bet is that autopilot gets far enough that directing is refinement rather than construction, and that we measure this instead of guessing (§12, milestone M9).

## 2. Goals and non-goals

**Goals**

1. **Accuracy first.** Every species, material and landform traces to a cited source, or is labelled "plausible." No invented names (see the "Wizard Island Toad" in the fact-check).
2. **Immersion over spectacle.** Daylight, close-up (30 cm) views, sound and footing matter as much as the hero view.
3. **Repeatable for any place.** Nothing in the pipeline is Wizard Island-specific except the inputs.
4. **Cheap enough for volunteers.** A free, no-GPU path must produce a valid pack (packsmith is offered for non-commercial use so people can build community packs; decided 2026-09-28).
5. **Machine-checkable.** Every stage has a gate. A pack that fails a gate doesn't ship.

**Non-goals (for v1)**

- Places outside the US (the data stack is US-heavy; §11 covers what degrades).
- Caves (on the back burner per `source-registry.md`).
- Historical eras. Ship present-day midsummer first (decision pending, §13).
- Generative animal motion (research-stage; revisit 2027 per the fauna doc).

---

## 3. Architecture

```
                    "I'd like to experience Wizard Island"
                                     │
                           ┌─────────▼─────────┐
                           │   Orchestrator     │  Claude + packsmith skill
                           │  (plan, run, judge)│  pack.plan.json tracks state
                           └─────────┬─────────┘
       ┌──────────────┬──────────────┼──────────────┬──────────────────┐
       ▼              ▼              ▼              ▼                  ▼
 ┌───────────┐ ┌────────────┐ ┌────────────┐ ┌─────────────┐  ┌───────────────┐
 │ Research  │ │ Data plane │ │ Generation │ │ Blender     │  │ Engine plane  │
 │ plane     │ │ GDAL/rasterio│ plane     │ │ plane       │  │ Sojourney dev │
 │ web, GBIF,│ │ 3DEP, NAIP,│ │ TRELLIS.2, │ │ Blender Lab │  │ server +      │
 │ NPS, iNat │ │ LANDFIRE,  │ │ EZ-Tree,   │ │ MCP (5.1+), │  │ Chrome DevTools│
 │ fact-check│ │ TreeMap... │ │ UniRig,    │ │ headless    │  │ MCP           │
 │           │ │            │ │ audio gen  │ │ bpy scripts │  │               │
 └─────┬─────┘ └─────┬──────┘ └─────┬──────┘ └──────┬──────┘  └───────┬───────┘
       └─────────────┴──────────────┴───────┬───────┴─────────────────┘
                                            ▼
                               ┌────────────────────────┐
                               │ Validation gates        │  glTF validator, albedo lint,
                               │ (automated, blocking)   │  budgets, licenses, citations,
                               └───────────┬────────────┘  reference-view diff
                                           ▼
                                  pack/ + manifest.json
```

### 3.1 The five planes

| Plane | Runs where | Main tools | Why it exists |
|---|---|---|---|
| **Research** | Cloud sandbox or any Claude session | Web search/fetch, GBIF API, iNaturalist, NPS pages, Crater Lake Institute | Turns a place name into a cited **site dossier**: what's there, what isn't, what's been invented by others. |
| **Data** | Cloud sandbox (Python, GDAL, rasterio, PDAL) | 3DEP / USGS DS 716, SIM 2832, NPS veg map, TreeMap, NAIP, LANDFIRE, OSM | Rasters and vectors → heightmaps, class maps, density maps, placement points. Deterministic, scriptable, no judgment needed. |
| **Generation** | Local GPU, Hugging Face Spaces, or hosted APIs | TRELLIS.2, Stable Fast 3D, EZ-Tree, CC0 libraries (Poly Haven, ambientCG), Dream Textures, Stable Audio Open, UniRig / Tripo Rig | Makes the meshes, materials, rigs and sounds the data says we need. |
| **Blender** | User's machine or a GPU box (needs Blender 5.1+) | **Blender Lab MCP** (official, v1.0 April 2026, GPL; 26 tools incl. Python execution, viewport screenshots, headless `_for_cli` variants). Community "MCP for Blender" (ahujasid, MIT) as fallback; it also wraps Rodin/Hunyuan/Tripo and Poly Haven. | Cleanup, retopo, decimation, LOD chains, wind-weight baking, impostor baking, rigging fixes, Spline IK. All work is **scripted bpy**, so every step is re-runnable; the MCP is how Claude drives and inspects it. |
| **Engine** | User's machine, real GPU | Sojourney dev server + **Chrome DevTools MCP** (Google's official server: screenshots, `evaluate_script`, performance traces, heap snapshots, console, network, device emulation; can attach to an existing Chrome via `--browser-url`) | Loads the pack in the real engine, drives camera/time/weather, captures evidence. This is the same way the engine itself is tested. |

**Why the engine plane runs on a local machine, not in the cloud sandbox:** the sandbox's Chromium has no real GPU. WebGPU, the atmosphere add-on, volumetrics and memory numbers would all be wrong or missing there. The DevTools MCP attaches to a headed Chrome on real hardware. Claude in Chrome is an acceptable alternative for interactive walkthroughs; DevTools MCP is preferred for the automated harness because of performance traces and heap snapshots.

**Security note:** the Blender Lab MCP executes Python "without any guards," and its docs recommend a VM. Run Blender for the pipeline in a separate user account or VM, with the pack workspace as the only shared folder.

### 3.2 State and re-runs

Everything the pipeline does is recorded in `pack.plan.json` inside the pack workspace:

- Each stage's status (`pending | running | passed | failed | waived`), inputs (with hashes), outputs, tool versions and timestamps.
- Waivers must carry a reason and who granted them.
- Stages are idempotent. Changing an input (say, a new species preset) invalidates only downstream stages, like a build system.

This is what makes director mode workable: "the hemlocks look too dense" becomes *edit the density rule, re-run Stage 7 onward*, not *start over*.

---

## 4. Pipeline stages

Each stage lists **inputs → outputs**, the **autonomy level**, its **gate**, and the **Wizard Island** specifics.

Autonomy levels: **A** = automatic, **A+R** = automatic with Claude review of renders, **D** = directed (Claude or human chooses among options), **H** = human sign-off.

### Stage 0 — Intake and site resolution (A)

**In:** a free-text request. **Out:** `site.json`.

- Resolve the name to a boundary polygon (NPS unit boundaries, USGS GNIS, OSM relations). If ambiguous ("Flaming Gorge" = reservoir, NRA, or canyon?), autopilot picks the most-cited feature and records the choice; director mode asks.
- Choose the **playable area** (walkable, full detail) and the **view shed** (distant ring visible from the playable area, low detail). For Wizard Island: playable = the island plus a shoreline band; view shed = the whole caldera rim (Llao Rock, Hillman Peak, Garfield Peak) and Mount Thielsen on the horizon.
- Tag with the biome stack from `biome-classification-research.md`: **IUCN GET EFG**, **RESOLVE ecoregion**, **Köppen-Geiger class**.
- Record the **moment in time**: season, era (default: present-day midsummer).
- Record **cultural context** (§14d of additional-questions): link to the tribes' own published material; never generate lore. Wizard Island: *giiwas*, sacred to the Klamath Tribes.

**Gate:** boundary valid, tags present, local origin defined (lat/lon/elevation of the pack's (0,0,0)).

### Stage 1 — Site dossier and fact base (A+R, H for "verified")

**In:** `site.json`. **Out:** `dossier.md` (human-readable) and `facts.json` (machine-readable).

This stage turns the method used in `wizard-island-fact-check.md` into a repeatable procedure:

1. **Pull species candidates** from GBIF occurrences inside the bounds + buffer (filtered to CC0/CC BY; NC records only with an obtained licence), iNaturalist research-grade, park species lists, eBird (its API bans commercial use, so it needs a separate agreement).
2. **Pull descriptive sources**: NPS pages, geologic maps and pamphlets, archival *Nature Notes*-style field observations, trail pages.
3. **Classify each claim** as `observed` (cited occurrence inside the playable area), `nearby` (cited in the wider park/view shed), or `plausible` (fits the ecoregion but no local citation).
4. **Adversarial pass:** a second agent tries to refute each claim, especially names and endemic/unique status. The fact-check found three hallucinations in one AI brief; this pass exists because of that.
5. **Derive hard constraints**: species caps (Wizard Island ≈ 60 plant species total), absences that matter (island visibly less diverse than the caldera wall), era-sensitive facts (crayfish present, Mazama newt now rare).

`facts.json` entries carry a taxon ID (GBIF), status, habitat rules, citations and a "visual notes" field (e.g. *western hemlock dominant on lower half; whitebark pine encircles crater rim*).

**Gate:** every entry that will spawn has ≥1 citation or is labelled `plausible`; no entry is `observed` without an in-bounds source; the adversarial pass found no unresolved contradictions.

**Wizard Island seed:** the fact-check doc is effectively a hand-made `facts.json`. Stage 1 should reproduce it from scratch and be scored against it: this is the first automation test (§12).

### Stage 2 — Data acquisition and normalization (A)

**In:** `site.json`. **Out:** `data/` of reprojected rasters/vectors on one local grid.

| Layer | Wizard Island source | General US fallback |
|---|---|---|
| Elevation (land + lakebed) | **USGS DS 716**, 1 m merged lidar + bathymetry | 3DEP 1 m / 1/3″ DEM |
| Lidar points (canopy) | 2010 DOGAMI Crater Lake lidar (~1.6 pts/m²; test whether usable for tree segmentation) | 3DEP lidar where available |
| Geology / substrate | **USGS SIM 2832** GIS (cinder cone vs block lava vs talus) | State geologic maps; gSSURGO soils |
| Vegetation class | **NPS Crater Lake Vegetation Mapping** geodatabase | **LANDFIRE EVT** (30 m) |
| Stand structure, snags | **USFS TreeMap v2022** (live/dead trees per acre, height, diameter, canopy) | Same (CONUS-wide) |
| Colour ground truth | **NAIP** (~0.6 m) | Same |
| Infrastructure | NPS maps, OSM (Governors Bay dock, summit trail, west trail) | OSM |
| Climate | Köppen class + station normals (to confirm: NOAA 1991–2020 normals, PRISM) | Same |

- Reproject everything to a local **East-North-Up** metric grid centred on the site origin. Babylon is Y-up, left-handed by default; do the conversion once, in this stage, and record it in the manifest.
- Tile from day one (e.g. 256 m tiles), even though Wizard Island fits in one. Grand Canyon won't, and Babylon 9's 3D Tiles and floating-origin support are the path for large sites.

**Gate:** all required layers present or explicitly substituted with a fallback; CRS and extents match; no-data holes below a threshold.

### Stage 3 — Terrain, water body and horizon (A, A+R)

**Out:** terrain tiles (mesh or heightfield), physics colliders, water surface + depth map, distant horizon ring.

- **Near terrain:** heightmap → mesh LOD chain per tile. Physics via Babylon's Havok plugin: heightfield collider, with walkability metadata from Stage 4.
- **Lakebed:** DS 716 bathymetry is needed because Crater Lake's clarity (record Secchi depth 42 m) means the underwater shoreline is **visible from shore**. Submerged block-lava margins and drop-offs are part of the view.
- **Water material:** depth-driven absorption and scattering fed by the bathymetry depth map. This is its own asset with its own look-dev (Stage 5).
- **Horizon ring:** caldera walls at reduced resolution, coloured from NAIP, blended with aerial perspective from the atmosphere add-on. Decision pending: does this belong to a shared **"Crater Lake" base pack** that future rim/Cleetwood experiences reuse? The design supports **pack dependencies** either way (§6).
- **Macro features the DEM might under-resolve** get procedural enhancement driven by the dossier: the westward block-lava lobe with **concentric pressure ridges up to 60 ft**, rain pools in troughs, the 300 ft × 90 ft summit crater, the 35° cinder slopes.

**Gate:** terrain within tolerance of the source DEM at sample points; colliders watertight; horizon silhouette matches the reference view (Stage 13).

### Stage 4 — Classification maps (A)

**Out:** per-tile rasters that everything downstream reads.

- **Substrate class** (from geology + slope + dossier refinements). Wizard Island classes: `scoria_black` (lower cone), `scoria_oxidized` (red/brown, upper third near rim), `block_lava` (base apron and west lobe), `crater_floor_soil`, `talus`, `shoreline_cobble`, `needle_duff` (under canopy), `trail`.
- **Vegetation class** (veg map, else LANDFIRE) and **density rasters** (TreeMap live/dead per acre, canopy cover, height).
- **Derived masks:** shoreline band, slope > 35°, north/south aspect, snow persistence (for later seasons), distance-to-water.

Each substrate class is **one tag** that drives visuals, footstep audio, friction/slip and fauna spawning (additional-questions Q11). The tag table lives in the manifest.

**Gate:** every walkable cell has exactly one substrate class; every class used has a material, a footstep set and physics params defined.

### Stage 5 — Look-dev and lighting calibration (D, H once per engine version)

**This comes before any asset is judged.** Additional-questions Q1: the daytime scene is probably a lighting problem as much as an asset problem, and new assets can't be judged under broken light.

- A **look-dev scene** in the engine: grey ball, chrome ball, colour-checker, reference materials of known albedo (including a ~4% albedo "fresh asphalt" reference for black scoria).
- Babylon 9 **Physically Based Atmosphere** add-on; locked tonemapper (**Khronos PBR Neutral**) and exposure model. Watch the known issue with the atmosphere plugin and cube environment textures; add a sun disc ourselves.
- Sun position from site lat/lon + date/time (Wizard Island ≈ 42.94° N, 122.15° W, 6,940 ft).
- Foliage translucency, shadow cascade settings sized to the playable area.

This is mostly **engine work**, done once and re-verified per pack. Output is a `lighting.json` profile each pack can adjust only within bounds (e.g. haze, not tonemapper).

**Gate:** look-dev renders match reference captures within tolerance at 3+ times of day; albedo references read correctly.

### Stage 6 — Ground materials (A+R)

**Out:** one PBR material set per substrate class + micro-scatter + snow layer hooks.

Sourcing order (from the 2D/audio doc):

1. **CC0 scanned libraries** (Poly Haven, ambientCG) — best fidelity for common materials.
2. **Photo-to-PBR** from licensed reference photos (iNaturalist CC0/BY, own captures) — ArmorLab or Substance Sampler.
3. **AI generation** (Dream Textures in Blender, local) only for gaps, e.g. oxidized red scoria.

Every material also needs:

- **Albedo lint** against physical ranges (warn, don't fail, on very dark scoria/lava).
- **Texel density** standard and **detail normals** for 30 cm viewing (Q12).
- **Micro-scatter** meshes per class: scoria lapilli and bombs, pumice, whitebark cones, hemlock needles.
- A **snow layer** implemented as a blend on top of substrate, not duplicate materials (Q6), so winter is a later variant not a rebuild.

**Wizard Island:** black scoria base; oxidized red/brown only near the rim; **block lava** (angular blocks with smooth, slightly glassy faces up to 30 ft), *not* a'a clinker; crater floor with grass/sedge/rush and Tolmie's saxifrage.

**Gate:** lint passes; tiling not visible at 3 test distances; Claude review against NAIP colour and reference photos.

### Stage 7 — Vegetation (A, A+R)

**Out:** species tree library (shared), per-pack placement, LODs, impostors.

- **Trees:** EZ-Tree (MIT) with a **parameter preset per species**, keyed by GBIF taxon ID and stored in the **shared library** (§6). Wizard Island presets: *western hemlock* (dominant lower half), *whitebark pine* (rim, encircling the crater), optional low-density *lodgepole pine* / *Shasta red fir* labelled `plausible` unless the veg map places them.
- **Presets are tuned by Claude against reference photos** of each species (iNaturalist CC0/BY): an A+R loop — generate, render in Blender and engine, compare silhouette/branching/colour, adjust parameters.
- **Snags and downed logs** from TreeMap dead-trees-per-acre. Whitebark pine decline (blister rust, beetles; ESA threatened 2022) means grey snags are part of the true look.
- **Placement:** lidar tree positions if density allows (test on DOGAMI data); otherwise Poisson-disc sampling constrained by veg class, TreeMap density/height distributions and substrate (nothing rooted in fresh block lava faces without soil pockets).
- **Build-time bakes (can't be added later):** per-vertex wind weights, LOD chain, octahedral impostor atlas (port an open implementation; Babylon has none built in).
- **Ground flora:** fireweed (shore), Applegate's and spider-web paintbrush (upper), mountain daisy, arnica, bleeding heart, mountain ash; grass/sedge/rush on crater floor. Small plants as instanced cards (transparent-background image gen) or small meshes; respect the ~60-species cap.
- Render with thin instances (benchmark vs `EXT_mesh_gpu_instancing`).

**Gate:** species all present in `facts.json`; density within TreeMap distribution; budget; no floating/buried trunks (automated ground-contact check).

### Stage 8 — Hero props and geology (D, A+R)

**Out:** rocks, lava blocks, volcanic bombs, driftwood, rim boulders, dock.

- **Generate:** TRELLIS.2 (MIT; HF Spaces free tier or local 24 GB GPU) from reference photos; Stable Fast 3D / TripoSR for fast drafts. Not Hunyuan3D by default (territory restriction excludes EU/UK/KR volunteers).
- **Clean up in Blender (scripted via MCP):** remove non-manifold geometry, decimate/retopo, re-bake textures to the pack's texel density, LOD chain, convex-hull colliders, surface tag.
- **Variation over count:** 5–8 base meshes per prop class, scattered with scale/rotation/tint jitter.
- **Optional Gaussian splats** for hero rocks (Babylon 9 SPZ support). Pending decision: splats bake in lighting, so they must pass the Stage 5 time-of-day sweep.

**Wizard Island props:** block-lava blocks (several sizes up to building-sized), volcanic bombs near base (≤2 ft), rim blocks (>6 ft), drift logs on shore, Governors Bay dock, trail edging.

**Gate:** glTF validator, triangle/texture budgets, Claude side-by-side against references.

### Stage 9 — Fauna (D, A+R)

**Out:** rigged, animated creatures with habitat-driven spawn rules.

Per the fauna doc:

1. **Mesh:** same generators as Stage 8, from reference photos.
2. **Rig:** UniRig (MIT, self-hosted or Replicate) as the open default; Tripo Rig API where categories fit better (it has explicit serpentine/avian/aquatic skeletons).
3. **Motion:** Tripo retarget presets or hand-keyed cycles for legged animals; Cascadeur (quadruped alpha) for polish; **Blender Spline IK** for the garter snake (no AI).
4. **Behaviour:** simple engine-side state machines (idle, forage, flee, hide) plus **habitat spawn rules** from Stage 4 masks. Species with blurred public coordinates are placed by habitat, not location.

**Wizard Island roster** (from the fact-check; all `observed` unless noted): golden-mantled ground squirrel, Klamath and Allen's chipmunks, pika (talus), deer mouse, Mazama red-backed mouse, **melanistic garter snake** (dark lava), western toad (near shore). Aquatic: signal crayfish (present-day rocky shore), Mazama newt (rare now). Birds (park-wide; `nearby` until verified on the island): Clark's nutcracker (with whitebark cones), mountain chickadee, dark-eyed junco, Steller's jay, gray jay; osprey/bald eagle as distant flyovers. Fox/bobcat as **track decals only**.

**Gate:** each species in `facts.json`; rig validation (no missing tail/limb bones); animations loop cleanly; foot contact checked on slopes.

### Stage 10 — Audio (A, D for species)

- **Ambience beds** (wind in hemlock, lapping water, distant wind on the rim): Stable Audio Open / AudioCraft locally, or hosted generators.
- **Species calls:** real recordings only (xeno-canto, Macaulay, NPS Sound Gallery). NonCommercial recordings need a commercial licence from the recordist or archive; no ShareAlike sources in official packs.
- **Footsteps** per substrate class (scoria crunch, block-lava clack, needle duff, soil).
- Spatialized with `AudioEngineV2`; call timing driven by time of day and season from the dossier.

**Gate:** every clip licensed and attributed; loudness normalized; no species call without a matching `facts.json` entry.

### Stage 11 — Climate and weather profile (A)

The engine already has day/night and weather. The pack supplies the site-specific parameters:

- Monthly normals: temperature, precipitation, cloud frequency, wind, snow depth (Crater Lake averages ~41 ft of snow a year; melt usually by late June).
- Weather preset weights by season (e.g. midsummer: mostly clear, afternoon cumulus, occasional thunderstorms — **to confirm against station data**).
- Sun/moon/star field from lat/lon (the engine's existing night sky is a strength to keep).

**Gate:** profile fields complete and sourced.

### Stage 12 — Assembly and packaging (A)

- Optimize: **gltfpack** / **glTF-Transform** → `KHR_texture_basisu` (KTX2), `EXT_meshopt_compression`, `KHR_mesh_quantization`.
- Validate with the **Khronos glTF Validator**.
- Write `manifest.json` (§5), generate `CREDITS.md` from per-file provenance (including any licence obtained from a rights holder).

### Stage 13 — In-engine verification (A+R) via Chrome DevTools MCP

This is where "does it actually work and look right?" is answered in the real engine.

**Harness steps (scripted, run by Claude through the DevTools MCP):**

1. Start the Sojourney dev server; attach the MCP to a headed Chrome on real hardware.
2. `evaluate_script` → load the pack through the engine's test hooks (§7).
3. For each **reference viewpoint** in the manifest (Wizard Island: Sinnott Overlook webcam pose, summit rim, Governors Bay dock, west lava lobe, a 30 cm ground view on scoria, underwater shoreline), and each **time of day** (dawn, noon, golden hour, night): set camera/time/weather, wait for streaming to settle, `take_screenshot`.
4. **Performance:** `performance_start_trace` during a scripted walk; read draw calls, triangles and texture memory from the engine hooks (Babylon `SceneInstrumentation` / `EngineInstrumentation`); heap snapshot for leaks.
5. **Device emulation** for a phone viewport. (Emulation doesn't emulate a phone GPU; real-device runs are a separate, manual check.)
6. **Console and network:** no errors; total download and first-load size within budget.
7. **Reference comparison:** Sinnott webcam frame vs engine render at the same timestamp and sun position; a perceptual metric for regression plus Claude's written critique for realism (colour, haze, contrast, silhouette, vegetation density).

**Output:** `verification/` folder with screenshots, metrics, critique and a pass/fail report.

**Gate:** budgets met (§5.3); no console errors; reference diff within threshold or critique items resolved/waived.

### Stage 14 — Review loop and release (D, H)

- Claude turns Stage 13 critique into a **punch list** mapped to stages ("rim trees too uniform → Stage 7 whitebark preset variance").
- Iterate until the gates pass and a human (for community packs, a reviewer) signs off.
- Status progression: `draft` → `published` → `verified` (verified requires human review of citations and reference views, per additional-questions Q14b).

---

## 5. The pack format

### 5.1 Layout

```
wizard-island/
  manifest.json          # the contract between pipeline and engine
  CREDITS.md             # generated from provenance
  dossier.md             # human-readable facts + citations
  facts.json             # species, statuses, habitat rules
  terrain/               # tiles, LODs, colliders, bathymetry depth maps
  classes/               # substrate / vegetation / mask rasters (KTX2 or PNG)
  materials/             # PBR sets per substrate class
  vegetation/             # placement buffers (instances) + refs to shared species
  props/                  # GLBs + LODs
  fauna/                  # rigged GLBs + animations + behaviour params
  audio/                  # ambience, calls, footsteps
  climate.json
  lighting.json
  viewpoints.json         # reference cameras for verification + scenic spots
  verification/           # last harness run (not shipped to players)
```

### 5.2 Manifest sketch

```json
{
  "id": "crater-lake.wizard-island",
  "version": "2.0.0",
  "status": "draft",
  "depends": [{ "id": "shared.flora.pnw-subalpine", "version": "^1" }],
  "site": {
    "name": "Wizard Island, Crater Lake",
    "origin": { "lat": 42.94, "lon": -122.15, "elev_m": 2115 },
    "crs": "local-ENU", "up": "Y", "handedness": "left",
    "playable_bounds": "terrain/playable.geojson",
    "moment": { "season": "midsummer", "era": "present" }
  },
  "tags": { "iucn_get": "…", "resolve_ecoregion": "…", "koppen": "…" },
  "cultural_context": [{ "label": "Klamath Tribes: giiwas", "url": "…" }],
  "substrates": {
    "scoria_black": {
      "material": "materials/scoria_black/",
      "footsteps": "audio/foot/scoria/",
      "physics": { "friction": 0.55, "slip_above_deg": 32 },
      "micro_scatter": ["props/lapilli_a.glb"]
    }
  },
  "species": [{
    "taxon_gbif": 5285393,
    "name": "Pinus albicaulis",
    "status": "observed",
    "asset": "shared.flora.pnw-subalpine/whitebark_pine",
    "placement": "vegetation/whitebark.instances.bin",
    "citations": ["…"]
  }],
  "budgets": { "tex_mb": 256, "tris_visible": 1500000, "draw_calls": 300, "download_mb": 150 },
  "files": [{
    "path": "props/block_lava_03.glb",
    "source": "TRELLIS.2 from photo inat:123456",
    "tool": "trellis2@<ver>", "license": "CC0", "author": "…",
    "inputs": ["inat:123456 (CC BY)"], "attribution_required": true
  }]
}
```

*Taxon IDs and the elevation above are illustrative; the pipeline fills real values.*

### 5.3 Budgets (starting points to test on devices)

| Budget | Phone target |
|---|---|
| Resident GPU texture memory | ≤ 256 MB |
| Visible triangles (after LOD) | ≤ 1–1.5 M |
| Draw calls | ≤ ~300 (instancing required for vegetation) |
| First-load download | ≤ 150 MB, rest streamed |
| Hero prop | ≤ 20k tris LOD0, 2K textures |

---

## 6. Shared asset library

Whitebark pine grows from the Sierra to the Rockies. It should be built once.

- Flora and fauna assets are keyed by **GBIF taxon ID**; substrate materials by **substrate class** (with optional regional variants).
- A pack = *terrain + class maps + species list with density/habitat rules + references to shared assets + local props*.
- Shared assets version independently; packs declare dependencies (`depends` in the manifest).
- **Consequence for the proving run:** the Wizard Island build also produces the first entries in `shared.flora.pnw-subalpine` and `shared.fauna.pnw`. The second site reuses them, which is a large part of what makes autopilot cheaper over time.

---

## 7. Engine contract (what Sojourney must expose)

I haven't seen the engine code in this project, so this section is a **requirements list** for the engine side, to be reconciled with what already exists.

**Pack loading**

- `loadPack(manifestUrl)` resolving dependencies, streaming tiles, returning when the first view is ready.
- Reads the substrate tag table for materials, footsteps, physics and fauna spawns (no hard-coded Wizard Island logic).

**Test hooks** (enabled in dev builds; e.g. `window.__sojourney`)

- `setCamera({position | latLonElev, target, fov})`, `setTime(isoDateTime)`, `setWeather(preset)`, `setSeason(...)`
- `waitForIdle()` — all tiles streamed, shaders compiled, frame time stable
- `getStats()` — draw calls, active triangles, texture memory, frame time (from Babylon instrumentation)
- `listViewpoints()` / `gotoViewpoint(id)` from `viewpoints.json`
- `startWalk(pathId)` — deterministic scripted walk for perf traces
- Deterministic seed for scatter and fauna so screenshots are comparable run to run

**Rendering baseline** (Stage 5): atmosphere add-on, PBR Neutral tonemapping, exposure model, foliage translucency, impostor support, water material with depth absorption.

---

## 8. Wizard Island: current vs new

| Area | Current pack | New pack |
|---|---|---|
| Terrain | USGS topo → heightmap | DS 716 1 m DEM incl. bathymetry; west lava lobe with pressure ridges; summit crater to Howell Williams dimensions; caldera horizon ring |
| Ground | (not class-driven) | 8 substrate classes from SIM 2832 + dossier; block lava not a'a; oxidized scoria only near rim; 30 cm micro-scatter |
| Trees | Random scatter | Western hemlock (lower), whitebark pine (rim) from species presets; TreeMap density and snags; wind + impostors |
| Flora | — | ~15 cited species, capped by the ~60-species island total; less diverse than the caldera wall |
| Water | (unknown) | Depth-absorbing clear water; visible underwater shoreline |
| Fauna | — | 8 cited small animals + aquatic + birds, habitat-spawned |
| Audio | (unknown) | Real species calls, generated ambience, substrate footsteps |
| Light | Night strong, day weak | Physically based atmosphere, calibrated look-dev |
| Proof | Eyeballed | Webcam-match and viewpoint sweep with metrics |

---

## 9. Toolchain summary

| Need | Default (free/open) | Alternatives | Notes |
|---|---|---|---|
| Agent orchestration | Claude + `packsmith` skill | — | Skill encodes this doc as runnable steps |
| GIS | GDAL, rasterio, PDAL, Python | — | Cloud sandbox |
| Blender control | Blender Lab MCP (5.1+) | MCP for Blender (community) | Scripted bpy; run in VM |
| Hero meshes | TRELLIS.2 (HF Spaces / local) | SF3D, TripoSR, Rodin (hero), Tripo | Avoid Hunyuan3D as default |
| Trees | EZ-Tree presets | Blender geometry nodes | Shared by taxon |
| Materials | Poly Haven, ambientCG | ArmorLab, Dream Textures | Albedo lint |
| Rigging | UniRig | Tripo Rig API, Spline IK | Snake = Spline IK |
| Audio | Stable Audio Open, xeno-canto | ElevenLabs/Firefly, Macaulay | NC calls need an obtained licence |
| Packaging | gltfpack, glTF-Transform, Khronos validator | — | KTX2 + meshopt |
| Engine testing | Chrome DevTools MCP (headed, real GPU) | Claude in Chrome | Same as engine tests |

Two volunteer tiers (Q14a): **no-GPU** (browser tools, HF Spaces, CC0 libraries, EZ-Tree, cloud GIS) and **local GPU** (same steps, local models). Both produce the same manifest.

---

## 10. Validation gates (consolidated)

| # | Gate | Stage | Blocking? |
|---|---|---|---|
| G1 | Site resolved, tags, origin | 0 | Yes |
| G2 | Every spawned species cited or `plausible`; adversarial pass clean | 1 | Yes |
| G3 | Layers present, CRS aligned | 2 | Yes |
| G4 | Terrain vs DEM tolerance; colliders watertight | 3 | Yes |
| G5 | Every walkable cell classified; every class complete | 4 | Yes |
| G6 | Look-dev references match | 5 | Yes (per engine version) |
| G7 | Albedo lint, tiling, texel density | 6 | Warn/Yes |
| G8 | Vegetation density, ground contact, species match | 7 | Yes |
| G9 | glTF valid, budgets per asset | 8–9 | Yes |
| G10 | Rig valid, loops clean | 9 | Yes |
| G11 | Licenses allow commercial use (public or obtained), attribution, no SA, no modified ND | 10–12 | Yes |
| G12 | Pack budgets, console clean, reference views | 13 | Yes |
| G13 | Human review for `verified` | 14 | For `verified` only |

---

## 11. How far autopilot can go (honest assessment)

**Works anywhere in the continental US from national data:** terrain (3DEP), colour reference (NAIP), vegetation class (LANDFIRE), stand structure and snags (TreeMap), species candidates (GBIF/iNat/eBird), climate (Köppen + normals), infrastructure (OSM).

**Better where extra data exists:** NPS units with vegetation maps, detailed geologic maps, lidar, bathymetry, webcams. Wizard Island is close to best-case.

**Where autopilot will be weak:**

- **Hero geology that defines a place's identity** (Grand Canyon strata, Flaming Gorge's red cliffs). Generic material sourcing will miss it; the dossier needs to capture the look and a director pass needs to judge it.
- **Water bodies without bathymetry** (many reservoirs), where shorelines and depth colour must be approximated.
- **Scale:** Grand Canyon is tens of thousands of times Wizard Island's area. The tiling and dependency design allows it, but the budget model needs streaming and much coarser distant representation, and the "playable area" must be chosen (a trail corridor, a rim segment), not the whole canyon.
- **Fauna motion** beyond presets.
- **Outside the US:** swap to global datasets (Copernicus DEM, ESA WorldCover, GBIF), with coarser results.

**The expected steady state:** autopilot delivers a correct, playable, cited Draft in hours; director mode spends its time on the 10–20% that makes a place feel like *itself*.

---

## 12. Milestones (Wizard Island proving run)

| # | Milestone | Proves |
|---|---|---|
| M0 | Engine test hooks (§7) + DevTools MCP harness capturing viewpoints and stats from the **current** pack | Baseline measurements before any change |
| M1 | Look-dev scene, atmosphere, tonemapping, albedo references | Daylight is fixed before assets are judged |
| M2 | Manifest schema, `pack.plan.json`, validator skeleton (G1–G13 stubs) | The contract exists |
| M3 | Stage 1 dossier generated from scratch and scored against `wizard-island-fact-check.md` | Research automation works (target: catches all 3 hallucinations, recovers most cited species) |
| M4 | Terrain, bathymetry, water, horizon (Stages 2–3) | Data path end to end |
| M5 | Substrate classes and materials (Stages 4, 6) | Ground realism at 30 cm and at distance |
| M6 | Trees and flora (Stage 7), first shared-library entries | Vegetation from data, not random scatter |
| M7 | Props, fauna, audio (Stages 8–10) | Full inventory |
| M8 | Package, verify, replace the old pack; before/after report | The pipeline beats the original |
| M9 | **Autopilot dry run on a second site** (Flaming Gorge suggested) with no manual steps; log every place a human had to step in | How close "just ask for a place" really is |

M9 is the answer to "is this actually possible?": a measured list of interventions, not a prediction.

---

## 13. Open decisions (carried forward, with proposed defaults)

| Decision | Proposed default |
|---|---|
| Target devices | Phone-first WebGPU, with a reduced WebGL2 tier (no volumetrics) |
| Moment in time | Present-day midsummer first; snow as a layer for a later winter variant |
| Pack license | Official packs: Sojourney is commercial, so every source must allow commercial use or be licensed for it. Community packs (packsmith, non-commercial use): to be decided |
| Splats vs meshes for hero rocks | Meshes by default; splats as an experiment gated on the time-of-day sweep |
| Who owns the caldera/lake | A shared `crater-lake.base` pack; Wizard Island depends on it |
| Verification trust model | `verified` requires one reviewer checking citations + reference views |
| Hosting | Git-based repo of packs with releases, until volume justifies a registry |
| Where the engine plane runs | A local machine with a real GPU, linked to the session |

---

## 14. Risks

- **Lighting fix is engine work that blocks everything else.** Mitigation: M1 comes first.
- **TRELLIS.2 quality on volcanic rock is untested.** Mitigation: early bake-off vs CC0 scans and Rodin on 3 block-lava references.
- **EZ-Tree may not reach species-level realism for conifers.** Mitigation: preset tuning loop; fall back to Blender geometry-node trees.
- **Blender MCP runs unguarded Python.** Mitigation: VM/separate account; pipeline scripts reviewed and versioned.
- **Automated "looks real" judgment is subjective.** Mitigation: keep perceptual metrics for regression only; realism sign-off stays human for `verified`.
- **Data license drift** (terms change). Mitigation: record license at fetch time in provenance.

---

## Sources (new in this doc)

- [Blender Lab MCP (official)](https://projects.blender.org/lab/blender_mcp)
- [StraySpark: Official Blender MCP vs community MCP for Blender (2026)](https://www.strayspark.studio/blog/official-blender-mcp-server-comparison-2026)
- [Chrome DevTools MCP (GitHub)](https://github.com/ChromeDevTools/chrome-devtools-mcp/)

All other facts and sources are cited in the eight research docs listed at the top.
