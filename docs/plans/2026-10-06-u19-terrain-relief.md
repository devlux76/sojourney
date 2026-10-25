# U19 Midday Terrain Relief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sunlit rock read as craggy (not soft/melted) at midday, by restoring metre-scale edges to the GPU and giving lighting something to work with at kilometre range.

**Architecture:** Diagnose first (measure exactly which edge scales are missing at the U19 viewpoints), then fix geometry and lighting as two independent changes: near-field edge restoration from the 1 m lidar window versus shadow/AO reach extension, each measured against Q1 baselines so frame rate never regresses.

**Tech Stack:** Python 3 data tools (`tools/ground_*.py`, `tools/build_ground.py`), Babylon.js 9.x PBR ground shader (`src/engine/TerrainMaterial.ts`), streaming/LOD (`src/engine/groundStream.ts`), environment lighting (`src/engine/environment/index.ts`), Bun for build/typecheck/tests.

---

## Verified facts (do not re-derive; these were checked 2026-10-06)

- Heightfield: `assets/crater-lake/terrain/source/heightmap.json` = 9001 samples over 18000 m = **2.0 m spacing**. Sub-4 m edges are gone before any mesh is built (`tools/heightfield.py:18,28-36` — bilinear over the 2 m grid).
- Mesh: `QUADS = 128`, `MIN_METRES = 250` (`tools/ground_quadtree.py:10-11`). LOD0 vertex spacing = size/128: **250 m leaf → 1.95 m**, 500 m → 3.9 m, 1000 m → 7.8 m. Leaf sizes in pack: 250 m ×744, 500 m ×414, 1000 m ×146, 2000 m ×7 (measured from `public/packs/crater-lake/ground/ground.json`).
- Baked normal: `N_OUT = 8192` over 18000 m = **2.197 m/texel** (`tools/ground_normalmap.py:23-25`, contract `docs/specs/2026-10-02-ground-normal-ao-contract.md`). `TerrainMaterial` **replaces** the mesh normal with `bakedNormal()` + tiled detail (`src/engine/TerrainMaterial.ts`, `CUSTOM_FRAGMENT_BEFORE_LIGHTS`) — mesh normals never shade the interior.
- Tiled detail is micro grain, not macro crags: rock 8 m, gravel 3 m, needles 3 m, soil 1.3 m (`tools/build_ground.py:63-67,88`, confirmed in shipped `ground.json`).
- LOD reach: `lod_distances = 50 * step * 2^(k+1) + radius` (`tools/build_ground.py:260-262`). A 250 m leaf holds LOD0 to ~404 m (`lodDistances[0]` in manifest). Measured 2026-10-06 from the route file: the Llao Rock boat stop is at ~(1416, 3268) (`boat_tour.json` sight distance 3860.6, matches the `places` entry [1424, 3274.2]); nearest waterline is **~185–190 m** off the boat (radial search on the heightfield), the wall top (+470–500 m) ~930–1000 m out. So the shore/base draws LOD0 (1.95 m) while the upper wall draws LOD1–LOD2 (3.9–7.8 m) — no kilometre sightlines here; the 2 m source/bake floor dominates up close, mesh coarseness joins higher up.
- Lighting reach at that range is zero by construction: ground leaves are never shadow casters (`configure` sets `receiveShadows` only, `src/engine/groundStream.ts:172`); `shadowMaxZ = 600`, SSAO `maxZ = 200` (`src/engine/environment/index.ts:150,191`); ground `roughness = 1`, haze `aerialPerspectiveIntensity = 1.4` (`src/engine/ground.ts:87`, `environment/index.ts:132`).
- The 1 m source still exists: `tools/.cache/ds716/window1m.npy` + `window1m.json` are on disk — the near-field fix has data to work from.
- Evidence `sojourney_2026-10-06_02-38-25.png`, `...02-39-02.png`, `...02-39-15.png` sit **uncommitted in the repo root** and must be filed or deleted (ISSUES.md section E rule).

## Related issues — what shares a root cause and what does not

| Issue | Relation to U19 | Work together with U19? |
|---|---|---|
| U18 (one near foothill soft/melty, background fine) | Same *symptom*, different *scope*: per-leaf suspect (wrong level, missing blend, camo smoothing) vs U19's global triple-2 m floor. U18's shot ran SwiftShader — may be a backend artefact. | Re-shoot together, diagnose separately; do not merge fixes. |
| P1 symptoms 3–4 (cards glow orange / black dots on walls) | Same distant-sunlit-rock lighting regime; card-bake suspect is independent of the ground mesh/normal floor. | Re-judge at low sun after any U19 lighting change; keep the card re-bake a separate fix. |
| Q1 (ground 17 ms, card-limited 8.9 fps full-res) | Denser work (A) and extra bindings (B) cost frame time, but budgets do NOT gate this work (lead ruling 2026-10-06: budgets apply only in optimization passes). | Re-measure ground ms before/after as an informational record; Q1 owns optimization later, not a veto now. |
| Q4 (shader/rendering review) | `TerrainMaterial.ts` changes belong to Q4's review surface. | File U19 shader findings under Q4, not Q1 (ISSUES.md §F). |
| U12 follow-up (floating origin / nearer far plane as general depth cure) | Alternative relief lever: finer depth helps close-pair relief everywhere. | Evaluate as the lighting-reach alternative, not the geometry fix. |
| U13 remainder / U17 (fade coverage, dither flash) | LOD densification adds more switches for the fade to cover; U17's flash smells like a degenerate fade interval. | Capture fade state + scaling level in every U19 repro; extend fade coverage to any new near level. |
| E11 (sun glint ball on lake) | Same lesson ("lighting can't restore missing data") applied to water; separate material. | No shared fix. |
| Look-tuning + optimizer stale risks (§F) | SSAO2/camo/strata/scree/haze/beauty-hold all change relief reading. | Re-judge relief only after re-shooting on current behaviour. |
| E20 (weather at beauty stops) | Same boat-tour test bed, no shared cause. | Combine the boat rides, not the fixes. |

---

### Task 1: File the U19 evidence and record viewpoints

**Files:**
- Move: `sojourney_2026-10-06_02-38-25.png`, `sojourney_2026-10-06_02-39-02.png`, `sojourney_2026-10-06_02-39-15.png` → `tools/.cache/shots/u19-midday-relief/`
- Modify: `tools/.cache/shots/playtest/coords.md` (append entries)

- [ ] **Step 1: Move the three shots out of the repo root**

```bash
mkdir -p tools/.cache/shots/u19-midday-relief && mv sojourney_2026-10-06_02-38-25.png sojourney_2026-10-06_02-39-02.png sojourney_2026-10-06_02-39-15.png tools/.cache/shots/u19-midday-relief/ && git status --short
```

Expected: `git status` shows no `sojourney_*.png` in root (the shots dir is cache, not committed).

- [ ] **Step 2: Append viewpoint records**

Append to `tools/.cache/shots/playtest/coords.md`:

```markdown
- u19-midday-relief/02-38-25: boat stop near Llao Rock, ~11:30, camera TBD (re-shoot and fill in position/yaw/time/weather from the HUD photo mode).
- u19-midday-relief/02-39-02: same session, second angle, fields TBD as above.
- u19-midday-relief/02-39-15: close slope that stays soft with Sun Shadows on and SSAO2 at 4 — the geometry-floor proof shot.
```

- [ ] **Step 3: Re-shoot all three on the real GPU with full HUD state**

Run: `bun run dev`, ride the boat tour to the Llao Rock stop at ~11:30 clear weather, photograph the same three framings with the HUD visible (position, fps, weather). Save under `tools/.cache/shots/u19-midday-relief/` as `reshoot-*.png` and fill in the TBD fields from Step 2.

Expected: three re-shoots with known camera, time 11:00–12:00, weather clear; keep the old shots for before/after.

RESOLVED 2026-10-06 — headless is SwiftShader (proven: `navigator.gpu: false`, SwiftShader
ANGLE string even with the start-game.sh Vulkan flags), but a headed Chromium on the real display
with `--remote-debugging-port` gives full GPU (`ANGLE (AMD, Vulkan ... RADV POLARIS11)`,
`navigator.gpu: true`) and is drivable over CDP: seed/clear weather via the settings-panel DOM,
T-travel between `places`, `Page.captureScreenshot`. First re-shoot done this way (see the
`reshoot-*` coords entries): `reshoot-wide.png` (user-framed, clear, ~11:00) matches the
02-38-25/02-39-02 viewpoint; the two `glide` shots sailed into a fog bank and are fog evidence,
not relief evidence. Lead judgment on the re-grade: ~25% better, still nothing like the IRL boat
photo — the albedo work alone does not carry; further relief work is needed. Addendum, same ride: Devils
Backbone reads ~40% better under the re-grade — the albedo carries further where the wall is
already well-lit and structured; Llao's shortfall is the missing metre-scale edges, i.e. geometry.

- [ ] **Step 4: No commit — `tools/.cache` is gitignored by design**

The move and the coords append live on disk only (verified 2026-10-06: `git add` under `tools/.cache` fails on `.gitignore:5`, and the lead ruled against `-f`). Do not commit, do not touch `.gitignore`.

---

### Task 2: Count the missing edge scales against the 1 m lidar

**Files:**
- Create: `tools/check_u19_relief.py`
- Data: `tools/.cache/ds716/window1m.npy`, `assets/crater-lake/terrain/source/heightmap.json`

- [ ] **Step 1: Write the measurement script**

Create `tools/check_u19_relief.py`:

```python
"""U19 pin-down: which edge scales survive each pipeline stage at the Llao Rock slope.

Compares, over the preview_llao window (world x=935, z=3800, 1000x1000 m):
  1m lidar (window1m.npy) -> 2m heightmap bilinear -> LOD0 mesh spacing -> 2.2m bake texel.
Reports RMS slope energy per octave so the lead can see which octave is empty where.
"""
import json
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

CACHE = pathlib.Path("tools/.cache/ds716")
META = json.loads((CACHE / "window1m.json").read_text())


def octave_energy(h, step):
    energies = {}
    for octaves, label in ((1, "1-2m"), (2, "2-4m"), (4, "4-8m"), (8, "8-16m")):
        k = max(1, int(round(octaves / step)))
        co = h[k:-k or None, k:-k or None].astype(np.float64) if k > 1 else h.astype(np.float64)
        if k > 1:
            from PIL import Image
            small = np.asarray(Image.fromarray(h).resize(
                (h.shape[1] // k, h.shape[0] // k), Image.Resampling.BILINEAR)).astype(np.float64)
            big = np.asarray(Image.fromarray(small).resize(
                (h.shape[1], h.shape[0]), Image.Resampling.BILINEAR)).astype(np.float64)
            detail = h.astype(np.float64) - big
        else:
            detail = h.astype(np.float64)
        energies[label] = float(np.sqrt((detail ** 2).mean()))
    return energies


def main():
    src = np.load(str(CACHE / "window1m.npy"), mmap_mode="r")
    print("window1m shape %s dtype %s" % (src.shape, src.dtype))
    print("bake texel S = %.4f m; LOD0 spacing on 250m leaves = %.4f m" % (18000.0 / 8192, 250.0 / 128))
    # Llao Rock preview window centre in source pixels is resolved here at run time
    # from window1m.json registration (same convention as tools/ground_normalmap.py).
    print("registration: " + json.dumps(META, sort_keys=True))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it and record the numbers**

Run: `python3 tools/check_u19_relief.py`

Expected: prints window shape/dtype, the 2.1973 m bake texel and 1.9531 m LOD0 spacing, and the registration JSON. Paste the output into the Task 5 decision note.

- [ ] **Step 3: Extend the script to the full octave comparison and re-run**

Extend `octave_energy` callers to (a) load the 1 m window crop around (935, 3800), (b) downsample it to 2 m with bilinear (simulating `heightfield.height`), (c) report per-octave RMS for both. The 2–4 m octave collapsing toward zero in (b) but not (a) is the geometry-floor proof.

Run: `python3 tools/check_u19_relief.py`

Expected: per-octave RMS table showing which octave empties at the 2 m stage.

- [ ] **Step 4: Commit**

```bash
git add tools/check_u19_relief.py && git commit -m "feat: add U19 relief octave-measurement script"
```

---

### Task 3: Confirm the drawn LOD and lighting reach at the U19 viewpoints

**Files:**
- Modify: none (read-only diagnosis using `public/packs/crater-lake/ground/ground.json`)
- Reference: `tools/build_ground.py:260-262`, `src/engine/groundStream.ts:203`, `src/engine/environment/index.ts:150,191`

- [ ] **Step 1: Confirm the drawn level at the real viewing distances (measured, not guessed)**

```bash
python3 -c "
step = 250.0/128; radius = 177.0
dists = [50*step*2**(k+1)+radius for k in range(4)]
print(['%.0f' % d for d in dists])
for r in (190, 400, 700, 950):
    print('level at %dm:' % r, sum(r > d for d in dists))
"
```

Expected: switches ≈ [372, 567, 958, 1739], so the waterline/base (~190 m) draws LOD0 (1.95 m spacing — the bake's 2.2 m is the floor there, not the mesh), mid-wall (~400–700 m) LOD1 (3.9 m), upper wall/summit (~950 m) LOD2 (7.8 m). The mountaintop is ~1 km out, never kilometres: if the close slope in `...02-39-15.png` is soft, it is the 2 m source + 2.2 m bake, full stop.

- [ ] **Step 2: Verify lighting reach cannot explain midday relief loss**

Read-only check: `src/engine/groundStream.ts:172` (`receiveShadows` only, no caster), `src/engine/environment/index.ts:150` (`shadowMaxZ` 600), `:191` (`maxZ` 200). Correction 2026-10-06: at this viewpoint the 600 m shadow cascades already cover the whole visible face (shore 190 m, summit ~950 m — only the top fringe falls outside), and SSAO grazes just the waterline. So the gap here is *casters*, not *reach*: making ground cast within the existing cascades is the lighting lever for Llao Rock, while reach extension (or U12's floating origin) only matters for genuinely distant views. At 11:30 with the sun near overhead (N·L ≈ 1) even full shadows add little — record that geometry-first ordering stands, but the lighting fix is cheaper than previously stated.

- [ ] **Step 3: Rule U18 in or out on the real GPU**

Re-shoot `tools/.cache/shots/boat-tour/00-boarded-cleetwood.jpeg`'s viewpoint (Cleetwood dock, same yaw) in Chromium/WebGPU on the real GPU. If the near slope reads craggy there, U18 was a SwiftShader artefact or a stale-leaf issue — close it as backend-specific and note it. If it is still melty while its background is fine, open a per-leaf diagnosis (check that leaf's `lodDistances` and whether its near file was loaded) as a separate task; do not fold it into the U19 geometry fix.

---

### Task 4: Choose the near-field fix (DECIDE — project lead picks one)

**Files:** decision record appended to this plan file before implementation starts.

Options, each implementable behind the existing pack build (no runtime flags — rule 2):

- **A. Denser near mesh from the 1 m window.** Sample LOD0/LOD1 of shore/wall/island leaves (the 744 × 250 m leaves) from `window1m.npy` instead of the 2 m heightfield. Cost: bigger near files, more streaming; Q1 measures. Carries real edges down to ~1 m.
- **B. Macro-relief detail normal.** Add a mid-scale tiled normal (20–60 m tile) carrying crag/octave energy the 2.2 m bake cannot, blended by slope like `strataTint`. Cost: one more texture binding (WebGPU 16/stage budget — count first), no mesh cost. Hides rather than restores silhouette edges.
- **C. Authored crag meshes on the walls.** Real rock geometry (P1-style props) pinned to the steepest walls. Cost: asset work, placement pipeline; best silhouettes, slowest to ship.

- [ ] **Step 1: Write the one-page trade-off with Task 2's numbers**

Which octave is empty decides: if 1–2 m holds the missing energy, A; if 4–16 m is also empty at LOD2+ viewing distances, A alone cannot fix the boat views and B or C must cover distance.

- [ ] **Step 2: Get the lead's pick (A, B, or C) and record it here**

**DECISION UPDATED 2026-10-06 (project lead): B first; A only if B leaves the terrain too soft, with denser meshes as an option for higher-performance systems. C is dropped because its added geometry is too costly.** Task 7 (albedo/material grading) is complete. B is the next implementation: build a macro-relief normal from the existing 1 m lidar window, tile it at a medium scale, and blend it into the ground material. The 1 m sampling helper is authoring infrastructure only; it is not wired into the production mesh. The octave diagnostic confirms the 2 m capture retains just 8% of the lidar's 2–4 m octave (0.545 m vs 6.775 m RMS), while the 4–8 m and 8–16 m bands survive at 1.18× and 1.04×. Sampling those same 129 LOD0 nodes from the 1 m source would retain 86.5%, but the lead chose the lower-cost normal pass first. No authored wall-crag geometry will be added. Q1 measurements are informational for this appearance pass.

Implement B first. The lighting-reach extension (shadow-caster ground within 600 m cascades, SSAO reach, or U12's floating-origin general cure) is a *separate* decision recorded alongside — it fixes flat, not melted.

---

### Task 5: Implement the picked fix

**IMPLEMENTED 2026-10-06 — option B through NME asset authoring.**
`tools/build_terrain_relief.py` derives a periodic 64 m height tile from the registered
1 m DS 716 crop at Llao (935, 3800), detrends it and retains 2–16 m wavelengths.
The committed NME graph in `tools/materials/terrain-relief/normalBake.json` uses
Babylon's HeightToNormalBlock offline; a 512² normal bake ships with all 10 mip levels.
The rock normal packs micro XY in RG and relief XY in BA at separate 8 m/64 m scales,
so the runtime adds no mesh triangles or texture bindings. The runtime applies relief
to exposed rock while retaining the terrain plugin's lake bed, caustics, wetness and
forest paint. The native PBR terrain material remains the runtime composition; this
is not a claim that the whole terrain has been migrated to NodeMaterial.

Both WebGL and WebGPU render the bake and the terrain material. Analytical increasing-X
and increasing-Z ramps verify normal direction in both backends; the NME convention
correction and maximum 0.0065 unit-normal encoding error are recorded in `NME_NOTES.md`.
Build and type checks pass; 25 Bun tests passed before the separate pack-cache regression
was added. The full game downloaded the complete pack and travelled to the ship,
Wizard Island and Llao with no captured console errors. Recovery also completed the
interrupted near-mesh compression: 1,311/1,311 valid GLBs, not the former 146/1,311.

The lead's initial visual assessment is approximately **65% better than before**.
This is a visual judgment, not a measured speedup or a final U19 sign-off. All six
`references/llao-rock/` photos were inspected: the lake-facing references show broad
grey faces, deep vertical joints, sharp ledges and pale scree; the render still carries
too much fine rippling in some faces. The fixed-LOD material harness is closer to the
eastern boat stop than the broad south-west photo views, so its outline is not a valid
matched-view geometry comparison. The clear, unoptimized full-game reference inspection
is captured at `tools/.cache/shots/u19-midday-relief/nme-full-game-reference-view.png`:
camera (0,20,1800), target (935,290,3800), 1280×651 WebGPU, native full rendering features
restored, weather set to clear and fog disabled in the inspection session only. That
south-west view restores the broader tabletop outline; it still needs sharper large
ledges and a better cliff/scree colour contrast to match the photos. The capture measured
about 10 fps at full quality; it is not a controlled before/after performance result.
Further visual tuning or fallback A remains subject to the lead's review. C remains dropped.

**Files (option B; adjust only if the lead later selects A):**
- Modify: `tools/ground_normalmap.py` or a dedicated authoring tool to derive a medium-scale normal tile from the registered lidar window.
- Modify: `tools/build_ground.py` and the ground manifest to encode and ship the new tile.
- Modify: `src/engine/TerrainMaterial.ts` and its ground texture loading path to blend the normal by slope; verify the sampler budget first.

- [ ] **Step 1: Write a check for the selected material change**

Compare the generated macro normal against the 1 m lidar at the 2–4 m and 4–16 m bands. Keep the existing octave report as the source-data baseline; it does not assert a mesh acceptance threshold because the first selected fix is material-only.

Run: `python3 tools/check_u19_relief.py`

Expected: the pre-change material has no macro-relief contribution in the missing band.

- [ ] **Step 2: Implement the minimal pack change that makes the check pass**

Author the tile offline from lidar and ship it as an asset; do not derive or downscale terrain data at runtime.

- [ ] **Step 3: Rebuild the ground pack and re-run the check**

Run: `python3 tools/build_ground.py --meshes` then `python3 tools/check_u19_relief.py`

Expected: PASS. Note wall-clock build time in the commit message (regression signal for the pipeline).

- [ ] **Step 4: Typecheck, tests, and Q1 re-measure (informational, not a gate)**

```bash
bun run typecheck && bun test
```

Expected: clean (note: 2 pre-existing typecheck errors at `SettingsPanel.ts:87`, `environment/index.ts:29` as of 2026-10-06 — confirm no NEW ones). Then re-measure Q1's ground figure (was 17 ms) on the same view as `docs/baselines/2026-10-03-q1-measurements.md` and record before/after in the commit message or `docs/baselines/`. For the record only — budgets do not block landing.

- [ ] **Step 5: Commit**

```bash
git add tools/ src/ && git commit -m "fix: restore metre-scale relief to <what> (U19)"
```

---

### Task 6: Regression net and sign-off

- [ ] **Step 1: Re-shoot U19 + U18 + P1 symptoms 3–4 + E11 in one session**

Boat tour at midday (U19), the Cleetwood close slope (U18), the Watchman wall at low sun (P1-3/4), the low-sun glint (E11). One ride, four judgments. File under `tools/.cache/shots/` per section F.

- [ ] **Step 2: Re-judge the look-tuning on the new geometry**

Strata/scree/camo reads were tuned against soft slopes; confirm they still read as rock, not camouflage, on craggy ones. If the mottling complaint returns, file under Q4, not here.

- [ ] **Step 3: Confirm no U17-class flash from any new LOD switch**

Ride through every new switch distance with fade state logging on; any full-screen dither flash with a stale interval reopens U17, not U19.

- [ ] **Step 4: Ask for sign-off**

U19 sign-off is the lead's midday boat ride: close slopes craggy at range, near slopes craggy up close, no fps regression against the Q1 baseline. Move U19 to section B with the measurement numbers; leave U18/P1/Q4 entries to their own sign-offs.

---

### Task 7: Albedo/material rework from the IRL boat reference (APPROVED — implement first, before Task 5)

Reference: `docs/research/llao-rock-boat/llao_rock_from_boat.jpg` + `llao_rock_from_boat_4k.png` (1511×1041 upscaled). The 4k is oblique with baked-in light — a grading/structuring guide, not a tileable source. **Licence: SETTLED 2026-10-06 — NPS photo = US Government work, public domain, cleared for reference and texture extraction; credited in `CREDITS.md`, logged in `LICENSING-TODO.md`.**

Measured palette from the 4k (land rows only, sRGB):
- dark crag grey 32% @ (0.13, 0.15, 0.17) — cool, blue-grey, not brown
- mid grey 22% @ (0.40, 0.40, 0.41)
- pale grey/scree 26% @ (0.61, 0.61, 0.61), neutral
- warm brown weathering only ~4% @ (0.49, 0.48, 0.30)
- white 20% is **snow, early season — read as pale glacial scree** (lead ruling 2026-10-06). The game runs 15 June + 60 days (`startMonth: 6, startDay: 15`, `src/biomes/crater-lake/index.ts:10`) = midsummer: model it as scree (~0.6 neutral grey), implement no snow.
- Current shipped base `dark_rock_02` mean (0.23, 0.20, 0.17): ~half the brightness of the real mid grey and warm-shifted — the ~2× albedo gap behind the dark-brown read, before lighting even runs.

Structural deltas (all visible in the reference, none in our material):
1. **Vertical structure dominates**: fractures/dikes run down the crag; our `strataTint` bands run horizontally (26 m) and read as contour-following. Add vertical streaking keyed to steepness, keep horizontal bands faint (they exist lower on the wall, buried under the vertical read).
2. **Pale scree chutes in gullies**: near-white talus tracks run from rim to waterline down drainage lines. Needs gully-aware placement (drainage from the heightfield or splat channels), not uniform scree.
3. **Brown weathering is an accent** (~5–10% cover), not the base: demote `strataTint` rust from dominant to patchy.
4. Conifers cluster in gullies/ledges, not scattered dither — route to the flora placement (P1), not this task.

- [ ] **Step 1: Get the licence ruling, record it here and in `LICENSING-TODO.md`.**
- [ ] **Step 1b (ktx tooling, RESOLVED): no install needed.** `ktx` v4.4.2 lives at `~/.local/opt/KTX-Software-4.4.2-Linux-x86_64/bin` and `tools/compress_textures.py:ktx_env()` already falls back to it — the earlier "ktx CLI missing" report was a PATH issue in that session, not a missing tool. ktx2 = the format, `ktx` = the CLI that writes it; no confusion in the pipeline. Remaining texture work (4 loose non-KTX2 files, `moon.jpg`/`milkyway.jpg` provenance): see `docs/plans/2026-10-05-pack-ops-and-texture-cleanup.md` Phases 1–3.
- [ ] **Step 2: Re-grade the rock base toward the measured ramp** (dark cool-grey → mid grey → pale scree) and re-shoot the Llao boat stop side-by-side with the reference.
- [ ] **Step 3: Prototype vertical streaking + gully scree chutes**, judged against the reference at midday.
- [ ] **Step 4: Q1 re-measure** (texture bindings count against WebGPU's 16/stage — B4's reason for arrays).

## Self-review

1. **Spec coverage:** U19's "compare against 1 m lidar / POI photo and count the missing edge scale" → Tasks 2–3. "Decide the near-field fix separately from shadow/AO reach" → Task 4's two-track decision. "Distinct from U18" → Task 3 Step 3 keeps U18 separate. Related-issue links (P1, Q1, Q4, U12, U13/U17, E11, E20, §F staleness) → table + Task 6.
2. **Placeholder scan:** no TBD/TODO left except Task 1's viewpoint fields, which the re-shoot step itself fills — that is the task's deliverable, not a gap.
3. **Type consistency:** file paths match the verified tree (`tools/ground_quadtree.py:10`, `tools/build_ground.py:260`, `src/engine/groundStream.ts:172`, `src/engine/environment/index.ts:150,191`); command names match `bun run typecheck` / `bun test` per AGENTS.md.
