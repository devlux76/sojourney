# Packsmith Roadmap: What the Agent Does Alone, and Where the Project Lead Steps In

**Spec:** `docs/superpowers/specs/2026-09-28-asset-pack-pipeline-design.md` (stages 0–14, milestones M0–M9).
This is a roadmap, not a task-level plan: each phase below gets its own detailed plan
(superpowers:writing-plans) when work on it starts.

## The split

- **Agent (A):** anything that is code, scripts, free/open tools, public data, installs on the dev
  machine, Blender scripting, engine work, browser-driven testing, research and fact-checking.
- **Project lead (L):** anything that needs money, an account or terms accepted in the company's
  name, a licence negotiated with a rights holder, a product decision, a human sign-off, or the
  physical world (real phones, field photos, contacting people).

## Environment facts that decide the split (checked 2026-09-28)

- The dev machine has **no CUDA GPU, but it does have GPU compute**, and existing out-of-repo work
  already uses all of it:
  - `stable-diffusion.cpp`/ggml over Vulkan on the discrete AMD GPU (4 GB). ROCm on that GPU was
    tried at length and does not work reliably; don't plan on it.
  - SYCL/Level Zero on the integrated GPU, which shares roughly 27 GB of system memory.
  - oneAPI (icx, MKL, TBB) for fast CPU inference.
  - A local LLM stack (llama.cpp/Ollama builds for this hardware) for cheap bulk text work.
- What that means per model (to be confirmed by the phase-2 spikes below):
  - **Probably local:** image generation for textures and billboard cards (SD-class models via
    `stable-diffusion.cpp` over Vulkan or SYCL).
  - **Maybe local, slowly:** TripoSR-class image-to-3D and Stable Audio Open, on the CPU or through
    PyTorch on the integrated GPU; Stable Fast 3D (custom baking extensions).
  - **Still remote (L2):** TRELLIS.2 (24 GB plus custom CUDA kernels) and UniRig (spconv and
    flash-attn are CUDA-only). Simple fauna rigs can instead be scripted in Blender (Rigify, Spline
    IK), which needs no model at all.
- The engine plane runs locally in headed Chrome on a real (desktop-class) GPU. Its performance
  numbers are a regression baseline, **not** phone numbers.
- Blender 5.2 is installed (the design needs 5.1+), so headless `bpy` and the Blender Lab MCP work.
- Public data endpoints (USGS TNM, GBIF, iNaturalist, LANDFIRE, Planetary Computer/NAIP, Hugging
  Face) are reachable without keys.
- Missing but free to install: GDAL/rasterio/PDAL/pyproj/geopandas, ffmpeg, gltfpack,
  glTF-Transform, KTX-Software, Khronos glTF Validator. Use a `uv`-managed Python 3.12 environment
  for the GIS stack (the system Python is too new for some wheels).

## Stage by stage

| Stage | Agent can do | Needs the project lead |
|---|---|---|
| 0 Intake | Site resolution, bounds, biome tags, origin, `site.json` | Choosing between ambiguous sites (director mode) |
| 1 Dossier | GBIF/iNat/NPS pulls, claim classification, adversarial pass, `facts.json`, scoring vs the fact-check | GBIF account for bulk downloads (L1); sign-off for `verified` (L4) |
| 2 Data | DS 716, 3DEP, SIM 2832, NPS veg map, TreeMap, NAIP, OSM, LANDFIRE; reprojection and tiling | OpenTopography API key for the DOGAMI lidar (L1) |
| 3 Terrain/water/horizon | Heightfield tiles, colliders, bathymetry depth map, water material, horizon ring | Decision: shared `crater-lake.base` pack or not (L3) |
| 4 Classification | Substrate, vegetation and mask rasters | — |
| 5 Look-dev | Look-dev scene, atmosphere add-on, PBR Neutral, exposure, albedo lint, `lighting.json` | "Daylight looks real" sign-off (L4) |
| 6 Materials | CC0 Poly Haven/ambientCG sets, local AI textures for gaps (e.g. oxidized scoria), albedo lint, micro-scatter, snow-layer hook | Photo-to-PBR from own captures needs field photos (L5) |
| 7 Vegetation | EZ-Tree species presets (no GPU), TreeMap density and snags, Poisson placement, wind weights, LODs and impostors baked in Blender | — |
| 8 Hero props | CC0 scanned rocks, Blender-procedural block lava, local TripoSR-class drafts, cleanup/LOD/collider scripts | TRELLIS.2-quality meshes need remote GPU compute (L2) |
| 9 Fauna | Local draft meshes, scripted Blender rigs (Rigify, Spline IK snake), behaviour state machines, habitat spawn rules | UniRig/Tripo auto-rigs and hero-quality meshes need remote compute or paid APIs (L2) |
| 10 Audio | Public-domain NPS Sound Gallery clips, local Stable Audio Open ambience beds, footstep pipeline, loudness normalisation, `AudioEngineV2` wiring | Freesound account (L1); commercial licences for species calls (L2); listen checks (L4) |
| 11 Climate | Normals, weather weights, sky params from public data | — |
| 12 Packaging | gltfpack/glTF-Transform/KTX2, validator, manifest, generated `CREDITS.md` | — |
| 13 Verification | Test hooks, DevTools MCP harness, viewpoint/time sweeps, webcam match, perf traces | Real-phone runs (L5) |
| 14 Release | Punch lists, re-runs, gate reports | `verified` sign-off (L4); release decision |

## The autonomous run (in order)

Each phase ends with its milestone's gate passing and a commit. Phases 1–9 need nothing from the
project lead except where marked; a free signup that hasn't happened yet just skips that input and
logs it.

1. **Tooling.** Install the GIS stack, ffmpeg, glTF/KTX tools and validator. Install the Blender Lab
   MCP and run pipeline Blender under a separate unprivileged Unix account whose only shared folder
   is the pack workspace (the design's VM requirement, met locally).
2. **Local compute spikes (throwaway).** One short probe each, reported as works / works slowly /
   doesn't: SD-class texture and card generation (`stable-diffusion.cpp` over Vulkan and
   over SYCL); PyTorch on the integrated GPU; TripoSR, Stable Fast 3D and Stable Audio Open on
   whichever of that or the CPU works. Check outputs for corruption rather than trusting exit codes,
   and don't run them during engine perf captures (shared thermals). The results decide which L2 items actually need buying.
3. **M0 — engine test hooks and baseline.** `window.__sojourney` hooks (`setCamera`, `setTime`,
   `setWeather`, `waitForIdle`, `getStats`, viewpoints, scripted walk, deterministic seed). DevTools
   MCP harness capturing the current Crater Lake pack's viewpoints and stats.
4. **M1 — look-dev.** Look-dev scene, atmosphere add-on, locked tonemapper and exposure, albedo
   references and lint. Ends with a before/after sweep for the project lead to sign off (L4); later
   phases continue while that review is pending.
5. **M2 — contract.** Manifest JSON schema, `pack.plan.json` with input hashing and downstream
   invalidation, validator with gates G1–G12 (G13 is the human gate).
6. **M3 — dossier.** Stage 1 run from scratch for Wizard Island, scored against
   `docs/research/wizard-island-fact-check.md` (target: catch all three hallucinations).
7. **M4 — terrain, bathymetry, water, horizon.** From DS 716, SIM 2832, NAIP and TreeMap.
8. **M5/M6 — ground and vegetation.** Substrate classes, CC0 materials, micro-scatter; EZ-Tree
   presets tuned against CC0/CC BY reference photos, TreeMap-driven density and snags, impostors.
9. **M7, the part that needs no money.** CC0 rocks, procedural block lava and local image-to-3D
   drafts; scripted Blender rigs and the Spline IK garter snake; public-domain and locally generated
   ambience; audio and fauna wiring with placeholder assets clearly marked in
   provenance.
10. **M8 dry run.** Package, validate and verify what exists; a before/after report and a punch list
   of exactly which assets are waiting on L2.

**Stop point:** after phase 10, remaining work is whatever the spikes showed can't run locally (at
least TRELLIS.2-quality props and UniRig-quality fauna rigs), licensed species
audio, the human sign-offs and the real-device checks. M9 (autopilot on a second site) follows once
L2 is in place.

## What the project lead needs to do

### L1 — Free signups (minutes each; best done early)

Accounts are in the company's name and accept terms on its behalf, so read each ToS for commercial
use before signing up.

- **Hugging Face** account + access token: gated model downloads, and a larger ZeroGPU quota than
  anonymous use.
- **OpenTopography** API key: the 2010 DOGAMI Crater Lake lidar (tree segmentation test).
- **GBIF** account: bulk occurrence downloads with a citable DOI.
- **xeno-canto** account/API key: search and metadata for species calls (the recordings still need
  L2 licences).
- **Freesound** account/API key: CC0 ambience and footstep sources.

### L2 — Money

- **Remote GPU compute** for whatever the phase-2 spikes can't run locally (at least TRELLIS.2 and
  UniRig). Options, cheapest commitment first: a Hugging Face PRO subscription (larger daily ZeroGPU quota), hourly rental of a
  24 GB cloud GPU per batch, or buying a local GPU. The agent writes the batch scripts either way.
- **Optional hosted generators** (Tripo, Rodin) for hero assets where open models fall short.
- **Species-call licences:** commercial permission from individual xeno-canto recordists and/or
  Macaulay Library licensing. The agent prepares the exact list of recordings and requests.
- **eBird:** a commercial agreement with the Cornell Lab, or drop eBird in favour of GBIF/iNat for
  bird lists (the agent can do the latter unaided).

### L3 — Decisions

From design §13 and the community-pack questions: target devices, moment in time, splats vs meshes,
shared Crater Lake base pack, the `verified` trust model, pack hosting, and community packs'
licences and distribution. The agent proceeds on the design's proposed defaults until told
otherwise.

### L4 — Human judgment

Look-dev sign-off, realism sign-off per pack, listen checks, and `verified` review of citations and
reference views.

### L5 — Physical world

Real iPhone/Android runs against the budgets; colour-checked reference photos from the rim
(Wizard Island itself is closed 2026–2028); any outreach to the Klamath Tribes about cultural-context
links.
