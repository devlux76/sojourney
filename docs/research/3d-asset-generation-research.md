# AI 3D Asset Generation Tools Research (Sept 2026)

## Bottom line up front
Image/text-to-3D AI is genuinely useful for Sojourney but for a narrower job than "generate the biome." These models are trained to reconstruct **single discrete objects** from a photo or prompt (photogrammetry-style), not full scenes. They're strong for hero props — boulders, weathered rock formations, driftwood, coral heads, mushrooms, ruins, cave stalactites — and weak at whole-vegetation/canopy assets and anything that needs to read as "a place" rather than "an object." Plan on AI for hero/prop generation, procedural scattering (Blender geometry nodes or Babylon.js thin instances) for vegetation density and variation, and Blender as the mandatory cleanup/retopo step regardless of source — no tool's raw output is game-ready as-is.

All the tools below export **GLB (glTF binary)**, which is the best-case format for this pipeline: Blender's glTF importer/exporter is mature, and Babylon.js is glTF-native with the same metallic-roughness PBR workflow, so materials generally survive the round-trip without conversion.

## Local / open-source (self-hosted, free, run on your own GPU)

**TRELLIS.2 (Microsoft)** — [github.com/microsoft/TRELLIS.2](https://github.com/microsoft/TRELLIS.2)
MIT license (a couple of dependencies like nvdiffrast carry their own terms, but they don't restrict output use). Currently the best-regarded open model for high-fidelity image-to-3D — 4B params, produces full PBR materials (base color/roughness/metallic/opacity) via a new "O-Voxel" structure. Needs a beefy GPU: 24GB VRAM minimum (built/tested on A100/H100), Linux, CUDA 12.4. Generation is fast on that hardware (3-60s depending on resolution). Exports GLB. Best pick if you have or can rent the GPU — no revenue caps, no geographic exclusions, no MAU limits.

**Hunyuan3D-2.1 (Tencent)** — [huggingface.co/tencent/Hunyuan3D-2.1](https://huggingface.co/tencent/Hunyuan3D-2.1)
Open-weights, strong output quality with production-ready PBR materials, rivals commercial tools. Caveat: it's under Tencent's **Community License**, not a permissive OSS license — free for commercial use, but explicitly **prohibits use in the EU, UK, and South Korea**, requires attribution ("Powered by Tencent Hunyuan"), and requires a separate license from Tencent once you exceed 1M monthly active users. Fine for a solo/small project outside those territories, but worth knowing before you lean on it if you're EU/UK-based or plan wide distribution there.

**Stable Fast 3D / SF3D (Stability AI)** — [github.com/Stability-AI/stable-fast-3d](https://github.com/Stability-AI/stable-fast-3d)
Lightweight and fast (sub-second to a few seconds per asset), built on TripoSR with added UV unwrapping and material prediction. Only needs ~6GB VRAM, runs on CUDA or Apple Silicon (Windows/Mac still experimental). Covered by Stability's **Community License**: free for commercial use under $1M/year revenue (any source), Enterprise license required above that — no issue at Sojourney's current stage. Quality is noticeably behind TRELLIS.2/Hunyuan3D (less detail, more artifact-prone) but the speed and low hardware bar make it good for rapid iteration/prototyping.

**TripoSR / InstantMesh** — [github.com/VAST-AI-Research/TripoSR](https://github.com/VAST-AI-Research/TripoSR) (MIT), InstantMesh (Apache 2.0)
Older, lighter, fully permissive-licensed single-image reconstruction models. Lower fidelity than the above but genuinely free of any restriction, and cheap to run. Useful as a fallback or for very fast rough-draft iteration.

## Hosted / commercial, low-cost

**Sloyd** — [sloyd.ai](https://www.sloyd.ai/)
Different category: **procedural**, not diffusion-based generation, so output is always clean topology with no cleanup needed. $15/mo for unlimited generations (no per-model credit cost), exports GLB/FBX/OBJ/USD/STL, has an API. Works on discrete objects (props, furniture, structures) rather than full scenes; nature assets aren't its headline use case but nothing excludes them. Good candidate for quick, disposable generic props where clean topology matters more than photoreal detail.

**Tripo AI** — [tripo3d.ai](https://www.tripo3d.ai/)
Cheapest of the hosted diffusion generators (~$0.21/model at the $15.90 tier), game-dev-focused with auto-rigging and stylized presets. Reasonable quality, most affordable option if you want to supplement local generation without standing up a GPU.

**Meshy** — [meshy.ai](https://www.meshy.ai/)
Fast iteration (8 preview variants in ~60s), plugins for major DCC tools, ~$0.40/model. Reviewers consistently note outputs "often need cleanup" — expect a retopo pass in Blender.

**Rodin / Hyper3D (Deemos)** — [hyper3d.ai](https://hyper3d.ai/)
Rated best-in-class for production-readiness in every comparison I found: clean quad topology, proper UV mapping, PBR textures out of the box — the least Blender cleanup of any tool tested. Trade-off is slower generation (2-5 min) and higher cost. Worth it for true hero assets (a signature rock formation, a landmark) where quality matters more than throughput.

## Vegetation and terrain specifically
This is the part most relevant to "biome-accurate" immersion, and it's the current weak point industry-wide:

- **Rocks, cave formations, geological features, driftwood, weathered surfaces**: strong use case. Single-image reconstruction handles irregular organic-but-static forms well — this maps directly onto the cave/surface data work already in the project.
- **Individual plants/mushrooms/isolated flora**: workable as single hero specimens, especially from a photo.
- **Trees, canopy, dense undergrowth, grass fields**: weak. Generated foliage tends toward blobby geometry, poor alpha-card topology, no wind-rig-friendly structure, and no natural instancing/variation. Every source that tested this recommends dedicated procedural tools (Blender's geometry nodes scatter system, or a foliage-specific tool) over AI generation for vegetation *coverage* — use AI only to create the 2-5 base specimens per biome that you then scatter with procedural variation (scale/rotation/color jitter) rather than trying to generate a whole forest.

## Pipeline notes (Blender → Babylon.js v9)
- GLB in, GLB out is the path of least friction — avoid FBX/OBJ round-trips where possible since they lose PBR material fidelity.
- Raw AI meshes are usually dense and unoptimized (six figures to 1M+ triangles) and often non-manifold — budget a decimate + cleanup pass in Blender regardless of source tool. Rodin and Sloyd need the least of this; Meshy/TRELLIS/SF3D need the most.
- Babylon.js's default PBR material is metallic-roughness, matching glTF's spec and every tool's default export — no material workflow conversion needed, just re-bake/compress textures for target platform (Babylon glTF loader handles KTX2/Draco compression well if you add it in the Blender export step).

## Recommendation for Sojourney
Given the no-budget/open-source preference: start local with **Stable Fast 3D** for fast prototyping (low hardware bar) and **TRELLIS.2** for final-quality hero assets if a 24GB-VRAM GPU is available (rent cloud GPU time per-batch if not — cheaper than per-model hosted credits at any real volume). Supplement with **Tripo AI**'s hosted credits for one-off assets when local generation isn't convenient, and consider **Rodin** for a handful of true landmark/signature assets per biome where topology quality matters most. Treat vegetation as a procedural-scatter problem, not a generation problem: use AI for a small library of hero specimens, then scatter and vary them in Blender or directly in Babylon.js.

## Sources
- [TRELLIS.2 GitHub](https://github.com/microsoft/TRELLIS.2)
- [Hunyuan3D-2.1 License](https://huggingface.co/tencent/Hunyuan3D-2.1/blob/main/LICENSE)
- [Hunyuan3D-2.1 on Hugging Face](https://huggingface.co/tencent/Hunyuan3D-2.1)
- [Stable Fast 3D GitHub](https://github.com/Stability-AI/stable-fast-3d)
- [Stability AI Community License](https://stability.ai/license)
- [TripoSR GitHub (MIT)](https://github.com/VAST-AI-Research/TripoSR)
- [Sloyd text-to-3D](https://www.sloyd.ai/text-to-3d)
- [Sloyd AI pricing comparison](https://www.sloyd.ai/blog/3d-ai-price-comparison)
- [Best AI 3D Model Generator in 2026 — 9 tools tested (Indie Hackers)](https://www.indiehackers.com/post/best-ai-3d-model-generator-in-2026-i-tested-9-of-the-best-and-here-is-what-i-found-70ecab1a0a)
- [Tripo AI: terrain and rock generation guide](https://www.tripo3d.ai/blog/explore/how-to-generate-terrain-and-rocks-with-ai)
- [Rodin / Hyper3D](https://hyper3d.ai/)
