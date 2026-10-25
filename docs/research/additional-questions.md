# Additional Questions: What the Asset-Pack Research Didn't Ask (Sept 2026)

Last doc before the design-doc synthesis. It reviews the eight existing docs and asks: *what would an asset-pack pipeline need that nobody has researched yet?* Each section gives the missing question, why it matters, what I found, and a recommendation. Wizard Island is used as the worked example throughout, but every answer is meant to carry over to other biomes.

## Bottom line up front

The existing research answers **"where do the assets come from?"** well: AI mesh generation, rigging, textures, audio, data layers, species facts. It doesn't cover six things a pipeline needs:

1. **The lighting the assets will be judged under.** Night looks great partly because darkness hides albedo, exposure and sky errors. If we replace the assets before fixing daylight, we'll be judging new assets under broken light. Babylon.js 9 (March 2026) now ships a physically based atmosphere add-on, which is the obvious place to start.
2. **A ground truth to compare against.** An NPS webcam at Sinnott Overlook points straight at Wizard Island and refreshes every 60 s. That gives us a free, repeatable "does it look real?" test.
3. **What the pack must fit into.** "Pocket" means phones. There's no per-pack budget yet (triangles, draw calls, texture MB, download MB), no pack format and no manifest.
4. **Things missing from the scene inventory.** The biggest one is **the lake itself**, which fills most of the frame from anywhere on the island. Also missing: the caldera-wall horizon, snow, dead snags, birds, aquatic life and the dock.
5. **Which moment in time we're depicting.** Season, era and weather all multiply the asset count. A newsworthy fact here: the Cleetwood Cove trail is **closed summers 2026–2028 with no boat tours**, so for three years nobody can visit Wizard Island in real life. That's a strong product story, and it also rules out on-island field capture.
6. **What licences packs can use, and whether community-made packs can be trusted.** Sojourney is a **commercial product** (decided 2026-09-28): official packs need sources that allow commercial use, or licences obtained for it. Packsmith will also be offered for **non-commercial use**, so people can build packs of places they love and share them with the community. That raises new questions: can volunteers run the pipeline on free tools, and how do we check a stranger's pack is accurate (Q14).

---

## Q1. Is "daytime looks like crap" an asset problem or a lighting problem?

**Why it matters.** At night the scene is mostly sky, stars and silhouettes. Albedo, exposure, sky colour, aerial perspective and shadow quality barely register. In daylight every one of them is visible at once. New assets won't fix a lighting rig that's wrong, and they can't even be evaluated under one.

(I couldn't look at the engine code from this session, so treat the diagnosis below as a checklist of likely causes, not a confirmed finding.)

**Common daytime failure modes in PBR web scenes:**

- A sky that isn't physically tied to the sun. The skybox colour, the sun's light colour and intensity, and the environment/IBL lighting disagree with each other.
- No aerial perspective. Distant caldera walls keep full contrast and saturation, which flattens depth.
- The wrong tonemapper, or no exposure control. Midday sun overwhelms everything.
- Albedo values outside physical ranges, especially very dark materials. This matters a lot for Wizard Island: black scoria and block lava sit close to the darkest natural albedo, around 4% (charcoal and fresh asphalt). Authoring them as pure black looks fake.
- Foliage with no translucency, so backlit conifers read as black cutouts.
- Shadow cascades that are too coarse at the scale of an island.

**What Babylon.js 9 gives us (released March 2026):**

- **Physically Based Atmosphere add-on**: Rayleigh and Mie scattering, ozone absorption and multiple scattering. It includes an `AtmospherePBRMaterialPlugin` that attaches to PBR materials automatically, so terrain and props pick up atmospheric lighting and aerial perspective. Two caveats from the forum: there's a reported bug where the plugin breaks shader compiles when the environment texture is a cube, and it has no built-in sun disc (people are asking for one).
- **Volumetric lighting** (real-time light scattering using WebGPU compute), **clustered lighting**, **dynamic IBL shadows** and **OpenPBR (alpha)**.
- The **Khronos PBR Neutral** tonemapper, a standard designed for true-to-life colour.

**Recommendation.** Make a **look-dev scene** the first pipeline stage, before any asset replacement:

- Include a grey ball, a chrome ball, a colour-checker card and a few calibrated reference materials.
- Turn on the atmosphere add-on and lock the tonemapper and exposure model.
- Only accept new assets once they read correctly in this scene.

Also add an **albedo lint** to the pipeline. Industry guidance is base colour in sRGB 30–240, with 50 as a safer minimum. Measurement-based work shows real dark dielectrics can sit lower once you account for their ~4% specular reflectance, so warn rather than fail on dark scoria and lava.

## Q2. What do we compare against to know it looks real?

**Why it matters.** "Immersion and realism" needs a test, or "looks right" turns into opinion.

**Findings.**

- The **NPS Crater Lake webcam** sits at Sinnott Overlook, Rim Village (7,100 ft). It looks north across the lake and on clear days shows **Wizard Island, Llao Rock and Mount Thielsen**. It refreshes every 60 s. The page doesn't mention an archive, so we'd have to collect our own snapshots over time.
- **iNaturalist Licensed Observation Images on AWS**: geotagged, dated species photos in a public S3 bucket (no AWS account needed). Images post in real time and metadata updates monthly. The images are a mix of CC0, CC BY and CC BY-NC, so filter by license (see Q9).

**Recommendation.** Build a **"webcam match" test**:

1. Put an in-engine camera at the Sinnott Overlook position and field of view.
2. Set the sun and season to the timestamp of a captured webcam frame.
3. Render and compare side by side. Automate with Playwright, which is already available in this environment.

This gives every pack a repeatable realism benchmark. Other locations can use NPS webcams or geotagged CC0 photos the same way.

## Q3. What hardware and budget does a pack have to fit?

**Why it matters.** A "pocket vacation simulator" means phones. Without budgets, AI-generated assets (often 100k–1M+ triangles, per the 3D doc) will blow through memory long before quality becomes the limit.

**Findings.**

- **WebGPU shipped in Safari 26** on iOS, iPadOS, macOS and visionOS, with Babylon.js named as a supported framework. That brings compute shaders to iPhones, which Babylon 9's volumetric lighting relies on.
- Developers consistently report iOS Safari tab crashes when WebGL memory goes past roughly **300–500 MB**. This comes from developer reports, not Apple documentation, so treat it as a working ceiling and not a spec.

**Recommendation.** Set a per-pack budget now and enforce it in CI. The numbers below are **starting guesses to test on real devices**, not researched limits:

| Budget | Phone starting point |
|---|---|
| Resident GPU texture memory | ≤ 256 MB |
| Visible triangles | ≤ 1–1.5 M (after LOD) |
| Draw calls | ≤ ~300 (instancing is required for vegetation) |
| Pack download | ≤ 150 MB first load, the rest streamed |
| Hero prop | ≤ 20k tris LOD0, 2K textures |

Also decide on a **WebGL2 fallback tier** or **WebGPU-only**. Volumetrics and some atmosphere quality settings may be WebGPU-only.

## Q4. What physically *is* an asset pack?

**Why it matters.** The goal is packs for many areas, which means a repeatable format, not a folder of GLBs.

**Findings.**

- glTF extensions that Babylon's loader supports and that the build pipeline should target:
  - `KHR_texture_basisu` (KTX2 / Basis Universal textures)
  - `EXT_meshopt_compression` and `KHR_mesh_quantization`
  - `EXT_mesh_gpu_instancing` for scattered props. An older Babylon issue reported suboptimal performance here, so benchmark it against thin instances before committing.
- **gltfpack** (meshoptimizer) and **glTF-Transform** automate simplification, quantisation, meshopt and KTX2 in one command-line step. Run the Khronos glTF Validator after them.
- **Babylon.js 9 added 3D Tiles** (the open OGC standard for streaming huge geospatial datasets with built-in LOD) and **floating-origin large-world rendering**. Neither is needed for a 1 sq mi island, but they're the natural backbone once packs sit next to each other or cover big terrain.

**Recommendation.** Define a **pack manifest** (JSON) before building the first pack. Each asset entry should carry:

- Pack ID, version and geographic bounds
- Biome tags: GET EFG, RESOLVE ecoregion, Köppen class (per the existing tagging stack)
- Asset list keyed by **taxon ID** (see Q8) or **substrate class**
- LOD chain and impostor
- Budget footprint
- Provenance and license (see Q9)
- Surface/footstep tag (see Q11)

Treat the manifest as the contract between the pipeline and the engine.

## Q5. Is the scene inventory complete?

**Why it matters.** The fact-check doc covers what sits *on* the island. From the island, most of what you see is *off* it.

### 5a. The lake (biggest gap)

- Crater Lake is **1,943 ft deep**, the deepest lake in the US. Its record Secchi clarity is **42 m (139 ft, June 1997)**, and UV reaches ~100 m. The blue comes from sunlight scattering in unusually pure water, with almost no phytoplankton at the surface. Surface water warms to 55–60°F in summer, and the lake hasn't frozen over since 1949.
- Because the water is so clear, **the underwater shoreline is visible from shore**. Submerged rocks, block-lava margins and drop-offs all need assets or at least textured bathymetry.
- Data exists: the **USGS 2000 multibeam survey** (2 m, 16M+ soundings, XYZ and GRID formats) and **USGS DS 716**, which merges the 2010 lidar with that bathymetry into a **1 m seamless DEM** covering 798 km².
- **Recommendation**: a water material with depth-based absorption driven by the DS 716 bathymetry. That's a pipeline asset in its own right, and nobody has researched it yet.

### 5b. The horizon

- The caldera walls, Llao Rock, Hillman Peak and the rim make up the skyline from everywhere on the island. The existing terrain map may or may not include them.
- DS 716 covers the whole caldera. Build it as a low-detail distant-terrain ring with NAIP-derived colour, or stream it through Babylon's 3D Tiles.

### 5c. Dead wood

- Whitebark pine, the island's rim tree, is in decline from white pine blister rust and mountain pine beetle, and was listed as threatened under the ESA in late 2022. Grey snags and downed logs are part of what the island really looks like.
- **USFS TreeMap v2022** gives **dead trees per acre** per 30 m cell, so snag density can come from data.

### 5d. Birds (not in the fact-check at all)

- Crater Lake Institute's park checklist (summer abundance):
  - Abundant: Clark's nutcracker, mountain chickadee, dark-eyed junco
  - Common: Steller's jay, gray (Canada) jay
  - Uncommon: osprey, bald eagle
  - Locally common: rosy finch
- **None of these is confirmed specifically on Wizard Island.** The checklist is park-wide. Treat them as plausible and verify before shipping.
- Clark's nutcracker is the whitebark pine's main seed disperser (the cones don't open on their own). That's a real ecological story you could see playing out on the rim.

### 5e. Aquatic life

- Signal crayfish, introduced in 1915, spread from 47% of the rocky shoreline in 2008 to about 80% by 2013, **including Wizard Island**.
- The endemic **Mazama newt** (a darker, less toxic population of rough-skinned newt) was "frequently observed at Wizard Island" through the mid-20th century. It's now almost absent wherever crayfish have moved in.
- Rainbow trout and kokanee salmon were stocked starting in 1888.
- A historically accurate shoreline and a present-day accurate shoreline look different. See Q6.

### 5f. Human infrastructure

- Boats dock at **Governors Bay** on the south side. Two trails: one switchbacks up and circles the crater, the other runs from the dock toward the western end. No camping.

## Q6. Which moment in time are we depicting?

**Why it matters.** Every season, era and weather variant multiplies materials and props. Picking this early is the cheapest decision on the list.

**Findings.**

- **Snow**: the park averages **41 ft a year** (2021), down from 51 ft in the 1930s. The record was 879 in. in 1932–33. Snow usually melts by late June. For most of the year the island is under snow.
- **Access**: the Cleetwood Cove trail and marina are closed **summers 2026, 2027 and 2028** for reconstruction, with **no public boat tours**. In practice Wizard Island can't be visited until 2029, which makes it a natural launch story for Sojourney. It also means field capture can only happen from the rim (see Q10).
- **Era**: the fact-check leans on 1930s *Nature Notes*. Since then, newts have given way to crayfish and whitebark health has declined. A "1930s island" and a "2026 island" differ in their fauna and their snags.

**Recommendation.** Ship **one season (midsummer, present day)** first, with full time-of-day. Design the material system so snow cover is a **layer on top of** the substrate material, not a second copy of every asset. Winter can then be a later pack variant. It's also the one season visitors never get to see in person.

## Q7. How do vegetation assets get the right *shape and density*, not just the right species?

**Why it matters.** The 3D doc correctly says AI is weak at trees and recommends procedural scatter. But no procedural tree tool was actually researched, and nothing covers how many trees, how big, or how many are dead.

**Findings.**

- **EZ-Tree** (MIT): a procedural tree generator in JavaScript. It's on npm as `@dgreenheck/ez-tree`, has dozens of parameters with seeded randomness, uses billboard leaves and exports GLB. It's built on Three.js, but it can run as a build-time step and write GLBs for Babylon. Tuning parameter presets per species (whitebark pine, western hemlock) fits "species-accurate" well.
- **USFS TreeMap v2022**: 30 m raster of the continental US, with 22 bands. These include live and dead trees per acre, quadratic mean diameter, dominant height, canopy cover, basal area and forest type. Each pixel links to an **FIA plot ID** with a full tree list. It's public and free with a citation (Houtman et al. 2025, doi:10.2737/RDS-2025-0032). This gives realistic stand structure for **any forested US location**.
- **Lidar**: the 2010 DOGAMI Crater Lake lidar is on OpenTopography and NOAA as LAZ. Its density (~1.6 returns/m²) may be marginal for segmenting individual trees. Test it on the island before relying on the "lidar tree positions" plan in `surface-data-layers.md`.
- **Impostors**: Babylon has no built-in octahedral impostor system. Open-source WebGPU and Three.js implementations exist to port. This needs to be decided at asset time, because the impostor atlas is baked from the hero mesh.
- **Wind**: foliage wind needs per-vertex weights (usually vertex colours) **baked when the asset is built**. It can't be added afterwards without re-exporting. This belongs in the pipeline spec.

## Q8. How do packs share assets across places?

**Why it matters.** Whitebark pine grows across subalpine zones from the Sierra to the Rockies. It should be one asset, reused in every pack, not rebuilt for each.

**Recommendation.**

- Key flora and fauna assets by **GBIF taxon ID** and substrate assets by **geologic/substrate class**.
- A pack then becomes: *terrain + substrate map + species list with density rules + a list of shared assets it references*.
- Get species lists from GBIF occurrence data filtered to CC0 and CC BY.

**eBird**: its API bans commercial use (including any use by a for-profit entity), so official packs need a separate agreement or another source for bird lists and seasonal timing (see Q9).

## Q9. What licences can packs use?

**Decided (2026-09-28): Sojourney is a commercial product.** Official packs ship inside it, so every source they use must allow commercial use, either under its public licence (CC0, public domain, CC BY) or under a licence obtained from the rights holder. **Packsmith**, the pipeline tool, will also be offered for non-commercial use, so people can build packs of places they love and share them with the community.

*Not legal advice.*

- **CC0, public domain and CC BY** sources are usable as-is, with attribution for CC BY: USGS and NPS data, Poly Haven, ambientCG, CC0/CC BY iNaturalist photos, the NPS Sound Gallery, and the dataset citations (TreeMap, USGS).
- **NonCommercial (NC) sources** can't ship in an official pack under their public licence. That includes many xeno-canto recordings and iNaturalist photos, and Macaulay Library media. Obtain a commercial licence from the recordist, photographer or archive, or use another source. This matters most for audio: the 2D/audio doc found that AI can't produce species-accurate bird calls, so real recordings need licences.
- **eBird**: the API terms ban commercial use, including any use by a for-profit entity. Official packs need a separate agreement or another source for bird lists and seasonal timing.
- **ShareAlike (SA)**: no SA sources in official packs. Under CC, even placing an SA file inside a pack as part of a collection keeps its SA terms, and mixing it into another file makes an adaptation that must be released under SA.
- **AI output**: the US Copyright Office's Part 2 report (29 Jan 2025) says purely AI-generated material isn't copyrightable. Sojourney can use it but can't claim copyright in it, and the **inputs** keep their licences.
- **Generation inputs**: a 3D model generated from someone's photo arguably inherits that photo's terms. Use only photos licensed for commercial use as generation inputs, and let the credit follow the model.
- **Tool licences**: Hunyuan3D's Community License **prohibits use in the EU, UK and South Korea** whatever the purpose, and needs a separate licence above 1M monthly active users. TRELLIS.2 (MIT) and TripoSR/InstantMesh (MIT/Apache) have no such limits.
- **Tripo's free tier** has conflicting documentation (the pricing page says CC BY 4.0, the terms reserve broader rights). Use a paid plan with clear commercial rights, or open models.

**Recommendation.**

- Keep **per-file provenance** in the manifest (source, licence, author, tool and version, input references, and any licence agreement obtained) and **generate the credits file automatically** from it.
- The validator (Q13) should reject an official pack if any file has no licence, allows only non-commercial use without an obtained licence, is ShareAlike, or is a modified NoDerivatives (ND) source.
- **Community packs** built with packsmith are non-commercial. Which licences they may use and carry, and whether they're distributed through Sojourney, are open decisions (see the list at the end).

## Q10. Can we capture our own reference and scans?

**Findings.**

- **NPS rules**: groups of **8 or fewer**, using only hand-carried equipment in public areas, with no exclusive site access and no resource impact, need **no permit**. Commercial and non-commercial work are treated the same.
- **Drones** are banned in national parks (NPS policy since 2014; not re-verified for this doc).
- **Gaussian splats**: Babylon.js 9 supports SPZ (Niantic's open, compressed splat format), splat shadow casting and compositing splats with meshes. Scaniverse is a free phone app that captures splats. Splats are a candidate for **photoreal hero rocks and rim vignettes**, with two conditions: check how they look under the day/night lighting from Q1 (splats bake in their lighting), and remember the island itself is unreachable 2026–2028.
- **Colour-calibrated photos** (colour checker plus exposure-only correction) are what turn phone photos into usable albedo references for the Q1 lint.

## Q11. What does the surface do besides look like something?

The substrate map in `surface-data-layers.md` should drive more than textures. Use the same class tag for:

- Footstep sound: scoria crunch, block-lava clack, needle duff, crater-floor soil
- Walk speed and slip on the 35° cinder slope
- Where fauna spawn (pika in talus, garter snakes on dark lava)

Babylon's `AudioEngineV2` handles spatial sound. Make this one tag per substrate class in the manifest, not separate systems.

## Q12. What do we see at 30 cm?

**Why it matters.** Sojourney's signature moments are close to the ground: lying on your back, sitting on the rim. The stargazing shot works because the foreground is silhouettes. The same view by day, at 30 cm, exposes texel density and ground clutter.

**Recommendation.** Set a **texel density standard** and a **micro-scatter layer** for each substrate. On Wizard Island that means whitebark cones, hemlock needles, scoria lapilli and pumice. Add detail-normal maps for the ground so it still looks right at arm's length.

## Q13. How is the pipeline automated and checked?

Build one scripted chain so every pack goes through the same gates:

1. Headless Blender import and cleanup
2. gltfpack / glTF-Transform
3. glTF Validator
4. Albedo lint (Q1)
5. Budget check (Q3)
6. Manifest, provenance and license check, plus credits generation (Q9)
7. Species-citation check (Q14)
8. Webcam/reference-view render diff (Q2)

A pack that fails any gate doesn't ship. This is what makes "we'll do many areas" affordable.

---

## Q14. Community-authored packs: what changes when volunteers build them?

**Why it matters.** The point of a cheap pipeline is that anyone can make a pack of a place they love. That brings four new questions: can volunteers run the tools, can their packs be trusted, can the platform take in packs from many people, and how are species placed when exact locations aren't available?

### 14a. Can a volunteer run the pipeline for free?

- **TRELLIS.2 officially needs 24 GB of VRAM**, which most volunteers don't have. Microsoft hosts an official **TRELLIS.2 demo on Hugging Face Spaces**. On ZeroGPU, free accounts get **5 GPU-minutes a day**, anonymous users 2, and PRO users 40, running on 48 GB Blackwell GPUs. That's enough for a handful of hero props a day at no cost.
- **Hunyuan3D-2GP** ("GPU Poor") runs shape generation in **6 GB of VRAM**, but shape plus texture needs ~24.5 GB. It's also bound by Tencent's territory restriction (Q9), so it can't be the default.
- **Stable Fast 3D** (~6 GB) and **TripoSR** (MIT) remain the low-end local options (3D doc).
- **EZ-Tree** runs in a browser, so trees need no GPU server at all.
- **Recommendation**: define two tiers. The **"no-GPU" path** uses a browser tool, Hugging Face Spaces, CC0 texture libraries and EZ-Tree presets. The **"local GPU" path** uses the same steps with local models. Both must output the same manifest. A pack creator should never need Blender skills just to get a valid pack; Blender is for polish.

### 14b. How do we know a stranger's pack is accurate?

A "biome-accurate" promise is only as good as the least careful pack. Turn the Wizard Island fact-check method into rules the validator enforces:

- **Every species needs a cited occurrence source**, such as a GBIF or iNaturalist record inside or near the pack's bounds, or a park species list. No citation, no spawn.
- **Biome-tag cross-check**: species that don't occur in the pack's RESOLVE ecoregion trigger a warning.
- **A reference-view match** (Q2) is required, using any webcam or CC0/own photo with known position and time.
- **Label every asset "observed" or "plausible"**, so a squirrel that belongs there but wasn't verified is marked as such and not passed off as fact.
- Consider a lightweight **community review** before a pack is marked "verified", separate from "published".

### 14c. Access is the point (decided 2026-09-28)

**Decision:** packs will **not** hide, blur or move species or places, and won't carry Leave No Trace or closure messaging. Seeing species and places people can't otherwise reach, because of laws, closures, disability, time or money, is at the heart of "experiences, not achievements." Wizard Island being closed 2026–2028 is a reason to build the pack, not a caveat on it.

**One practical point for pack creators (a fact about the data, not a policy):** iNaturalist and GBIF already publish blurred coordinates for many threatened species. They show a random point inside a 0.2° × 0.2° cell (~500 km² at the equator), or no point at all. Creators usually won't have exact locations for those species. The pipeline should place them using **habitat rules** (substrate, elevation, vegetation class, shoreline), and the scatter system should support that. For Wizard Island, the Mazama newt and the crayfish get placed along suitable rocky shoreline, not at specific observation points.

### 14d. Cultural sites

- Crater Lake is ***giiwas*, "a sacred place,"** to the Klamath Tribes (Klamath, Modoc and Yahooskin), whose ancestors saw Mount Mazama collapse ~7,700 years ago. The Cow Creek Umpqua also hold it in high regard.
- Community packs will often cover places with Indigenous significance. The pack format needs a **cultural-context field**, and the norms should say to point to tribes' own published materials and not have AI invent lore. The `wizard-island-fact-check.md` rule of citing real sources and cutting invented names applies even more strongly here.

### 14e. Platform plumbing

The questions to settle before the first outside pack arrives:

- Where are packs hosted? (GitHub releases, Hugging Face datasets, or a Sojourney registry.)
- How are versions and dependencies handled? (For example, a pack that references a shared "whitebark pine" asset, per Q8.)
- How do players install a pack?
- Who can mark a pack "verified"?

The manifest (Q4) and validator (Q13) are the foundation. Settle hosting next.

---

## Decisions for the project lead

1. **Target devices**: phone-first with a WebGL2 fallback, or WebGPU-only? (Q3)
2. **Moment in time**: present-day midsummer first? Is a historical era ever in scope? (Q6)
3. ~~**Commercial intent**~~: **decided 2026-09-28: Sojourney is commercial; packsmith is offered for non-commercial use to build community packs.** Remaining sub-decisions: which licences community packs may use and carry, and whether they are distributed through Sojourney. (Q9, Q14e)
4. **Photoreal splats vs. unified PBR meshes** for hero rocks: splats look better up close but are harder to relight. (Q10)
5. **Scope of "the view"**: does the Wizard Island pack own the caldera walls and lake, or are they a shared "Crater Lake" pack that other future experiences (the rim, the Cleetwood trail) reuse? (Q5, Q8)
6. **Community trust model**: what does "verified" require, and who grants it? (Q14b)
7. **Pack hosting and distribution**: where community packs live and how players install them. (Q14e)

## Suggested order for Wizard Island

1. Look-dev scene, atmosphere add-on, tonemapping, albedo lint (fix the light first)
2. Webcam-match test harness
3. Budgets and pack manifest schema, including provenance
4. Lake water plus DS 716 bathymetry, and the distant caldera ring
5. Substrate materials (black scoria, red/brown upper scoria, block lava, crater-floor soil) with snow-ready layering
6. Trees: EZ-Tree species presets, TreeMap-driven density including snags, impostors, baked wind weights
7. Ground micro-scatter and flora from the fact-check list
8. Fauna and birds (after verifying each for the island specifically), then audio

---

## Sources

**Rendering / engine**
- [Announcing Babylon.js 9.0 (Microsoft)](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/)
- [Babylon.js 9.0 Part 2: tooling and geospatial (atmosphere, 3D Tiles, large worlds)](https://blogs.windows.com/windowsdeveloper/2026/03/30/part-2-babylon-js-9-0-tooling-updates-and-new-geospatial-features/)
- [Babylon.js 9.0 feature overview (ArtTechPost)](https://www.arttechpost.com/blog/babylon-js-9-0-what-is-new-in-the-web-3d-engine)
- [Babylon.js Atmosphere add-on docs](https://doc.babylonjs.com/addons/atmosphere/)
- [Forum: AtmospherePBRMaterialPlugin cube-env bug](https://forum.babylonjs.com/t/bug-atmospherepbrmaterialplugin-auto-attaches-to-pbrmaterials-created-after-new-atmosphere-and-breaks-their-shader-compile-when-env-is-a-cube/63276/2)
- [Forum: sun disc for Atmosphere](https://forum.babylonjs.com/t/sun-disc-and-glow-for-atmosphere-like-skymaterial/63000)
- [Khronos PBR Neutral tone mapper](https://www.khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products)
- [Babylon.js 9 Gaussian splatting: shadows, SPZ](https://radiancefields.com/babylon.js-v9.0-3dgs-gets-shadows-sogs-and-triangle-splatting-support-announced)
- [Babylon.js KTX2 docs](https://doc.babylonjs.com/features/featuresDeepDive/materials/using/ktx2Compression)
- [Babylon issue #8164: EXT_mesh_gpu_instancing performance](https://github.com/BabylonJS/Babylon.js/issues/8164)
- [gltfpack / meshoptimizer](https://meshoptimizer.org/gltf/)
- [Babylon AudioEngineV2](https://doc.babylonjs.com/typedoc/classes/BABYLON.AudioEngineV2)
- [Octahedral impostor WebGPU component](https://github.com/ektogamat/octahedral-impostor-component)
- [EZ-Tree (MIT)](https://github.com/dgreenheck/ez-tree)

**Platform**
- [WebKit: Safari 26.0 features (WebGPU)](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
- [iOS Safari WebGL memory ceiling (developer report)](https://bugnet.io/blog/how-to-fix-unity-webgl-build-crashing-on-safari-ios)

**Albedo / calibration**
- [Racoon Artworks: PBR, from rules to measurements](https://www.racoon-artworks.de/blog_PBRfromrulestomeasurements.php)
- [Sébastien Lagarde: DONTNOD PBR chart](https://seblagarde.wordpress.com/2014/04/14/dontnod-physically-based-rendering-chart-for-unreal-engine-4/)

**Crater Lake / Wizard Island**
- [NPS Crater Lake webcam (Sinnott Overlook)](https://www.nps.gov/media/webcam/view.htm?id=BAB9400D-C123-A696-F87EB5B6A61F30D6&r=%2Fcrla%2Flearn%2Fphotosmultimedia%2Fwebcams.htm)
- [NPS Crater Lake FAQs (snowfall, depth, freezing, temperature)](https://home.nps.gov/crla/faqs.htm)
- [Cleetwood Cove closure 2026–2028 (Central Oregon Daily)](https://www.centraloregondaily.com/news/regional/crater-lake-water-boat-trail-access-closure/article_6d59f4f6-54ce-4d48-beff-dc327f23ca60.html)
- [Crater Lake Institute: clarity](https://www.craterlakeinstitute.com/general-natural-history-articles/natural-history-wonders/crater-lake-clarity-it-doesnt-get-any-better-than-this/)
- [USGS DDS-72: Crater Lake multibeam bathymetry](https://pubs.usgs.gov/dds/dds-72/site/intro.htm)
- [USGS DS 716: 1 m merged lidar and bathymetry DEM](https://pubs.usgs.gov/publication/ds716)
- [2010 DOGAMI Crater Lake lidar (OpenTopography)](https://portal.opentopography.org/noaaDataset?noaaID=1428)
- [NPS Park Science: crayfish and the Mazama newt](https://www.nps.gov/articles/parkscience32_1_5-12_buktenica_et_al_3815.htm)
- [Crater Lake Institute: Clark's nutcracker](https://www.craterlakeinstitute.com/general-natural-history-articles/animals/birds/clarks-nutcracker/)
- [NPS: whitebark pine and Clark's nutcracker mutualism](https://www.nps.gov/articles/000/whitebark-pine-and-clarks-nutcracker-mutualism.htm)
- [Crater Lake Institute bird checklist](https://www.craterlakeinstitute.com/what-to-do/planning-your-visit/birding/bird-checklist/)
- [Wikipedia: Wizard Island (dock, trails, access)](https://en.wikipedia.org/wiki/Wizard_Island)

**Ecology data**
- [USFS TreeMap v2022 (Earth Engine catalog)](https://developers.google.com/earth-engine/datasets/catalog/USFS_GTAC_TreeMap_v2022)
- [iNaturalist Licensed Observation Images (AWS Open Data)](https://registry.opendata.aws/inaturalist-open-data/)
- [iNaturalist Research-grade Observations on GBIF](https://www.gbif.org/dataset/50c9509d-22c7-4a22-a47d-8c48425ef4a7)
- [eBird API Terms of Use](https://www.birds.cornell.edu/home/ebird-api-terms-of-use/)

**Licensing / legal**
- [USCO Copyright and AI, Part 2: Copyrightability (PDF)](https://www.copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-2-Copyrightability-Report.pdf)
- [Crowell & Moring summary of the Part 2 report](https://www.crowell.com/en/insights/client-alerts/us-copyright-office-releases-part-2-of-artificial-intelligence-report-clarifying-copyrightability-of-generative-ai-outputs)
- [Meshy: commercial use and free-tier CC BY 4.0](https://help.meshy.ai/en/articles/9992001-can-i-use-my-generated-assets-for-commercial-projects)
- [Tripo: commercial-use license comparison](https://www.tripo3d.ai/blog/ai-3d-commercial-use-license)
- [Wikipedia: xeno-canto](https://en.wikipedia.org/wiki/Xeno-canto)
- [NPS Sound Gallery (public domain)](https://www.nps.gov/subjects/sound/gallery.htm)
- [NPS: filming, still photography and audio recording rules](https://www.nps.gov/aboutus/news/film-and-photo-permits.htm)
- [Scaniverse SPZ open format](https://dev.scaniverse.com/news/spz-gaussian-splat-open-source-file-format)
- [CC Certificate: collections vs. remixes/adaptations](https://pressbooks.bccampus.ca/cccertificate/chapter/collections-and-remixes/)
- [CC wiki: 4.0 ShareAlike](https://wiki.creativecommons.org/wiki/4.0/ShareAlike)
- [Hunyuan3D-2.1 license (territory restriction)](https://huggingface.co/tencent/Hunyuan3D-2.1/blob/main/LICENSE)

**Community packs**
- [Hugging Face ZeroGPU quotas](https://huggingface.co/docs/hub/spaces-zerogpu)
- [TRELLIS.2 Space by Microsoft](https://huggingface.co/spaces/microsoft/TRELLIS.2)
- [Hunyuan3D-2GP (low-VRAM fork)](https://github.com/deepbeepmeep/Hunyuan3D-2GP)
- [iNaturalist: protecting sensitive species locations](https://help.inaturalist.org/en/support/solutions/articles/151000233080-how-does-inaturalist-protect-the-locations-of-sensitive-species-)
- [Crater Lake Trust: tribal history (giiwas)](https://craterlaketrust.org/tribal-history/)
