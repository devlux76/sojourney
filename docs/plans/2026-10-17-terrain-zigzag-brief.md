# Brief: remove the zigzag material edges on the terrain

Delegated task, written by Claude for OpenCode, 2026-10-17. Project lead's priority #1 now is
terrain realism, starting with this defect.

## The defect

From the highest point (world 5142, 606.5, -3970, looking north-west) the ground shows hard,
stair-stepped ("zigzag") boundaries between materials, e.g. pale gravel against darker soil/rock on
the ridge a few hundred metres away. Real ground changes material along irregular, soft edges.

## Cause (established; do not re-investigate)

`tools/ground_splat.py` `build_splatmap()` builds the terrain splat map (4096 x 4096 over 18 km,
4.4 m per texel; RGB = gravel, needles, soil weights; rock = 1 - their sum; alpha = mapped geology
class). It takes several **binary** 0/255 masks from `assets/crater-lake/ground/structure/`
(`scree.png`, `pumice.png`, `island.png`; `canopy.png` is already blurred 1.5 texels for litter)
and uses them unsoftened, e.g. `talus = np.maximum(smoothstep(*TALUS, s), scree) * (1 - canopy)`.
Their pixel staircase edges go straight into the gravel weight, so the splat has hard, pixel-stepped
boundaries. Crop check: around splat column 3218, rows 2831..2951 (north of the summit) the scree
mask edge is a binary pixel staircase and the splat shows the same hard red/blue staircase.

A second, smaller source: the geology class in splat alpha is read in
`src/engine/TerrainMaterial.ts` with `texelFetch` (nearest, `mappedSubstrate()`), and
`mappedSubstrateTint()` multiplies the ground colour by a per-class tint, so geology contacts are
4.4 m pixel staircases too. GLSL and WGSL versions of the shader both exist in that file.

## What to change

1. **`tools/ground_splat.py`: naturalize the binary masks before use.** For `scree`, `pumice` and
   `island` (and any other binary mask used for a material weight):
   - Turn each into a signed distance in metres from its edge (`scipy.ndimage.distance_transform_edt`
     on the mask and its inverse; 1 texel = 18000 / 4096 m).
   - Warp that distance with deterministic multi-octave value or gradient noise (fixed seed;
     amplitude about 6-10 m, wavelengths roughly 10-80 m) so edges become irregular, like real
     deposit margins, not map polygons.
   - Convert to a soft weight with a smoothstep over about +-2.5 m around the warped edge.
   - Put the noise/warp/softness parameters as named constants at the top with a comment saying why,
     matching the file's existing comment style.
   - Keep the RGB meaning (gravel, needles, soil; rock = 1 - sum) and all existing logic otherwise.
     The mean weights printed by the build must stay within +-0.01 of before.
2. **`src/engine/TerrainMaterial.ts`: soften geology contacts without inventing classes.** Keep the
   categorical class for every branch decision (the cinder branch tests
   `substrate > 0.5 && substrate < 1.5`; keep that using the nearest class). Only the *tint* may be
   blended: fetch the 2x2 neighbouring texels' classes, map each to its tint with
   `mappedSubstrateTint`, and blend the four tints bilinearly at a uv jittered by small value noise
   (about one texel), so the tint changes along an irregular soft contact. Do this in both GLSL and
   WGSL, keep WGSL derivative/uniformity rules (no derivatives inside non-uniform branches), and keep
   `tests/terrainCinder.test.ts` passing.
3. **Rebuild the splat map** (from the repo root of this worktree):
   ```
   uv run --quiet --with numpy --with pillow --with scipy python tools/build_ground.py --splat
   python3 tools/build_pack_index.py crater-lake
   ```
   This writes `tools/.cache/splatmap.png` and `public/packs/crater-lake/ground/splatmap.ktx2`
   (KTX-Software is found automatically in `~/.local/opt`).

## Verification you must run and report

- Before you change anything, copy `tools/.cache/splatmap.png` to `tools/.cache/splatmap.before.png`
  if it exists; if it does not, run the build once first to make it, then copy.
- Write a small script under `tools/.cache/` (not committed) that, for the before and after splat
  PNGs, reports: (a) mean RGB weights; (b) "hard edge" count: neighbouring texel pairs whose
  gravel weight differs by more than 0.5, over the whole map. After must be far lower than before
  (report both numbers). Also save a 4x nearest-upscaled crop of columns 3158..3278, rows 2831..2951
  for before and after side by side as `tools/.cache/zigzag-crop.png`.
- `bun run typecheck`, `bun test`, `bun run build` must all pass. Report the test counts.

## Rules

- Work only in this git worktree (`/home/mirai/projects/sojourney/.claude/worktrees/beta`), on branch
  `terrain-zigzag`. Files you may change: `tools/ground_splat.py`, `src/engine/TerrainMaterial.ts`,
  `tests/terrainCinder.test.ts` (only if a test needs updating for the new tint code),
  `public/packs/crater-lake/ground/splatmap.ktx2`, `public/packs/crater-lake/files.json`. Nothing else.
- Do not start, stop or install services, servers or browsers. Do not run `bun install` or change
  package.json/bun.lock. `uv run --with ...` for Python packages is fine.
- Do not ask the user or me anything (do not use the question tool). If unsure, pick the obvious
  default, note it in your report, and continue.
- Bun only for JS tooling. Match the surrounding code: comment density, naming, the file's idioms.
- Commit when everything passes, with a clear message ending with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  ```
- If you have superpowers skills: use systematic-debugging on failures and
  verification-before-completion before reporting.

## Report

Files changed, the parameter values you chose, mean weights before/after, hard-edge counts
before/after, typecheck/test/build results, and the commit hash.
