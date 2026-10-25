# Sojourney v1 — issues blocking release

Every unresolved item here blocks shipping Sojourney v1 (project lead, 2026-10-02). v1 is still
being completed: substantial work is not automatically deferred to v2. Move work to `sojourney2.md`
only when the project lead directs it; that file is v2 notes, not the active backlog.

Found in the playtest of 2026-10-02: Babylon.js 9.29, WebGPU, 1276×591, SceneOptimizer held off
(`targetFps: 1`), everything on. Screenshots, videos and logs are in `tools/.cache/shots/playtest/` (not
committed); every shot's camera position is in `tools/.cache/shots/playtest/coords.md`.

## How this file is organized

The active work is grouped by **most likely root cause**, ordered by the smallest useful
change with the broadest expected impact. Confirmed causes and unproved hypotheses are distinguished.
Completed issues are removed from this list; their evidence and regression anchors are kept in
[the review ledger](docs/baselines/2026-10-06-issue-work-ledger.md).
The complete sequence, dependencies, implementation slices, decisions, evidence and release gates
are in [the v1 resolution plan](docs/plans/2026-10-06-v1-issue-resolution.md).

- **A. Open defects** — R1–R16 root-cause groups in first-slice priority order.
- **B. Fixed, awaiting sign-off** — built/measured work needing its named check or lead judgment.
- **C. Reviews** — Q1/Q4 start as R0, then follow findings through the relevant groups.
- **D. Test log** — existing evidence and coverage gaps.
- **E. Stale risks** — rechecks needed before old diagnoses or figures are trusted.

Status words inside a cluster: **OPEN** (to do), **OPEN remainder** (part fixed, specific work left),
**SIGN-OFF** (fixed, needs the lead's eyes),
**DECIDE** (explained; the lead picks), **TAKEN** (someone owns it, hands off).

The letter of each ID is the layer where the root cause sits: **E** engine (`src/`), **P** pipeline
(`tools/`, what builds the pack), **B** biome (the destination's own data and choices in `src/biomes/`
and the pack), **S** shipping (licences, credits and the download), **Q** a quality check. **U** means
the cause is not established, even if there is a guess. "Missing" marks something never built, as
opposed to built wrong. IDs are stable — commits and conversation refer to them, so they are never
renumbered, only moved between sections.

Work order rechecked 2026-10-06: R0 baselines/reviews continue through each slice.
Download feedback (S3), swim entry (U15) and tour weather (E20) are completed; their
records are in the review ledger. Play lighting is built and E12 object-depth lighting
is now integrated, with visual/backend acceptance in section B. The remaining open
queue starts with R6 transitions and R7 hidden-work culling (sky, whole-cell and per-record
vertical underwater flora submission repaired; lateral/play-flora coverage and acceptance remain); U16 extended backend
coverage is deferred by the lead until the remaining beauty and asset work is complete;
these are the smallest shared-system investigations before larger asset/gameplay work.
Start P5/P1 representative asset/cache pilots early. Dependencies and reproduced failures
precede estimated effort. R numbers label work groups, not stable issue IDs.

**Required execution workflow:** where a Babylon MCP tool exists for an operation, use it,
adapting the pipeline to its outputs or using MCP directly even if a local pipeline tool exists.
Browser testing uses Chrome DevTools MCP with fully headed Chrome/Chromium; headless is
acceptable when headed is unavailable, with the reason and renderer recorded. See the plan
and NME_NOTES.md for discovery, export, integration and runtime-verification requirements.

## A. Open defects, by likely root cause and first-slice priority

R1–R16 follow the smallest-change / largest-impact estimate after R0 (the opening Q1/Q4
review and baseline in section C). Larger follow-ons need the dependencies in the linked plan;
P1 starts alongside the first engine work. A shared test session does not prove a shared cause.

### R5. Backend setup: the failing draw and complete parity are unverified

The captured shadow-transition failure is repaired; other U16 triggers remain unverified.
The lead deferred U16 extended coverage until the remaining beauty and asset work is complete
(2026-10-06 playthrough). Keep E21/B4 sign-offs and the recorded Firefox/Safari lead go-ahead.

- ~~**U16. OPEN: WebGL: `GL_INVALID_OPERATION: Two textures of different types use the same sampler
  location`**~~ **DEFERRED: revisit after remaining beauty and asset work.** (project lead, console while boating 2026-10-05, on both `glDrawElements` and
  `glDrawElementsInstanced`). **Captured transition failure repaired 2026-10-06:** headed AMD
  WebGL2/MCP isolated a failing flora draw in `lakeMirror` (render pass 46), with GL error 0
  immediately before and 1282 after. At the day/night shadow change, Babylon's previous PBR
  shader still declares `shadowTexture0` as a comparison array sampler after the sun has stopped
  binding shadows. Its unit held a colour array with comparison disabled. Atmosphere sampler
  units were distinct; this capture does not implicate the terrain arrays. PBR materials now use
  Babylon's `allowShaderHotSwapping = false`, including streamed assets and clones: wait for the
  matching shader instead of drawing with obsolete bindings. Fresh shader variants reproduced
  the failure with hot swapping and passed without it; the integrated world passed over 114,000
  draws through day/night and render-target transitions. See the work ledger for evidence and the brief
  compilation-visibility tradeoff. **OPEN remainder:** repeat an extended WebGL voyage, natural
  sunset, optimizer transitions and submerged depth bands. The exact same-location message was
  captured earlier but not independently isolated here; do not assume every U16 trigger is closed.
  Linked to B4 and to Firefox below.

- **Firefox/Safari. OPEN: full gameplay and visual equivalence are not verified.** Full-game
  verification recorded here is Chromium WebGPU; the real-GPU Chromium WebGL2 terrain harness
  also passed. The game uses WebGPU where the browser offers it and WebGL 2 otherwise
  (`src/core/Engine.ts`), so in a Firefox without WebGPU it would run the GLSL halves of the
  shaders. Chromium WebGL2 terrain rendering was checked on 2026-10-06; full depth lighting,
  timed fades, instanced flora and submerged lake-bed appearance still need backend gameplay
  coverage. To check: that
  it starts in Firefox (156 is installed here), which of the two it runs on, and that the picture
  matches Chromium's. Safari is in the same position. Not to be picked up until the project lead
  says so: there is no browser tooling for Firefox here beyond scripting it by hand. First sighting
  (project lead, 2026-10-05, Firefox on WebGL 2 / Radeon): `drawElementsInstanced: Depth texture
  comparison requests (e.g. LINEAR) Filtering, but behavior is implementation-defined, and so on
  some systems will sometimes behave as NEAREST` (warns once). That is the cascaded shadow maps
  (`usePercentageCloserFiltering`, `QUALITY_HIGH` in `src/engine/environment/index.ts`) sampled with
  linear filtering: on some drivers the filter silently drops to nearest, so shadow edges may read
  slightly harder there and nowhere else. Warning only, no error; left as is unless the shadow look
  visibly diverges between backends.

### R6. LOD lifecycle: ownership and transitions differ across paths

Likely shared state/pass boundaries for U7/U13/U17; no common trigger is proven. U18 is a
per-leaf diagnostic branch, rechecked after P4 recovery, rather than a duplicate of U19. Capture
actual loaded/drawn levels, intervals, pass and scaling before assigning a fix.

- **U7. OPEN remainder: a pine 3 m away was drawn at `LOD1`, not `LOD0`** (shot 32).
  **2026-10-06 lifecycle repair:** an outward flora fade followed by reversal to 3 m could finish
  at LOD1 and stop sorting indefinitely while stationary. Completed fades now schedule a distance
  recheck before resting. Underwater mode changes also invalidate sorting and ignore obsolete
  fade goals. A production-sorter browser regression passes on real AMD WebGL2; see the ledger
  and `harness/floraTransitions.ts`. **2026-10-07 reentry repair:** cells handed to far lists or
  wholly hidden by rain/water now clear their near LOD/fade state. Returning to 3 m selects
  LOD0 immediately instead of resuming the old outward goal. Seventeen production-builder/sorter
  checks pass through Chrome DevTools MCP on AMD WebGL2; regression anchor:
  `harness/floraReentry.ts` and the review ledger. These establish wrong-LOD causes, not the exact original
  pine/teleport trigger. Recheck that pine on the rebuilt models; WebGPU and motion acceptance remain.

- **U13 remainder. OPEN: the timed level fade does not cover everything** (project lead, 2026-10-03:
  trees, rocks and terrain pop on change; "more noticeable than the fact that some far models look
  crappy up close"). Built 2026-10-03, to be judged in motion (section B): dithered cross-fade over
  half a second of wall-clock time (`FADE_MS`, `FADE_GAP`, `DitheredTileFadeMaterialPlugin`) for
  ground leaves, blocks and flora. **2026-10-07 lifecycle repair:** cancelling a ground fade on
  water entry now selects the current distance instead of its obsolete target after a reversal
  or jump. Seven production-selector/Babylon-bound checks pass through Chrome DevTools MCP on
  AMD WebGL2; regression anchor: `harness/groundTransitions.ts` and the review ledger.
  **2026-10-07 ownership repair:** full-file list rebuilds now publish pending middle-card
  changes in the same update. A production-builder regression reproduces duplicate ownership
  during asynchronous arrival plus travel; release could also leave a gap while middle uploads
  waited. Arrival batching at rest is retained. Regression anchor: `harness/floraOwnership.ts`
  and the review ledger. **2026-10-07 cell reentry repair:** obsolete near fades no longer
  survive far-list ownership or whole-cell hiding; continuously near fades/hysteresis remain
  intact (`harness/floraReentry.ts`, review ledger). These do not establish the reported popping's cause.
  **2026-10-07 ship/pier coverage:** placed ship and pier levels now use half-second
  complementary stock-plugin fades, with resting/reversal hysteresis, instant underwater
  selection and hidden reentry reset. Their prepared levels are included in the lake mirror.
  Twenty-two real shipped-GLB controller checks passed on AMD WebGL2, and every level's
  submaterial renders with the stock dither shader and GL error 0. Regression anchor:
  `harness/propTransitions.html`; evidence and limits in the review ledger.
  **2026-10-07 culling repair:** that slice had registered every prepared level as an
  LOD slave of a bare selector mesh, so Babylon lent the selector's empty bounds to
  the levels and each placed instance frustum-culled as a point — ship, piers and
  fire pits vanished unless their centre was on screen while mirror images and
  shadows still drew. Proven headless on Babylon 9.29 (a 30.37 m merged radius reads
  0.00 after addLODLevel; the instance copies the 0). Level selection is now a plain
  authored-distance comparison with no native chain, so instances keep their
  prepared bounds; a headless scene.render() keeps a 60 m level in the active set
  with its centre outside the frustum, and near/far selection is unchanged. The
  harness now also anchors every placed instance's radius to its source level (30
  shipped-GLB checks); typecheck, build and 35 Bun tests pass. Browser-harness
  rerun, motion/visual acceptance and backend parity remain. Not done: standalone shadow/SSAO passes still need
  coverage (both visible levels can cast during a fade); the campfire's separate LOD path
  still switches; and the forest still changes all at once at
  600 m, where a leaf's full file takes over from its middle-band cards.

- **U17. OPEN: a huge checkered board flashed mid-screen for a moment** (project lead, boating near
  Llao Rock 2026-10-05, Chrome). It read like the level cross-fade dither blown up large, then
  gone. Both the ground (`src/engine/groundStream.ts`) and the forest (`src/engine/flora.ts`) fade
  level switches through Babylon's `DitheredTileFadeMaterialPlugin` with per-instance intervals; a
  flash that size smells like a fade running with a stale or degenerate interval, possibly across a
  hardware-scaling resolution change from the optimizer. Not established; needs a repro with the
  fade state and scaling level captured. Linked to U13's fade and the optimizer rework (section E).

- **U20. OPEN: terrain looks quilted sometimes** (project lead, 2026-10-07).
  Lead follow-up: seems to occur from afternoon into evening and only at certain distances.
  Reproduce with matched viewpoints across those times and distance bands; the cause remains
  unestablished. Current-view screenshot: `tools/.cache/shots/terrain-quilted-2026-10-07/current-view.png`; camera,
  backend and scaling context: `view.json` in the same directory. This is a snapshot of the
  available world harness, not a confirmed capture of the reported quilted frame. Investigate
  leaf/block boundaries, material blending and LOD transitions; do not assume it is U17's
  brief checkerboard flash. Cross-check R10 terrain authoring if runtime ownership is correct. **2026-10-07 investigation:**
  lead-observed near-dock patches persisted with SSAO and sun shadows off. PNG compression is
  lossless; the shipped normal/AO uses UASTC KTX2. Regional streaming is built under S5, with
  no claim that slicing alone fixes these patches. A later orientation-like symptom disappeared
  after restarting the browser/dev server; stale state is plausible, not an established cause.
  Lead reported 5 FPS becoming 10–12 with optimizer, SSAO and sun shadows off; this remains an
  observation rather than a controlled Q1 before/after measurement.

- **U18. OPEN: one near foothill renders soft and melty while the walls immediately behind it read
  correctly** (project lead, boat-tour shot `tools/.cache/shots/boat-tour/00-boarded-cleetwood.jpeg`:
  the close slope on the right of frame looks smooth and out of relief, unlike the craggy walls
  directly behind it and the far shore). Scoped to that one slope only — the background in the same
  shot is fine, so this is not global fog, light or exposure. Closer should mean higher relief, so
  the suspects are per-leaf: the wrong ground level chosen there (a far 1 km block where a near leaf
  should be), missing normal/detail blend on that leaf, or the look-tuning camo/scree smoothing one
  patch too much. Caveat: the shot ran SwiftShader WebGL2 (GLSL halves, R5/U16), so recheck on the
  real GPU before concluding; re-shoot the same viewpoint under way and compare leaf vs block.
  **2026-10-06 update:** P4 recovered 1,165 missing near GLBs, so missing near data is a concrete
  failure mode to recheck here. The U19 material improvement and general travel smoke test do not
  establish that this exact foothill is fixed; capture its leaf ID, drawn LOD and normal blend.

### R7. Visibility: fully hidden work still reaches rendering passes

Missing culling coverage, with stale wording to reconcile first. world.ts already distance-culls
props in rain and water; do not add a duplicate culler. Measure the remaining sky/water/mirror
and depth-hidden contributions with the current optimizer. Coordinate Q1/Q4, not two reviews.

- **Q2 remainder. OPEN: rain-hidden water/sky layers and mirror ground proxy need coverage;
  recheck the already-implemented prop distance culling.** Current world.ts culls props, including
  the ship, by rain/water reach (also recorded under Q3 in section B). The older prop-missing
  description is stale; runtime correctness still needs its check. (The ground/forest half is
  complete; see the [archived regression anchors](docs/baselines/2026-10-06-issue-work-ledger.md#verified-issue-regression-anchors-archived-from-issuesmd): 439 ground
  meshes become 5, 86,000 tree/rock instances become 2,500, 12.5 fps becomes 24 aboard the ship at
  the dock in full rain, fogged sky and horizon unchanged, `tools/.cache/shots/q2-fog-cull/`.)

- **Q3 remainder. OPEN: lateral/play-flora visibility coverage and broader dive acceptance.**
  Sky/compositor submission and whole-cell flora depth culling are repaired (2026-10-07).
  Flora cells now carry conservative height bounds from all loaded authored LODs; cells wholly
  beyond the opaque water volume skip near/far/middle submission, with camera-travel margins.
  Water reach and fade mode use the current eye on entry/exit, removing stale-frame culling inputs.
  Headed AMD WebGL2 matched-pixel checks at 70 m with 5 m visibility remove 18 rock/plant
  instances and reduce 54 draws to 50 by day/night; nearby flora at 30 m remains drawn.
  The tested default 40 m visibility views preserve pixels but show no submission reduction.
  Props already have distance culling; no duplicate culler was added. **2026-10-07 follow-up:**
  per-record vertical bounds now skip depth-hidden placements within intersecting cells, across
  near/far/middle lists. Middle lists also rebuild for radius changes and vertical travel in clear air.
  At 50 m depth with 5 m visibility, matched day/night pixels remain identical: 18 instances become
  2 and 54 draws become 52 (the old whole-cell path retained 17 instances). Default-visibility
  sampled views still show no reduction. Eleven boundary/lifecycle checks cover compaction, scaled
  bounds, fade reset and restoration. **Remaining:** lateral-hidden records retained by conservative
  vertical bounds, separately drawn play flora, broader moving-prop/shadow/dive coverage and lead
  acceptance. No overall GPU-time gain is established. See the review ledger,
  `harness/underwaterFloraRecords.ts`, `harness/underwaterFlora.ts` and `harness/underwaterSky.ts`.

### R8. Ship transitions: local collision and fishing need a combined voyage

Verification first. P2 metadata/checker and U14 endpoint carrying already exist; remaining
failures and departure behavior require a shared under-way session. Ship appearance is R11.

- **P2. OPEN remainder: the ship's deck collision is rebuilt, with a few things left to walk**
  (2026-10-03). `ship_meta` in `tools/build_props.py` now measures the decks from the hull's own
  up-facing surfaces and writes a walk box for every run of deck, a rail just outboard of each box
  where it is the ship's side, a step at each break and an end rail where a deck stops (32 walk
  boxes and 55 blockers, was 13 and 29). `python3 tools/check_ship_deck.py` holds `props.json` to
  the hull and passes: 59.7 m² of deck, none without floor, no rail inside a deck, the bow closed.
  Tested in the game, docked at Cleetwood (ship's own frame, z forward): the three holes hold
  (dropping at z 6.9, z −4.5 and z −6.0 lands on deck; the quarterdeck, poop and forecastle hold at
  their own heights); crossing the waist stops 0.16 m from the visible rail both sides; the head
  platform stops at z 7.2 and the poop at z −8.95, still aboard. Still to walk by hand: the ladders
  (run and jump at each step), boarding over the gangway from each pier, and the ship under way
  (combine with U14's line-out sailing test). Left as they are, for the project lead to judge: decks
  under 1.0 m wide get no floor (`DECK_WIDTH`, so the forecastle's 0.2–0.5 m side ledges have none);
  the quarterdeck and poop are reached only by jumping the break ledges (the model has no ladder
  there); the poop's port rail has a 0.1 m gap at z −7.30 to −7.20; `mainDeckHeight` is now 1.84 (was
  1.65) and nothing in `src/` reads it; while docked the gangway is open on both sides by design
  (`src/engine/boat.ts`, `openRail`).

- **U14. OPEN: a line already out when the ship casts off was never tested** (project lead, watching
  a test on 2026-10-03: "Boat started moving in the middle of fishing ... We never tested 'is already
  fishing when the boat takes off'"). In that run the line was cast from the deck at the dock and a
  3.5 s hold of Enter did not bring it in; the ship then sailed with the line out, the state stayed
  "waiting", and a tap of Enter under way reeled it in. What the line, the bobber and a hooked fish
  should do when the ship leaves, and what they do now, is not established. Casting and reeling
  from the deck were checked the same day and work both docked and under way. Recheck with R8's
  under-way walk and R11's fishing readability.

### R9. Lake composition: reflection, illumination and finite-world edges

Separate causes within one controlled lake session: E3 resolution is known; U4 tint/seam and
U5 horizon are unknown; E11 direct glint and rim occlusion need distinct checks. Current world.ts
uses 100 m shadows (600 m is the environment fallback), and ground is not a shadow caster.

- **E3. OPEN: blocky, pale lake reflection near the shore.** The lake mirror is 512×512
  (`MIRROR_SIZE`, `src/engine/ground.ts:103`), so reflected trees are squares (shots 13, 33).
  Whether it also causes the pale tint is unknown — that half may belong to U4.

- **U4. OPEN: a hard pale line along the shoreline** where the walls meet the water (shots 13, 33).

- **E11. OPEN: the low sun's glint on the lake is a round ball, and it stays when the sun is behind
  the rim** (project lead, 2026-10-03: "something's very wrong with that reflection"; shot
  `tools/.cache/shots/light-pass/07-low-sun-and-reflection.jpeg`, summit of the cone, 19:36). The
  ball is the sun light's own highlight on the water (it goes with the lake material's
  `specularIntensity` at 0), spread by bloom to the size of the sun's glare, where real water shows
  a glitter path. At 20:03, with the sun behind the rim, the glint is still on the far shore. The
  original report cited 600 m shadows; current world.ts requests 100 m and terrain is not a caster, so
  increasing reach alone cannot put the far water in the rim's shadow. The wider bloom of
  pass 1 made the ball bigger. The mirror's own picture of the sun's disc is not the cause; it is
  drawn at a twelfth of the disc's brightness (`SunDisc.dimIn`).

- **U5. OPEN: a blue sea runs to the horizon past the map edge** at all four corners (shots 22, 24,
  26, 28). Not identified; there is no backdrop terrain beyond 9 km.

### R10. Asset fidelity: source detail, thinning, texture density and build inputs

P1 remains the highest-priority asset defect and starts in parallel after R0 and the cache/input
audit. Its geometry/bark and card-lighting branches are distinct. Current flora_models.py selects
source LOD2 and has separate trunk budgets: the original LOD1/whole-tree diagnosis below is
historical and must be reconciled against actual cached outputs. U19 has working authored relief;
finish its material/reference branch before denser geometry. B4/P3 sign-offs belong to this track.

- **P5. OPEN: run all assets through a relevant Babylon MCP — everything, all of it.**
  Project-lead request, 2026-10-06. Treat using the right Babylon authoring tool as one of the
  first performance investigations, following the lead's observed gains from earlier MCP work.
  Cover the entire shipped/generated asset inventory: terrain and lake bed, flora and cards,
  rocks, ship/piers/props, held and gameplay objects, textures/materials, sky/weather/particles,
  and every other asset category. Use the relevant Babylon MCP for supported inspection,
  authoring, processing, validation and export; integrate its outputs into Packsmith and the
  destination pack. This is a whole-asset pass, not limited to assets named by existing defects.
  Track every asset or reproducible family, its matching tool, inputs/exports and runtime checks.
  Record capability gaps explicitly when no relevant Babylon MCP operation exists; keep those
  assets in the inventory rather than silently skipping them or using an unrelated tool.
  Measure matched before/after frame cost, memory, draw/material/texture counts and pack size;
  preserve visual quality, commercial licensing/credits, authored LOD/mips and offline budgets.
  Record unexpected MCP behavior in the relevant NOTES file. Close only after the full
  inventory is accounted for and supported assets have passed through their relevant tools.
  Links: P1/U19 (existing asset work), Q1/Q4 (performance/rendering evidence), S2 (shipping audit).

- **P1. OPEN: the trees** (project lead: all tree problems are one defect, and fixing the pipeline
  is the remedy). The engine draws the ship with the same glTF loader and PBR material, and the
  ship looks right, because `tools/build_props.py` keeps its original mesh and its own 2048
  textures on their original UVs. `tools/flora_models.py` does not. Symptoms: (1) close-up trunks
  look painted, not like bark — near-black, flat-faceted, smeared, no relief (confirmed in game as
  `fir_b_LOD0`, 24,884 triangles, at (8965.75, −113.75, −8968.24), from 4.6 m and 2 m; shots 24, 25,
  29; the canopy from 2 m and 7 m below looks right, shots 30, 31); (2) sprigs float in the air —
  slivers above the rim's tree line (shot 20, camera 82, 286, −2956) and dark triangles above
  Cleetwood Cove (shot 32, camera 4700.3, 56.5, 4300.1), and the previews
  (`tools/.cache/previews/sheet_pine_*.png`) show the pines' `LOD1` (4,000 tris) and `LOD2` (450)
  are mostly sprigs and twigs with no branch to grow from, plus solid black triangles (the firs are
  mostly sound; placement is not at fault — none of 6.3M forest records is above the lidar ground);
  (3) cards facing the sun glow orange at low sun instead of standing dark against it (shot 05), and
  at sunset the whole wall below the Watchman is speckled with orange cards (shot 39); (4) trees on
  the caldera walls read as near-black dots (shots 03, 04). Causes, all in `tools/flora_models.py`:
  the best level starts from Poly Haven's LOD1 mesh (CREDITS.md) and the whole tree, foliage
  included, is cut to `TREE_TOTAL` (30,000 / 4,000 / 450), so the trunk has few sides; foliage is cut
  sprig by sprig, so lower levels keep sprigs whose branch was removed; bark is packed into one
  `ATLAS_CELL` (1024 px) cell of a 2048 atlas with the bark's whole UV range sampled into it
  (`sample_region(..., lo, hi, ATLAS_CELL)`, around line 170), leaving a few dozen pixels per bark
  repeat (likely; the UV range is not yet measured) — the bark normal and occlusion/roughness maps
  exist, their resolution is the problem; Crater Lake's trees are drawn at lidar heights up to ~2×
  the model (this fir is 1.94×) with no extra bark texture for trunks that tall; symptoms 3 and 4
  are cards and their cause is **not confirmed** — the card bake (baked normals, `CARD_DARKEN`) is
  the suspect. Remedy: build the near tree levels as props are built — the original full-detail
  trunk mesh (the `.blend` originals, hi-res trees idea) with its own repeating bark material at 2k
  or 4k and a strong normal map; branch-aware thinning for the middle levels; re-bake and check the
  cards. Check close up under low sun, and from the rim for slivers.

- **U6. OPEN: shrubs look pinkish** (shot 23). Recheck on the rebuilt models (P1).

- **U19. OPEN remainder: the NME relief pass is implemented; large cliff ledges and cliff/scree
  contrast still need to match the references** (2026-10-06). The original midday boat/Llao views
  looked soft despite SSAO and sun-shadow changes. Diagnosis: the source height grid and common
  250 m LOD0 leaves are about 2 m apart; the whole-map normal/AO bake is 2.2 m/texel. The filed
  octave check reports 2–4 m height RMS dropping from 6.775 m in the 1 m lidar to 0.545 m in the
  shipped grid (8% retained). These geometry/global-bake limits remain, but **the material now has
  a separate metre-scale relief contribution**, so the former claim that no such shading reaches
  the GPU is no longer current.

  - **Implemented B** (`1b91cc3`, direction correction `fd982dc`):
    `tools/build_terrain_relief.py` prepares a periodic 64 m tile from registered DS 716 lidar at
    (935,3800), removes its broad slope/boundary discontinuity and retains 2–16 m wavelengths.
    Babylon's NME HeightToNormalBlock bakes the normal offline; the game samples authored texture
    data. Micro-normal XY occupies RG and relief XY occupies BA of `rock_normal_relief.ktx2`, each
    at its own 8 m/64 m repeat scale. No additional terrain triangles or texture bindings. Both
    backend bakes and terrain materials render; known height ramps verify normal direction.
    Maximum unit-normal encoding error is 0.0065. Details and tool traps: `NME_NOTES.md`.
  - **Lead judgment:** approximately 65% better than before, with less melting. This approves the
    improvement, not final photo fidelity or a performance gain. The six `references/llao-rock/`
    photos show broader grey faces, deep vertical joints, sharp ledges and pale scree. Remaining:
    reduce the fine rippling on large faces and improve cliff/scree colour contrast; compare the
    large ledges from a corresponding viewpoint before deciding on geometry changes.
  - **Evidence/check to finish:** `tools/.cache/shots/u19-midday-relief/` contains material A/B
    captures and `nme-full-game-reference-view.png` (camera 0,20,1800, target 935,290,3800,
    1280×651 WebGPU). This south-west full-game view exposes the broader tabletop outline; the
    closer eastern fixed-LOD harness alone is insufficient to judge it against the photos.
    Weather/fog and optimizer decisions were disabled only for inspection, at the lead's request;
    roughly 10 fps at full quality is not a controlled before/after measurement. Final sign-off:
    the lead's midday boat ride and close-slope/reference comparison, plus a controlled frame-cost
    check. **B first; denser near meshes A only if B remains insufficient; authored crag meshes C
    stay dropped.** The 1 m height sampler remains authoring support, not production mesh input.
  - **Links:** U18 (specific foothill, R6), P4 (completed near-pack recovery, D), Q1 (frame cost,
    C), Q4 (shader/texture review, C), U13/U17 (fade coverage/flash, R6). Lighting reach is a
    separate unresolved part of the appearance diagnosis: the actual game passes a **100 m**
    shadow distance in `world.ts` (the environment's fallback is 600 m), ground receives but does
    not cast those shadows, and SSAO maxZ is 200 m. This pass did not extend those reaches.

### R11. Play appearance: placeholder forms and missing visible state feedback

E4/E9 geometry and E10 feedback are established omissions; U11 black fish is an unknown cause.
Judge after R3 lighting and reuse authored assets where appropriate. Babylon already handles
nonuniform-scale normal transforms, so the U11 normals suggestion is a hypothesis.

- **E4 (play part). OPEN, placeholder shapes.** Stumps and logs are plain cylinders made in
  `src/play/Chopping.ts`, and the logs are pole-thin next to the stump (`LOG_DIAMETER`). (Ship
  part: R11; voyage checks: R8.)

- **E4 (ship part). OPEN, placeholder shapes.** The ship's inner steps are untextured boxes made in
  code (`src/engine/boat.ts:89`).

- **E9. OPEN: cooking a fish looks wrong** (`cook()` in `src/play/Campfire.ts`, around line 262).
  The fish is a sphere squashed to 38 × 5 × 8 cm, hung flat over the fire instead of skewered on the
  stick, which passes it at a different angle (69, close-up). The stick shares the burning logs'
  material (`stick.material = fire.logMaterial`) and glows with them (66); that is fine as it is
  (project lead: a roasting stick gets hot), so keep it in any rework. The project lead: skewering
  the fish on the stick and turning them slowly over the fire, like a rotisserie, "would up the
  realism 100%". The fish also renders black under both materials (U11, below).

- **U11. OPEN: the cooking fish renders black** under both `StandardMaterial` and `PBRMaterial`, lit
  by the fire right below it (69). Possibly its normals, from a sphere scaled 0.38 × 0.05 × 0.08;
  not checked. Same object as E9 — fix together.

- **E10. OPEN: the fishing mini-game is hard to read** (recorded runs, 2026-10-02: video and a
  100 ms state log, as shipped and with `PBRMaterial`; contact sheets 70 and 71, videos
  `fish-standard.webm`, `fish-pbr.webm`; standing at (61.5, 2.2, 648.39) on Wizard Island's shore,
  yaw 30°, 11:00). Both runs play through: a 1 s wind-up casts 33 to 34 m; the bite comes 35 to 41 s
  later; the fight takes 16 to 22 s reeling from 34 m to 2 m with tension held between 0.45 and 0.84;
  trout of 29 and 41 cm landed. What the player sees:
  - The bobber (`src/play/Fishing.ts:43`, an 8 cm sphere) cannot be seen at casting range. As
    shipped it is invisible; with PBR it is a dark speck. For the 10 to 40 s wait the only sign of
    the bait is the line.
  - The bite is only text ("Fish on! Hold Enter to reel", with a ten-box tension bar). The ripple
    ring shows only once the fish is near (about 10 m).
  - The rod does not visibly bend under tension, and the reel glows white as shipped (E8).
  - Landing shows no fish and no splash: the catch is only the 4 s card ("Rainbow trout 29 cm").

### R12. Missing gameplay: dive guidance, breath/recovery and gathered fire stones

New systems, not regressions. Resolve the listed breath/scuba/day/recovery choices at
implementation time, then build on R2 and the rucksack. E13 retains medium priority and its
explicit six-stone/three-log recipe; no invented capacity or drowning penalty.

- **E14. OPEN, Missing: breath under water** (project lead, 2026-10-03). A swimmer under water should
  have a breathing bar; when it runs out the player drowns and comes back at the nearest dock. With
  scuba gear in the rucksack they can stay under for up to 30 minutes a day before the bar starts.
  Why: it is very easy to get completely lost under water, and the places on T (then on H) are a
  debugging aid, not part of the game, so the player needs a way back that is. Not started. (E15
  rest behavior was settled 2026-10-06: idle swimmers sink under gravity/drag; active upward
  strokes surface them. Breath/scuba/recovery remain undecided and unimplemented.)

- **E22. OPEN, Missing: dive narration and depth-band guidance** (project lead, 2026-10-06).
  Add narration during dives, potentially a voice accompanied by text, explaining the player's
  current depth and what they are seeing as they cross underwater bands. Use the destination's
  actual authored bands and visible features. For later work: settle the band boundaries, script,
  voice/text presentation and repeat behavior on ascent or repeated crossings; coordinate with
  E14's underwater HUD and the existing narrator/audio system. Not started.

- **E13. OPEN, Missing: the stones of a campfire come from nowhere** (a playtester asked where the
  rocks come from; project lead, 2026-10-03). Stones should be gathered with bare hands, no tool,
  and carried in the rucksack, and laying a fire should take 6 stones and 3 logs. Medium priority;
  not started, by the project lead's instruction.

### R13. Atmospheric presentation: missing effects and outstanding choices

Use the existing light/weather pass as the base and obtain its section-B judgments. Sun shafts
need a known occluded-sun view and measured Babylon effect; upward rain remains DECIDE.

- **Missing, OPEN: sun shafts.** Tried 2026-10-03 with Babylon's
  `VolumetricLightScatteringPostProcess` on the sun's disc and taken out again: it ran, but no rays
  showed from the cone's summit, the Witches Cauldron or Wizard Island's shore at its default
  settings, and it cost ~1 fps of 12. It needs tuning in a view with the sun behind near trees. What
  it needs: `{ postProcessRatio: 1, passRatio: 0.5 }` (a bare ratio halves the whole frame),
  `useCustomMeshPosition` with the sun's position each frame (the disc is placed by its shader), and
  the sky layers and `skyProxy` in `excludedMeshes`.

- **U2 (drops part). DECIDE: in rain, looking straight up shows no drops and no clouds.**
  Explained, not changed. Each drop is a billboard stretched along its fall
  (`BILLBOARDMODE_STRETCHED`, `src/engine/environment/Rain.ts`), 1–1.5 cm wide, so seen end-on it
  is a dot smaller than a pixel. The sky overhead is the rain veil (`Fog.ts`), which is opaque at
  150 m visibility by design. For the project lead to decide whether drops should be seen coming at
  the camera.

### R14. Depth precision: the local skirt fix is not a general solution

An open general risk, separate from LOD fade state. Keep U12 visual sign-off and the proved
skirt fix; establish other failures before choosing compatible Babylon large-world/depth APIs.
Do not build a custom floating-origin system.

- **U12 follow-up. OPEN risk: the skirt-depth fix holds, but the general cure is not done.**
  Babylon's reverse depth buffer would give the precision outright, but the Atmosphere addon draws
  the sky at a fixed far depth and the sky came out black with it on. The same coarse depth can
  still make other close pairs flicker far off (tree cards against the ground behind them); Babylon
  provides built-in large-world/floating-origin support; compare its compatibility and near/far-plane
  options against a measured precision repro rather than implementing an origin system ourselves.
  (The ridge-top flicker itself is fixed, section B.)

### R15. Shipping completeness: inventory/provenance and owned sound sourcing

Start S2 inventory early to avoid rebuilding unsuitable assets; finish against the final pack
and production distribution. B1 stays TAKEN by the lead. Existing lakeBed/relief credits and
observed audio playback are partial evidence, not closure.

- **S5. OPEN: Cloudflare delivery needs real zstd-22 shared and biome packs.** Project-lead
  direction, 2026-10-06: at most 20,000 deployed files, none over 25 MB; split shared assets from
  biome-specific assets such as terrain. Build deterministic content-addressed archives with
  independently decodable chunks, bounded unpacking and a commercially compatible browser
  decoder. Integrate PackLoader/SW virtual asset URLs, range audio, retries and S3/S4 progress/
  versioning; stage archives without loose source assets. Apply the gate to the entire app,
  including WASM/model dependencies. Current dist: 5,816 files, six over 25 MB; source pack ~789 MB.
  `tools/check_cloudflare.py` now detects deployment violations, but packaging is not built.
  Chrome 154's DecompressionStream rejects zstd (checked through Chrome DevTools MCP).
  Implementation and acceptance: [pack/storage preparation](docs/specs/2026-10-06-cloudflare-packs-and-storage.md).
  **2026-10-07 regional normal/AO slice built:** the 75.6 MB whole-map texture is replaced
  by 81 registered crops on existing 2 km boundaries plus a 5.1 MB distant map. Near leaves
  request/release their crop with their geometry; Babylon shares regional GPU resources by URL.
  Original 2.197 m density is retained. Common encoded borders match through mip 4; full
  authored mip chains remain. Final normal/AO download is 100.5 MB (padding increases bytes),
  with about 19.6 MB of BC7 data resident at the tested Cleetwood view versus 89.5 MB for
  the original whole map. See the review ledger for checks and the WebGPU adapter gap.
  The final deployment has 5,897 files and five oversized files; the terrain texture is no
  longer one of them. Archive packaging/storage and remaining oversized assets are still open;
  archive chunking alone does not reduce texture residency.
  Coordinate P5/Q1/Q4 asset work and S2 credits; compression gains require measurement.

- **S6. OPEN: the service worker must manage storage against the device's available quota.**
  Project-lead clarification, 2026-10-06: query the device and manage its cap; do not impose
  a fixed 500 MB quota. Use StorageManager estimates with headroom and actual write-error
  handling. Persist compressed packs once, not archives plus extracted copies. Reserve space
  across tabs/writes, evict stale/inactive biome chunks, retain referenced shared/active content,
  and recover from quota errors or browser eviction. Include voice/model/app caches and update
  overlap in accounting; never trust a completion marker after content disappears. Verify
  switching, partial installs, offline/restart, races and constrained quota through Chrome
  DevTools MCP. The current SW has no such management. Linked design: S5 above.

- **S2. OPEN (verify first): `CREDITS.md` does not match what ships.** It credits the old paths
  (`models/trees/…`, `models/rocks/…`, `terrain/…`) and the old impostor bake, and the filed issue
  lists no rows for what loads now: `flora/fir.glb`, `pine.glb`, `shrub.glb`, `seaweed.glb`, the
  rock GLBs in `flora/`, and the ground textures in `ground/*_albedo|normal|ao.ktx2`. Possibly
  partly stale: `CREDITS.md` has since gained rows for the tree/rock/terrain sources and the lakeBed
  texture arrays — recheck which of the listed paths are still wrong before rewriting. Comes last
  anyway, because P1 changes what ships. The U19 normal and packed rock/relief map were credited
  on 2026-10-06 (public-domain DS 716 plus CC0 Dark Rock 02); this does not close the full audit.

- **B1. TAKEN remainder: soundscape.** **Taken by the project lead** (2026-10-02), who is sourcing
  the sound pack; not for anyone else to pick up. The former empty-`ambientAudio` report is no
  longer current: `src/biomes/crater-lake/index.ts` supplies birds/water, outside ambience,
  night rain, streamed lake surf and underwater loops, plus ground/wood footsteps, fishing,
  rain-on-fire, thunder, ship bell and recorded guide. Arrival log (2026-10-03):
  `docs/baselines/2026-10-03-b1-soundscape.md`. Ocean/surf, bell and guide playback were observed
  on 2026-10-06; this is a playback check, not final soundscape sign-off. The sourcing remainder
   recorded by the lead is rim wind, jay/nutcracker calls and daytime rain. Dry-fire crackle remains
  procedural (`Crackle`, `src/play/sounds.ts`).

### R16. Player feedback: in-game bug-report mode with log, capture and GitHub filing

New system, not a regression (project lead request, 2026-10-07 brainstorm). There is no
feedback/bug-report mode: `P` takes a photo and `V` records canvas video
(`src/core/Screenshot.ts`, Babylon `VideoRecorder`, no HUD in video), console output is
scattered `warn`/`error` with no central logger, and nothing files a report. Play sessions
run IRL days long, so unbounded logs/videos are not shippable; clips must be timestamped
to match the log.

- **E24. OPEN, Missing: feedback/bug-report mode ending in GitHub via a Cloudflare Worker.**
  Settings gets a "Report a problem" button (where players hunt for fixes). DOM modal matching
  `DestinationScreen`/`SoundCheckScreen`, not Babylon GUI: short form (what happened, what was
  expected, category), then a capture offer (record video / take screenshot / skip and send).
  The choice returns play immediately with a small HUD badge while armed/recording; a thank-you
  card confirms Worker acceptance. Reuse the existing `P`/`V` + `VideoRecorder` paths.
  Auto-attach as much system detail as can be gathered (`report.json`: app/pack versions,
  backend, GPU/driver, canvas size, scaling, settings, camera/position, game time/weather,
  optimizer state) with no personal data. Central logger wraps `console` with one shared clock
  per entry (wall ISO + `performance.now()` + game clock + frame); ship a bounded ring slice
  (starting point for tuning: last ~15 min or ~2,000 entries, capped bytes) plus a session
  manifest, never the whole session. Bounded clip (starting point: 30–60 s max `.webm`,
  against the known `VideoRecorder` memory-explosion risk) and full-res PNG with optional HUD;
  filenames and log rows carry the same `reportT0` so a video second maps to log rows. Game
  POSTs one bundle to a project Worker (with the S5/S6 Cloudflare work, not in the client);
  the Worker holds the GitHub PAT as a secret, validates/rate-limits, stores overflow in R2,
  and files the issue via `POST /repos/{owner}/{repo}/issues` with the summary inline and R2
  links past GitHub's attachment caps (10 MB images, 10/100 MB video, 25 MB other). Lead
  decision 2026-10-07: Worker relay only (approach C) — no direct-client PAT and no manual
  download-bundle fallback; a failed POST surfaces in-game rather than silently degrading.
  Settle exact log minutes/entry caps and clip length against measured repro sizes at
  implementation time. Flow mockup: `.superpowers/brainstorm/25544-1791393375/content/feedback-flow.html`
  (uncommitted companion artifact).

## B. Fixed, awaiting sign-off

### R3: play-object lighting

- **E23. Built 2026-10-07, SIGN-OFF: wider, softer flashlight.**
  The cone is now 0.9381 rad instead of 0.4 rad: 2.5 times the geometric width at
  matched distance. After the lead found the wider beam washed out, intensity is reduced
  40% to 480 on land / 180 underwater. Chrome DevTools MCP on AMD WebGL2 measures
  2.28–2.33 times the half-brightness footprint at the reduced output on a matte panel
  10 m away; peak pixels fall from 108/69 to 85/55 versus original output. Matched production
  night views on land and at the deepest travel point (eye -591.1 m, bed -593.132 m)
  show the wider, lower-output coverage. Close-range highlights remain bright; lead judgment
  of width/brightness and usefulness at depth is still required. Regression anchor:
  `harness/flashlight.ts`; evidence and backend limits are in the review ledger.

- **E8. Built 2026-10-06:** held tools, chopped stumps/logs, campfire logs, cooking fish and
  bobber now use stock atmosphere-lit PBRMaterial with roughness/metalness. They receive/cast
  sun shadows; disposed play meshes leave the shadow list. Campfire log emission compensates
  scene exposure, and the near point light excludes those logs. The ripple remains an unlit
  effect. The lead requested a real NME PBR pilot with manual atmosphere wiring; its graph
  is exported and its constructor establishes defaults. Automatic addon attachment is limited
  to stock PBR, but manual integration is being tested rather than ruled out. Findings are in
  NME_NOTES.md. Noon/sunset tools, shaded wood and night fire checks remain.
  Placeholder geometry (E4/E9), black-fish diagnosis (U11) and submerged attenuation (E12)
  retain their own scope; the PBR migration does not claim to close them.



### R2: swimming and underwater behavior

- **Underwater behaviour, fixed 2026-10-03:** E15, the swimmer swims (stroke's pace 1.2 m/s,
  `STROKE_SPEED`; head rides the water with swell and stroke dip; going in puts away whatever is
  held — flashlight only until out). Updated 2026-10-06 after the lead reproduced the problem:
  forward swimming now follows view pitch, and gravity with water drag replaces passive
  resurfacing; Space swims up and C dives. Idle sinking is the lead's settled rest behavior. E16, H hides
  the HUD/reticle/panels and T travels between places (was: H teleported); E17, lake-surface
  underside no longer a white sheet at night (emissive ripples now dim with daylight and depth,
  `src/engine/underwater.ts`); E18, no dithered cross-fade under water (ground and plants switch at
  once; timed fade unchanged above) and a lit flashlight hides its icon (`Play.ts`).

### R3: underwater lighting

- **E12. Built, awaiting visual sign-off: lake bed and submerged PBR objects dim with depth.** The ground shader dims
  sun, moon and sky light by water depth over each bed point (`daylightLeft`,
  `src/engine/TerrainMaterial.ts`) and the water's glow by the diver's depth
  (`src/engine/underwater.ts`): 1/e every 40 m (`DAYLIGHT_DEPTH_METRES`, `src/engine/lake.ts`) —
  half at 28 m, 3% at 140 m where the moss ends, none on the deep floor (the real lake's figure is
  nearer 22 m; stretched because an eye adapts and the camera does not). Spot/point lights (the
  flashlight) are not dimmed; caustics fade over the top metres. The ground plugin runs after
  Babylon's atmosphere plugin, which had overwritten the dimming at the same hook. Sign-off is the
  dive with daylight and the night flashlight; object integration is described below.

  **2026-10-06 object integration:** trees, rocks, plants, props and play materials now
  share the bed's per-fragment exponential daylight falloff and the existing lake mask.
  Directional/hemispheric light and sky reflections dim; point/spot lamps and emission
  retain their strength. Surface-crossing objects use world-fragment height; dry low land
  stays lit. The existing terrain contract and water surface are excluded from duplicate
  attenuation. Streamed materials and play clones inherit the plugin. Real AMD WebGL2
  and WebGPU rendered-pixel checks pass at the surface, 30 m and 140 m, including dry-land,
  emission/lamp, clone and surface-crossing cases. See the latest review-ledger entry.
  **Remaining:** lead dive/flashlight visual sign-off and extended R5 voyage coverage.

### R5: moon/backend appearance

- **E21. Fixed, SIGN-OFF: the moon's hand-written WGSL shader failed the derivative-uniformity
  check** (2026-10-06, `cc1c317`). `Moon.ts` now loads the committed NME graph
  `moonMaterial.json`; its texture sample is unconditional at explicit LOD 0, avoiding the old
  per-fragment disc branch around `textureSample`. The same graph generates GLSL and WGSL.
  Full-game WebGPU startup/travel now produces no captured console error. Sign-off remains a
  night view of the disc, phases, halo and size on both backends; the midday terrain checks are
  not that test. Linked to Q4 and R5. No broader night-sky rewrite is claimed.

### R6: transitions in motion

- **U13. Built 2026-10-03: level cross-fades run on time, not distance.** Babylon 9.29's
  `DitheredTileFadeMaterialPlugin`: each mesh/thin instance draws in its own interval of a
  screen-fixed 8×8 Bayer pattern; complementary intervals show exactly one level per pixel. A switch
  at its distance starts a fade over half a second of wall-clock time (`FADE_MS`) and finishes; at
  rest everything draws at exactly one level, no dither anywhere. Outward at the switch distance,
  inward 5% below it (`FADE_GAP`); a begun fade plays out; jumps fade straight across. Ground
  (`groundStream.ts` chooses levels itself; 1 km blocks fade over leaves the same way) and flora
  (`sortNear` puts records in both levels inside the band, re-sorts on 0.25 m of travel, rests
  otherwise). Sign-off: judge in motion. Remainder stays OPEN (R6): shadow pass still switches,
  props still switch, the 600 m handover (cards to full file) still changes all at once.

### R7: underwater visibility and cost

- **Q3. Fixed 2026-10-03: under water, only what the water lets through is drawn.** The water fogs
  as the rain does, with its own reach (61 m at the default 40 m visibility; `Underwater.reach`);
  ground, forest and props (ship, piers — in rain too, which Q2 had left undone) skip what lies past
  it; their collision stays. From below, the lake's top face, its mirror and the surface underside
  past the reach are not drawn; the sun's shadow maps are not redrawn where under a thousandth of
  daylight is left on anything in view (deeper than ~340 m). Measured at the deepest point (4950,
  1705, 593 m down, east basin): 22 fps becomes 48, hundreds of meshes become 6 (two ground leaves,
  water, sky); a 30 m dive off Cleetwood Cove runs 31 fps where the pier above runs 10. Sign-off is
  the dive; remainder stays OPEN (R7): trees/props hidden only by water depth, not distance,
  still drawn. **2026-10-07:** the sky submission remainder is repaired; matched underwater
  pixel and resurfacing evidence is in the review ledger. Whole-cell and per-record vertical
  depth-hidden flora are now culled too; lateral/play-flora coverage and the lead's dive sign-off
  remain (see Q3 above). The earlier frame figures are not revalidated.

### R10: authored bed and rock coverage

- **B4. Built 2026-10-03: the lake bed changes with depth.** `tools/build_ground.py --bed` packs
  five bands at 1k into two KTX2 texture arrays (albedo, normals), blended by depth with
  noise-roughened boundaries, basalt on steep walls whatever the depth, rust-gold mats growing
  commoner toward the deepest basins (sand ~25 m, moss ~140 m, sediment ~260 m, basalt below).
  Sources, all CC0 Poly Haven: `aerial_beach_01` (keep), `forest_leaves_02` (moss),
  `brown_mud` (sediment), `dark_rock_02` (basalt), `red_dirt_mud_01` (mats); one texture array, not
  eight more textures. Count the complete compiled material, including atmosphere and engine
  bindings; 16 is the default WebGPU allowance, not this GPU's ceiling (48 supported and requested
  through Babylon in `Engine.ts`; `NME_NOTES.md`). Seen on a night descent with the
  flashlight (`tools/.cache/shots/deep-floor/27-night-descent-27m-to-294m.webm`) and at the deepest
  point (shot 25): sediment reads as grey rippled mud, the deep floor as fractured dark rock under
  rust-gold gravelly mat. Sign-off, two points: the moss band reads as yellow straw under the lamp,
  not green moss — `forest_leaves_02` may be the wrong pick; and submerged depth-band appearance
  still needs a WebGL check. The above-water GLSL terrain harness passed on 2026-10-06, but that
  does not judge moss or the underwater bands (links to U16/R5).

- **P3. Fixed in the pipeline 2026-10-03: rock patches lie on the ground.** Each patch is laid on a
  plane fitted to the ground under its whole footprint and tilted to it, dropped where the ground
  bends away by more than 0.25 m (`fit_patch_ground`, `tools/build_forest.py`).
  `tools/check_rock_patches.py`: before, 8,517 of 177,114 patches stood >0.25 m up (worst 43 m, on
  a cliff edge); after, none of 134,050 stands above ground at all. Sign-off, two points: look at it
  in the game (sections before/after in `tools/.cache/shots/rock-patches/`); 24% of patches were
  dropped, so check no slope looks bare. (Was project-lead report "the dead body looking thing" at
  (7.4, 230.4, −25.8) on the cone's shoulder.)

### R13: sky, weather and anti-banding

- **Sky and light pass, fixed 2026-10-03, for the lead to judge** (after-shots in
  `tools/.cache/shots/light-pass/`, cone summit 20, 234.1, −40, facing the Watchman unless noted):
  E1, mist thickened (`MIST_VISIBILITY` 6000, was 15000; wall 2 km veiled at 06:30, shot 04; thickens
  evening mist too; plus atmospheric haze `aerialPerspectiveIntensity: 1.4`, shot 05); E2/U3,
  overcast closed (cloud cover 1, sun dimmed by cover squared to a tenth, grey light back through
  sky irradiance, shot 02); U2 (veil part), rain veil and fog take the clouds' grey sky light (shot
  03); U1, midday sun disc 480× a sunlit white surface (was 40×) with bloom kernel 128 (shot 01),
  warm glare at low sun; U9, optimizer keeps tone mapping while switching off bloom/sharpening/AA
  (`src/engine/Optimizer.ts`) — recheck against the optimizer rework (section E). Also storms, for
  the lead to judge: "storm" weather is a downpour (rain 1.4) with lightning, one day's main rain
  spell in five (`src/sky/Weather.ts`, `src/engine/environment/Lightning.ts`) — jagged forked bolts
  400 m to 6 km off, GreasedLine over the rain veil, glowing through bloom, flash added to the sky
  light (shot 09 at night), thunder after the sound's travel time. To judge: flash brightness, most
  of all at night (`LIGHTNING_SKYLIGHT`, `LIGHTNING_NIGHT_POWER`), strike rate (`STRIKE_GAP`), bolt
  width and reach. And evening mist (shots 39, 40, 20:24, sun 2.1°): walls dark against sunset, far
  east shore fading into haze, far wall no longer lighter than the sky.

- **E19. Fixed 2026-10-05: the clear midday sky bands instead of grading smoothly.** The sky is the
  Atmosphere addon's smooth HDR gradient tone-mapped by the pipeline; Babylon's image-processing
  dithering, the engine's documented anti-banding tool, defaults to off and was never enabled, so
  the latent steps showed — sharpened by the beauty hold's full resolution, sharpening and MSAA 4 at
  the zenith where the gradient is shallowest (boat tour at Llao Rock,
  `tools/.cache/shots/sojourney_2026-10-05_20-07-00.png`
  with 1,276 unique sky colours against 16,109 in the smooth `...12-57-55.png`). Fix (Babylon-first):
  `pipeline.imageProcessing.ditheringEnabled = true` where tone mapping is set up in
  `createEnvironment` (`src/engine/environment/index.ts`), default 1/255 intensity, left out of the
  optimizer's bloom/sharpen/AA step like tone mapping so it stays on through downgrades.
  Sign-off: re-shoot the same zenith viewpoint, time and weather on the real GPU and check the
  gradient is smooth, at no measurable frame cost.

### R14: skirt precision on the boat ride

- **U12. Fixed 2026-10-03: the near ground no longer flickers along ridge tops.** It was a ground
  skirt showing through the slope in front of it (far block edge skirt, 25 m deep at the median,
  2.7 m behind the nearer leaf, 1,270 m from the eye — the depth buffer could not order them; 32-bit
  floats from world coordinates thousands of metres out, near plane 0.1 m). The pack marks skirt
  vertices (`tools/ground_mesh.py`) and the ground material draws them a metre plus a twentieth of
  their distance farther back in depth (`skirtBack`, `src/engine/TerrainMaterial.ts`); a real crack
  still fills. Checked: twelve consecutive frames steady; no holes from ship, rim or cone; WebGL 2
  shader compiles. Sign-off: confirm on the boat ride (the lead's video showed it). The far-ground
  blocks were not the cause (it flickers with them off) but added more such edges. General cure not
  done (R14).

## C. Reviews

R0 starts here: establish current evidence first, then complete each review through its findings
and the final completed-pack measurement. See the linked plan for the audit ledger and coverage.

- **Q1. OPEN: code efficiency review** (project lead, 2026-10-02). Go over the engine (`src/`) and
  the pipeline (`tools/`) for wasted work that can be refactored out, and for faster code paths.
  Examples: buffers copied where a view or transfer would do (typed-array views, transferable
  `ArrayBuffer`s between workers, pack data to the GPU without an intermediate copy); nested loops
  and repeated scans; work done every frame that could be done once or only on change; allocations
  in per-frame code that feed the garbage collector. Measure before and after, keep only changes
  that show a gain. Must not change what is drawn (rule 3: target FPS is the only trade of quality
  for speed) and must not replace a Babylon feature with our own (rule 1). Baseline figures
  (2026-10-03): `docs/baselines/2026-10-03-q1-measurements.md` — 107 ms frame split (~24 ms draw
  commands, 7.6 ms view choice, 5.6 ms mirror/shadow; own callbacks ~3 ms); GPU costs by switching
  off (trees 57 ms, shadows 40, half-res 40, near models 31, far cards 19, ground 17, AA 10, mid
  cards 5, bloom 3, sharpening <1). Done under Q1: far ground in 1 km blocks (rim draws 484 → 148,
  ground 27 ms → under 11 ms, same view); full-res fps unchanged at 8.9 (card-limited); far
  instances past 600 m cast no shadow (card 108 → 105.7 ms); splat map as KTX2 (saves VRAM, not
  frame time). Measured, not built: quadrant-split per-instance culling (~4.7 ms), recorded-draw
  replay (v2), near-leaf blocks. STALE RISK: re-measure — optimizer rework, look tuning (section E).
- **Q4. OPEN, partial findings recorded: shader and rendering review** (project lead,
  2026-10-03). A complete review of all shader and rendering code to make sure it is optimal:
  best techniques and practices
  to drive the hardware correctly and get all the performance out of available compute and video
  memory. Covers the material plugins and their GLSL and WGSL (`TerrainMaterial.ts`, sky, fog,
  clouds, water), shadow cascades, lake mirror and other render targets, post-processing pipeline,
  texture formats/sizes/counts per material, instance and level submission. (Plans exist:
  `docs` rendering-performance audit/pass notes, 2026-10-04/05.) Overlaps Q1's done items and R6/R7/R14 —
  coordinate, don't duplicate. Findings recorded 2026-10-06: E21 moon NME conversion, U19 offline
  normal authoring/packing and checked normal direction, real-GPU GLSL/WGSL terrain rendering,
  and the adapter/device-limit distinction in `NME_NOTES.md`. The complete rendering/performance
  review remains open; no overall speedup or universal 16-texture ceiling is established.

## D. Test log

### 2026-10-06 — NME relief, pack recovery and reference inspection

- Production build and application/harness type checks pass. **26 Bun tests pass**, including the
  same-size pack-cache regression. Graph validation is structural; the rendering checks below
  are separate evidence.
- On real AMD/RADV hardware with Babylon 9.29.0, the normal bake and terrain material render in
  Chromium WebGL2 and WebGPU. WebGL compilation error is empty and GL error is 0; a WebGPU
  validation scope returns null. Known X/Z height ramps produce the expected normal directions
  in both backends; maximum 8-bit unit-normal error is 0.0065.
- The full WebGPU game downloaded the complete 5,105-file pack and completed travel through the
  ship, Wizard Island and Llao Rock with no captured console errors. All 1,311 near GLB headers
  are valid and no indexed file is missing (P4). Ocean, bell and recorded-guide playback were
  observed; B1's remaining sound sourcing is not signed off by this check.
- Lead visual assessment of the terrain change: approximately 65% better, less melty (U19).
  Six Llao references were inspected; clear/full-quality south-west evidence and controlled
  fixed-LOD material A/B captures are under `tools/.cache/shots/u19-midday-relief/`.
- **Still unchecked:** U18's exact Cleetwood foothill after recovery, U13/U17 fade intervals and
  flashes in motion, full WebGL gameplay/instancing and underwater bands, the updated moon at
  night on both backends, and Firefox/Safari. No controlled frame-time improvement was measured;
  the roughly 10 fps full-quality reference capture is a snapshot, not a Q1 result. Clearing
  weather for inspection does not implement E20's automatic beauty-stop weather behaviour.

### Earlier coverage (2026-10-02/03; recheck the risks in F)

Checked and working: no swimming on dry land below lake level (west flank, 228 m below the lake);
the night sky (moon, halo, stars, Milky Way, moon path); H to the moving ship; fishing from the
moving deck; no fire offered on deck; chopping on Wizard Island, the west flank, the rim and above
Cleetwood Cove; laying and lighting a fire; the Cleetwood pier well lit at 13:00; no precision
shimmer at the map corners. Underwater covered to the swimmer's eye and past it (deep-floor dive);
night rain was not covered.

Not yet checked: nothing else from the original list, but the world has moved on — recheck section
E's areas (optimizer behaviour, weather patterns, SSAO/LOD/camo look, framegraph reverts) before
relying on old shots. Firefox/Safari: see R5.

## E. Stale risks — feature work since 2026-10-03 that moved ground under issues

Do not edit the issues above to match this section; recheck the issue and then edit it. Newest first.

- **Root-cause planning/source audit (2026-10-06):** current flora authoring chooses source
  LOD2 and separate trunk budgets; existence-only dumps and incomplete card-bake keys can reuse
  stale outputs. Ground rebuilds must preserve basaltUrl and refresh packed relief after micro-normal
  changes. Q2 props already have distance culling; actual sun-shadow range is 100 m with no
  terrain casters. Reconcile these facts in the targeted rechecks; no visual/performance closure
  is supplied by source inspection. Browser/MCP requirements and the full execution order are
  in the new v1 resolution plan.

- **NME terrain relief and completed near pack (2026-10-06):** U19 now has an authored normal
  contribution; the 2 m geometry/global-bake floors are no longer a complete description of its
  shading. P4 restored 1,165 missing near files without changing the raw mesh topology. Recheck
  U18 at its exact leaf and U13/U17 during real LOD transitions; remeasure Q1/Q4 against the full
  pack. New relief credits cover those assets only; S2 remains a complete shipping audit.
- **Backend/limit findings (2026-10-06):** the GLSL terrain harness passed, superseding claims
  that it has never rendered; underwater/instancing/Firefox/Safari still need their own checks.
  Default device allowances differ from adapter limits: this GPU supports 48 sampled textures
  per stage, requested by `setMaximumLimits: true` in the game. Do not reason from a universal
  16-texture ceiling or hardcode 48 for other adapters. File shader findings under Q4.
- **Pack-cache versions (2026-10-06):** S4 changed the version calculation to include contents.
  Texture/mesh edits of equal byte size now produce a new version. After authoring new pack files,
  restart the dev server so its unwatched public-file index serves them instead of 200 HTML;
  otherwise KTX/GLB errors can be misleading (workflow recorded in `NME_NOTES.md`).

- **E19 evidence location rechecked 2026-10-06:** the screenshot is already under
  `tools/.cache/shots/sojourney_2026-10-05_20-07-00.png`, not the repo root; the move task is done.
  E19's zenith re-shoot/sign-off still remains. Cached evidence, build output (`dist/`) and
  `node_modules/` stay uncommitted.
- **Optimizer reworked** (commits 2026-10-04/05: 10 s cadence, tenth-step haze eased over 20 s,
  haze-first degradation rungs, travel-vs-beauty from camera motion, stopped-boat full-beauty hold,
  travel downgrade floor 90%). Affects: U9 (tone mapping kept while post off — verify the new rungs
  still keep it), E19 (rests on `restoreAll`/beauty-hold paths — verified present 2026-10-05, but
  re-shoot against current behaviour), U13/U17 (fades vs hardware-scaling changes from the
  optimizer), Q1/Q2/Q3 figures (re-measure; the "12.5 → 24 fps" and "22 → 48 fps" figures predate
  the rework).
- **Look tuning** (2026-10-04/05: SSAO2 settings, zoom-aware LOD, ground-variation camo, cliff
  palette/strata/scree, POI rock invert, mottling removal). Affects: P1 symptoms 3–4 and U6 (cards
  and shrubs were judged pre-tuning — re-judge), Q1's ground/tree GPU split.
- **Weather patterns** (`3a28dd8`: biome weather-pattern system, `WeatherSampler` integration).
  Affects: storms sign-off (section B) and U2's rain-veil description — verify rates and veil
  behaviour still match.
- **Bell and boat tour** (approach bell, tour stops, guide). Affects: P2/U14 under-way tests make
  good bell-tour test beds — combine the walks.
- **Framegraph work, all reverted** (`8fafe9f`, `8b8749b`, `437aff9`: stripped-scene render,
  clear-colour serialisation, NRG blocks/PCSS shadows). No issue text depends on them, but do not
  revive the approach without reading why they reverted.
- **Q1/Q4 plans** (docs rendering-performance audit/pass, 2026-10-04/05) exist alongside the Q1
  measurements — file new findings under Q4, not Q1, to stop the two reviews diverging.
- **S2 possibly partly stale** (R15): `CREDITS.md` has gained tree/rock/terrain and lakeBed-array rows
  since the issue was filed — verify paths before rewriting.
