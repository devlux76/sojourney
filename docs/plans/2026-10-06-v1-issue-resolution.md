# Sojourney v1: root causes and resolution order

Prepared 2026-10-06 for implementation in a new session. This session changes documentation only.
Every unresolved item in [ISSUES.md](../../ISSUES.md) remains a v1 release blocker. Issue IDs,
existing fixes, evidence and ownership are preserved; grouping does not establish an unknown cause
or close an issue. R0–R15 below are work groups, not replacement issue IDs.

## How to use this plan

Start with R0, then follow the ranked queue. Finish the smallest useful slice of each group before
its larger follow-ons. Start the P1 pipeline track alongside the first engine fixes once its cache
and budget prerequisites are ready. A reproducible startup failure or corrupt frame preempts the
queue. Dependencies take precedence over estimated effort.

Ranking combines scope of the change, breadth of improvement, strength of existing evidence and
rework risk. It is a planning estimate, not a measured benefit or a delivery date. S means a
localized change; M means several collaborating modules or a bounded authoring pass; L means a
pipeline rebuild, substantial gameplay system or engine-wide compatibility work. V means
verification may suffice. Unknown causes have a small diagnostic slice followed by an unestimated
fix; their whole resolution must not be described as small.

The earlier Q1-first instruction is retained as the opening measurement/review pass. Q1 and Q4
then follow their findings through the relevant groups and close after final measurements; they
are not an unlimited refactor before the known defects. Existing plans and baselines provide
history. Use this plan and current AGENTS.md for the execution order; do not restore withdrawn
documents, rerun already completed U19/P4/S4 work, or revive reverted framegraph work.

## Required Babylon MCP and browser workflow

**Where a Babylon MCP tool exists for an operation, use that tool.** This applies to inspection,
creation, editing, validation and export, including asset preparation. An existing Python/TypeScript
pipeline step is not a reason to bypass a matching MCP capability. Adapt that step to consume or
orchestrate MCP-authored/exported results, or perform the operation directly through MCP and feed
its output into the remaining pipeline. Evaluate existing handwritten preparation as well as new
work. Start with one representative pilot; compare correctness, appearance, runtime cost, memory
and reproducibility before extending it to the whole pack. The lead's observed quality/performance
improvements motivate this requirement; establish the actual gain for each changed workflow.

At the start of the new session, inventory the installed Babylon MCP servers and tools actually
callable by the agent. The installed @babylonjs/mcp-servers package includes NME, NGE, NPE, GUI,
Flow Graph, Smart Filters and Node Render Graph servers. Only NME is exposed in this planning
session's tool catalog. Existence/configuration is not the same as a working connection: make the
matching tools callable before their dependent slice, rather than silently using an old pipeline
implementation. Use stock Babylon APIs/custom pipeline glue for operations not covered by MCP,
and record the specific capability gap. A matching editor name alone does not prove an operation
is supported; inspect the real tool schema and installed runtime source.

| Work | MCP use to check and apply |
|---|---|
| R3/R5/R9/R10/R13 materials, relief and shader authoring | NME import/create/edit/validate/export; preserve atmosphere and the existing PBR/plugin contract |
| R10/R11 geometry, LOD/prop/fish preparation | NGE for the operations its tools support; retain licensed source geometry and export into the pack build |
| R11/R13 particles, rain, landing/bite effects | NPE where supported; render both particle backends |
| R1/R12 UI and gameplay state | GUI/Flow Graph where the relevant operation is supported; DOM UI is not automatically Babylon GUI |
| Q4 post-processing/pass authoring | Smart Filters/Node Render Graph only for relevant supported operations; the reverted framegraph approach stays reverted |

Export authoring graphs to tracked files and record source/tool/version/config inputs in build
dependencies/cache keys. Follow [NME_NOTES.md](../../NME_NOTES.md): discover exact ports/enums,
inspect partial batch results, register required Babylon serialization types, bind actual textures,
keep data textures linear, and export before a session is lost. Graph validation is structural;
it does not replace GPU rendering, full-game integration or performance measurement. Author/bake
offline and ship the resulting assets; do not introduce runtime baking or downscaling. MCP-authored
NodeMaterial cannot simply replace atmosphere-lit PBRMaterial without preserving all its behavior.

**Prefer Chrome DevTools MCP with fully headed Chrome or Chromium.**
The lead’s Rule #4 (2026-10-06) permits working local-browser fallbacks when MCP access
is unavailable; record the method and evidence limits. Connect
to a real visible browser session, identify its GPU/backend, and use that MCP for gameplay input,
DOM/state inspection, console/network capture, screenshots and performance traces. If fully headed
execution is unavailable for a test, headless Chrome/Chromium is acceptable, still through Chrome
DevTools MCP. Record why headless was needed and the actual GPU/software renderer. Headless
hardware rendering is valid evidence; software-rendered checks have explicit limits for fidelity
and speed claims. Do not substitute ad hoc raw CDP/browser scripts merely because they are familiar.
If the MCP is not callable, establish access before dependent browser tests and continue independent
work meanwhile. Bun tests/typecheck/build and Python asset checks remain appropriate non-browser
checks. Firefox/Safari equivalence needs those actual browsers and their supported access; Chrome
results cannot stand in for them, and their existing lead go-ahead remains in place.

R7 implementation update (2026-10-07): sky/compositor, whole-cell and per-record vertical
underwater flora submission are repaired; current-eye water reach removes the entry/exit delay.
Per-record compaction and clear-air middle-list invalidation have eleven boundary/lifecycle checks.
At 50 m depth with 5 m visibility, matched day/night checks reduce 18 flora instances to 2 and
54 draws to 52 with identical pixels; sampled default-visibility views show no reduction.
Q3 remains open for lateral-hidden records, play-flora, broader moving props/shadows and lead
dive acceptance. Regression/evidence: `harness/underwaterFloraRecords.ts`,
`harness/underwaterFlora.ts` and the latest review-ledger entry. This does not close Q2,
Q1/Q4 or the deferred R5 backend gate.

## Ranked root-cause groups

| Order | Most likely cause / work group | Issues and related checks | First slice → remaining scope | Why here |
|---|---|---|---|---|
| R0 | Old measurements and incomplete review/verification coverage | Q1, Q4; all section-B sign-offs and section-E stale risks | S/V baseline → M review spread across later work | Prevents fixing old states or optimizing the wrong cost |
| R1 | Existing download information is not shown | S3; S4 regression guard | S | Confident, isolated improvement for every first download |
| R2 | Swim entry and surfacing boundaries disagree, exact trigger unknown | U15; E7, E15–E18 | S diagnosis → likely S/M repair | Restores a whole activity and enables underwater checks |
| R3 | Play-lighting contract and flashlight coverage | E8, E12; E23; U11 cross-check | S/M PBR migration → M submerged-light integration | One material contract improves tools, logs, fire, bobber and fish |
| R4 | Tour-stop state is not connected to weather | E20; sky/weather sign-offs | S/M | Makes the existing narrated stops visible |
| R5 | Backend bindings and material/pass variants have incomplete coverage | U16, Firefox/Safari; B4, E21, Q4 | S repro → fix sized from failing draw; M coverage | Find cross-backend blockers before extending shaders |
| R6 | Level ownership and transition state differ across streaming, instances and passes | U7, U13, U17; U18 diagnostic branch | S repro → M lifecycle/pass fixes | Several popping/flash/wrong-detail reports share this boundary |
| R7 | Fully obscured work is still submitted | Q2/Q3 remainders; Q1/Q4 | S reconcile current culling → M remaining passes | Potentially large savings with the visible picture preserved |
| R8 | Vessel-local collision and cast state are insufficiently exercised through motion | P2 remainder, U14; E4 ship cross-check | V/S shared voyage → bounded repair if needed | Much of the implementation already exists |
| R9 | Lake reflection, direct-light visibility and world-edge composition are inconsistent | E3, U4, E11, U5 | S controlled isolation → M separate repairs | Prominent defects; one global water adjustment is unlikely to fix all |
| R10 | Asset authoring loses source shape/texel detail or reuses stale outputs | P5 whole-asset MCP pass; P1, U6, U19; P3, B4; U18 cross-check | S cache/input audit → L flora, M terrain/bed | Highest-priority visual defect; begin P1 in parallel, approve pilots before full rebuild |
| R11 | Placeholder geometry and missing visual feedback weaken play | E4 both parts, E9, U11, E10 | M authored props/fish → M feedback | Judge after R3 lighting and R8 vessel behavior |
| R12 | Dive guidance, inventory and underwater recovery systems were never built | E14, E13, E22 | S product decisions → M/L implementation | Real new systems, dependent on reliable swimming and assets |
| R13 | Atmospheric effects are missing or await a product choice | sun shafts, U2 drops; sky/light/storm sign-offs | V decision → M effect work | Needs a representative view and a cost check, not another whole-sky rewrite |
| R14 | Large-world depth precision still has an unresolved general risk | U12 follow-up; U12 sign-off, Q4 | S precision repro → M/L Babylon compatibility work if required | Existing skirt fix holds; avoid an unproved engine-wide change first |
| R15 | Shipped inventory, attribution and final sound sourcing are not reconciled | S2, B1 TAKEN; S3/S4 final checks | S inventory early → M final reconciliation | Start provenance now; finish against the assets actually shipped |
| R16 | No in-game player feedback/bug-report path exists | E24 (Settings modal, log ring, bounded capture, Worker → GitHub) | S decisions (lengths, fields, privacy) → M implementation | New system; unblocks days-long-session repros with synced evidence |

These are cause hypotheses with separate branches where evidence differs. In particular: U18 is
not automatically U19; U11 is not automatically bad normals; U4 is not automatically a small
mirror; U17 is not automatically hardware scaling; B1 is not an empty soundscape.

## R0 — establish current evidence and finish the reviews through the work

1. Confirm the required MCP tools/browser connection above. Record the starting commit, installed
   Babylon versions, pack version, indexed file count,
   backend, real GPU/driver, canvas size, hardware scaling, camera/zoom, time and weather. Preserve
   the current 1,311 valid near-ground files and content-hash pack versioning. Baseline on real
   hardware; software rendering can test startup but cannot establish appearance or speed.
2. Reuse Babylon instrumentation in src/core/Perf.ts and browser profiling. Capture CPU/frame
   and GPU/pass times where supported, median and slow-frame distribution, draw/instance counts,
   active meshes, render targets, memory and streaming stalls. State unavailable GPU timing
   explicitly. Use repeated, warmed captures long enough to cover the current optimizer cadence
   and easing, rather than one FPS reading.
3. Record matched cases: clear rim with near/distant flora; Cleetwood deck/shore; moving Llao
   approach and exact U18 foothill; low sun; full rain; shallow/deep water by day and night; clear
   zenith; night moon. Obtain underwater cases after R2 restores ordinary entry. Record the full
   beauty case using the existing development inspection workflow, and normal target-FPS travel,
   stop, depart and stationary behavior separately. Add no shipped diagnostic quality switches.
   Include a minimal full-game WebGPU/WebGL2 smoke baseline before R3's material migration; repeat
   it after that change. R5's complete diagnostic gate precedes extensions to custom shaders.
4. Q1 audit: inspect src callbacks, ground/flora selection and streaming, player/play/boat/audio
   updates, pack parsing/decode/upload, narrator workers and tools build stages. Look for repeated
   scans, allocation/GC, unnecessary buffer copies, duplicate work and avoidable cache misses.
   Attribute cost before changing code. Preserve drawn content; use Babylon APIs rather than
   replacing an engine facility. Measure each candidate against the same workload and retain
   performance changes only when a repeatable gain exceeds measurement noise.
5. Q4 audit: inventory every custom shader/plugin/NME graph and GLSL/WGSL variant; atmosphere,
   sky/night/cloud/rain/water/fog; terrain/bed/relief; color, mirror, shadow, depth/prepass and SSAO
   geometry-buffer passes; render-target refresh/lists; post-processing; instance submission;
   textures, mip chains, formats and sampled-texture limits. Classify findings under R3/R5–R7/
   R9/R10/R13/R14, with one owner and acceptance check rather than duplicate Q1/Q4 fixes.
6. Audit current settings/optimizer authority. Settings.ts and environment controls still offer
   independent feature/quality choices, including sun shadows and SSAO Off/MSAA. Identify controls
   and persisted overrides that turn engine features off or trade quality for speed, and route
   those decisions through SceneOptimizer and target FPS. Features start enabled. Keep unrelated
   sound, input and accessibility choices. Preserve the lead-requested Scene optimization On/Off
   comparison control (2026-10-06): On by default; Off cancels tuning and restores full detail.
   Verify tone mapping and image dithering survive every
   downgrade/restore path (U9/E19), and stop/arrival/departure behavior does not fight weather.
   Check the claim that stillness restores detail without FPS headroom against stock
   SceneOptimizer improvement thresholds; test actual behavior rather than trusting its comment.
7. Keep a review ledger with surface, cost, finding, decision, change and evidence. A reviewed
   surface with no worthwhile change is valid completion; an arbitrary refactor is not. The
   2026-10-03 figures are historical, including the ~3 ms of own callbacks and GPU-heavy flora.
   Do not assume a CPU cleanup will resolve a GPU bottleneck.

**Exit:** reproducible current baselines, known coverage gaps, and a measured short list of cheap
Q1 opportunities. Q1/Q4 remain open until their full inventories and final checks are complete.
Completed issue entries live in the review ledger, not the active ISSUES list.

## R1 — show download percentage and a defensible estimate (S3)

Implementation completed 2026-10-06; see
[the current review ledger](../baselines/2026-10-06-issue-work-ledger.md).
Browser acceptance checked through headed Chrome CDP under the lead’s Rule #4 fallback;
see the ledger for controlled-fixture scope.

Use loaded/total already emitted by PackLoader.ts in DestinationScreen.ts. Add readable percentage
and remaining-time text, updated at a modest UI cadence. Estimate from recent network progress
and smooth it; cached-byte jumps must not imply an enormous download rate. If current callbacks
cannot distinguish cached bytes, add only the progress information needed for that distinction.
Show an estimating state before a usable rate, and a stalled/reconnecting state instead of an
infinite or negative estimate. Preserve retry and cached-entry behavior.

**Check:** fresh, partly cached, fully cached, slow/stalled, failed/retried and completed download;
percentage stays within 0–100, accessible text agrees with the bar, and time estimates settle
without cache-induced nonsense. Verify S4 still invalidates equal-size changed assets. This slice
does not require a broad pack-loader rewrite or concurrency changes; those belong to measured Q1.

## R2 — repair ordinary swim entry without breaking surfacing (U15)

Verified 2026-10-06 through Chrome DevTools MCP in the real-world harness on AMD
WebGL 2; U15 is closed in the review ledger’s archived regression anchors. The entry/dive/surface/exit sequence
passed on current code, so no speculative boundary repair was introduced.

Capture the transition in PlayerController.ts: lake mask, bed and prop support heights, body/eye
height, float threshold, grounded/swim state, velocity, aboard state and surfacing clamp. Compare
walking down the shore with E7's (300,900) test, jumping into water and arriving already submerged.
The entry predicate and clamp are suspects, not a confirmed diagnosis. Babylon's character
getPosition returns its live position; do not invent a stale-position copy fix.

Implement the smallest consistent dry/surface/submerged boundary with appropriate enter/exit
behavior. Include docks/decks above the lake and dry land below lake elevation. Keep the completed
stroke/head motion and automatic tool stowing. Rest behavior was settled by the lead
on 2026-10-06: idle swimmers sink with gravity/drag; forward strokes follow view pitch,
and upward strokes surface the swimmer. The former passive resurfacing is superseded. Add a focused transition regression test if the failing boundary can be exercised meaningfully.

**Check:** shore walk-in, swim, idle, dive with C, surface with Space/release, climb out and re-enter;
no walking on deep water, no swimming on dry below-level terrain, no swim state on a supported
deck. Verify E7, E15, E16 H/T behavior, E17 night underside, E18 underwater fade/icon behavior.

## R3 — apply the environment lighting contract (E8, E12 remainder)

**E23 built 2026-10-07, awaiting lead visual acceptance:** the stock spotlight
cone widens from 0.4 to 0.9381 rad, giving 2.5 times the geometric width at
matched distance. Following the lead's washed-out appearance review, candela
intensities are reduced 40% from 800/300 to 480/180 (land/water).
`harness/flashlight.ts` measures 2.28–2.33 times the half-brightness footprint;
peak pixels fall from 108/69 to 85/55 against the original output in AMD
WebGL2 through Chrome DevTools MCP. Matched production night views include land
and the deepest travel point. ISSUES section B and the review ledger track the
remaining width/brightness/usefulness judgment and backend limits.

Stock-PBR/shadow migration and fire emission compensation built 2026-10-06;
ISSUES section B tracks remaining E8 visual acceptance. The NME capability check
found an automatic atmosphere attachment gap; the lead requested a rendered NME
PBR pilot and manual wiring investigation. See NME_NOTES.md; do not infer manual
integration is impossible from the addon’s factory predicate.

**First, E8:** migrate held tools, chopped stumps/logs, fire logs/stick/cooked fish and fishing
bobber to Babylon PBR materials. Atmosphere's installed material factory only attaches its lighting
plugin to PBRMaterial, confirming this cause. Preserve wood/metal properties, register required
casters/receivers with the existing shadow generator, and use the appropriate held-item rendering
behavior. Evaluate the established night-fire exposure correction and PointLight excludedMeshes
against current exposure. Keep the approved warm roasting stick. Do not solve this by retuning
global sunlight, exposure or bloom around StandardMaterial.

**E12 update 2026-10-06:** object-depth integration is implemented through native
PBR material-plugin hooks; both GPU backends pass isolated light-path pixel tests.
The lead dive/flashlight acceptance remains in ISSUES section B. See the latest
review-ledger entry for integrated coverage and its limits.

**E12 contract:** after R2/R5, apply the existing water-depth attenuation to submerged flora, rocks,
plants and props, covering direct sun/moon and sky contribution. Keep flashlight/local lighting
undimmed. Read the installed material-plugin priority/hooks and preserve the atmosphere ordering
already fixed for terrain. Surface objects and depth-straddling geometry must not darken wholesale
because an object's origin is submerged. Coordinate with R7's fully-hidden culling.

**Check:** noon sun and shade, sunset, night fire at the recorded Wizard Island position; steel and
wood remain readable without white/black extremes. Compare submerged objects with the bed at the
same depths, with and without flashlight, on both backends. Recheck E12's ground fix. U11 remains
open if the cooking fish is still black after the migration.

## R4 — connect tour stops to weather (E20)

The sampler/dwell integration is built and runtime-verified 2026-10-06; E20 is
closed in the review ledger’s archived regression anchors. The current ledger records override, easing and departure checks. Automatic weather clears at every dwell, including
unattended stops, while explicit weather selection takes precedence.

Weather.ts currently eases toward the sampler; world.ts's onArrive only announces/narrates.
Add a stop-weather policy through the existing weather flow, using the same stop/dwell state
the optimizer uses. Prepare clearing on approach or arrival, ease into a viewable stop, and ease
back to sampled weather after departure. Avoid a clear/rain snap or resetting the sampler's
underlying progression. Define whether an unattended ship should influence the player's weather
before implementing that branch; use player/boat context already available.

Feed one effective weather result to clouds, sunlight, fog, rain, storm/lightning and weather audio.
Test optimizer haze/full-beauty restore separately so a visually clear stop is not still hidden by
stale optimizer fog. Keep the real weather sequence outside the stop window.

**Check:** arrive in drizzle, rain and storm at Devils Backbone/Llao; the narrated POI is visible
during dwell, transitions are smooth, pause/resume and departure work, and bell/guide timing is
unchanged. Rejudge the existing weather/storm sign-offs against the current sampler.

## R5 — isolate failing backend draws and build continuing parity coverage (U16)

**Lead scheduling update, 2026-10-06:** the captured transition failure is repaired.
Defer U16’s extended voyage/backend recheck until the remaining beauty and asset work
is complete; proceed with R6/R7 now. This postpones verification rather than closing U16.
Keep targeted runtime checks for subsequent changes and the Firefox/Safari go-ahead requirement.

Reproduce full Chromium WebGL2 gameplay on real hardware, including instanced flora, boat travel,
submerged bed arrays and the reported view. The successful above-water terrain harness is only
partial evidence. Capture the failing mesh/submesh/material/pass and actual sampler declarations,
types, texture units/bindings, defines, readiness and material lifetime. Verify asynchronous load
and variant changes as well as static terrain. Do not presume texture arrays alone are at fault
or patch Babylon's binder without showing an engine defect.

Repair the demonstrated setup/variant mismatch, keeping GLSL and WGSL aligned. Count complete
compiled bindings including atmosphere and engine additions. Read per-adapter/device limits;
neither 16 nor this GPU's 48 is a universal ceiling. Use committed NME graphs where appropriate,
without converting every shader simply because the moon conversion succeeded.

Build a small reproducible gameplay route reused after shader, fade, texture or render-target
changes. Cover WebGPU and WebGL2 from cold load and cached load, then day/night, wet/dry, near/far
instances, water entry and depth bands. E21 needs moon disc, phase, halo and size views at night
on both backends, not another midday startup test.
Current gameplay forces a full moon opposite the sun. Exercise known phase directions in an
authoring/development harness as well as the actual night view; do not treat this check as an
authorization to rewrite lunar astronomy or claim a gameplay phase cycle was tested.

**Firefox/Safari:** keep the issue's explicit lead go-ahead before implementation-time browser work.
Plan access to actual browsers/devices; if unavailable, name the missing run instead of claiming
coverage from Chromium or a substitute. Record actual backend/GPU. The Firefox depth-comparison
filter warning is not itself U16; change shadows only if appearance diverges visibly.

**Exit:** U16's failing route no longer reports sampler/draw errors, submerged B4 renders correctly,
and the backend matrix records evidence or an explicit outstanding release gate.

## R6 — unify level ownership and transitions (U7, U13, U17; diagnose U18)

2026-10-07 bounded ownership repair: full-file list rebuilds publish pending middle-card
changes together, preventing duplicate ownership during arrival/travel and an empty interval
on release while other loads remain. Stationary arrivals retain existing upload batching.
Regression: `harness/floraOwnership.ts`; evidence and limits in the review ledger. The
600 m handover's timed fade, auxiliary passes, U17 capture and U18 diagnosis remain open.

2026-10-07 bounded reentry repair: cells leaving the near sorter for far-list ownership
or whole-cell rain/water hiding clear saved LOD/fade state. Reentry selects the current
distance with full coverage; continuously near fades and hysteresis are preserved.
Seventeen production-builder/sorter/Babylon-attribute checks pass through Chrome DevTools
MCP on AMD WebGL2 (`harness/floraReentry.ts`, review ledger). This supplies no original-pine,
motion, U17/U20, auxiliary-pass or backend-parity acceptance; those checks remain open.

2026-10-07 bounded ship/pier coverage: native Babylon selectors choose prepared
ordinary instances, with stock-plugin complementary half-second fades and five-percent
inward hysteresis. Water entry selects the current distance immediately; whole-prop
hiding discards old transitions. The lake mirror lists every prepared prop level.
Twenty-two actual shipped-GLB lifecycle checks pass on AMD WebGL2; all eight asset/level
combinations render their stock dither shaders without compilation/GL errors
(`harness/propTransitions.html`, review ledger). The campfire's independent LOD path,
standalone shadow/SSAO coverage, forest card handover, motion acceptance and backend
parity remain open. This does not reproduce U17/U20 or close U13.

1. Log requested/loaded/drawn leaf and level, old/new owner, fade start/end, instance buffer
   interval/count, pass, zoom, render-target size and hardware scaling. Replay teleports, rapid
   travel/reversal, rest on thresholds, the 600 m card/full-file handover, asynchronous arrivals,
   missing-file recovery and optimizer resolution changes. Bound instrumentation to development.
2. Recheck U7's 3 m pine against the completed pack and camera/zoom invalidation. Guarantee final
   level selection follows prepared arrival state. Recheck U18's exact Cleetwood frame on real
   hardware: record leaf ID, file availability, leaf-versus-block ownership, level and normal/relief
   blend. P4 recovery is a plausible contributor, not proof of closure. If level and material
   inputs are correct, transfer the evidenced authoring problem to R10; do not apply global U19
   tuning to this local symptom.
3. For U17, capture the actual corrupt frame. Babylon's plugin uses an 8×8 framebuffer Bayer
   pattern; ordinary scaling can enlarge pixels but does not explain a huge board by itself.
   Check lifecycle, stale buffers, valid complementary intervals and correct pass attachment.
   Repair the demonstrated trigger, not the conjecture.
4. Extend U13 through the remaining campfire prop path, card/full-file handover and auxiliary passes. The stock plugin covers
   color and integrated prepass, not standalone depth/shadow/custom passes. Review shadow and
   SSAO geometry-buffer output together; use Babylon's existing plugin/pass hooks. Determine a
   consistent shadow policy during transitions and ensure no double-strength cast or visible
   pop. Retain underwater instant switches and above-water half-second time fades/hysteresis.

**Check:** motion recordings show no pop/flash, resting finishes at one level with no dither,
teleports land at the correct near level, and color/shadow/SSAO/mirror ownership agrees. Test both
backends and real optimizer scaling. Rejudge U13's implemented portion in motion.

## R7 — stop submitting what fog/water fully hides (Q2, Q3)

2026-10-07 slice completed: the opaque underwater volume now excludes distant sky mesh
submission and the atmosphere sky compositor, preserving sky irradiance and current
weather/astronomy enabled states. Matched day/night underwater pixels and resurfacing pass
in headed AMD WebGL2; 3–5 fewer draws, no repeatable total GPU-time improvement claimed.
Follow-up: whole-cell and per-record vertical flora culling are built, with clear-air middle-list
rebuilds on radius changes/travel. Matched underwater pixels and resurfacing pass, with two fewer
draws in the 50 m/5 m visibility case; no total GPU-time gain is claimed. Regression anchors:
`harness/underwaterSky.ts`, `harness/underwaterFlora.ts`, `harness/underwaterFloraRecords.ts`;
details in the review ledger. Continue with rain-hidden water/mirror work, lateral/play-flora
coverage and broader moving-prop/shadow/dive acceptance; extended backend coverage remains
at the lead's deferred R5 gate.

First reconcile the issue wording: world.ts already applies rain/underwater reach to props,
including the ship. Measure that behavior before adding another culler. Audit remaining sky
layers, water faces, mirror ground proxy/render list, and depth-hidden trees/props independently.
Use the same extinction/reach criterion that produces the visible fog or depth dimming; never
shorten visible distance independently of SceneOptimizer's chosen quality.

Read Babylon's culling, bounds, instance and render-target facilities. In the current pass context,
skip only contributions fully obscured from that pass's camera; an object outside the main view
can still appear in a mirror or cast a visible shadow. Preserve collision, deck support, audio and
streaming needed on resurfacing/departure. Restore rendering without stale lists, missing sky or
one-frame flashes. For objects hidden by water depth rather than distance, finish R3 attenuation
and show their remaining contribution is negligible before skipping them.

Under Q1, evaluate quadrant/spatial instance grouping only after measuring current behavior,
including extra draw commands and mirror cost. Keep it only if the total workload improves.
Do not turn the old ~4.7 ms estimate into a guaranteed gain or blindly execute the old plan.

**Check:** matched rain and deep-water views preserve their appearance; draw/pass/GPU work falls
repeatably; collision remains; surfacing and clearing weather restore all contributors. Recheck
Q2's completed ground/forest culling and Q3's distance culling/shadow-map pause with current
optimizer behavior. Record new figures instead of recycling the 2026-10-03 speedups.

## R8 — finish the ship voyage as one state/collision check (P2, U14)

Run tools/check_ship_deck.py, then board from every pier, walk/run/jump each step/ladder, visit
all three former holes and deck ends, cross rails, and repeat under way. Inspect narrow side
ledges, jump-only upper decks, the port rail gap and docked gangway openings with the lead.
If an intentional geometry rule fails the agreed experience, fix the authored metadata or asset
and rerun the checker; avoid layering arbitrary runtime collision patches.

Fishing.ts currently carries castFrom/castTo by boat.step while aboard. Test departure with a line
waiting, a bite/hooked fish and active reeling; reproduce the failed long Enter hold, distinguish
press/hold/release input from motion, and include touch input, arrival and stepping off the ship.
Choose and document whether a cast travels with the boat, automatically reels/cancels or stays
anchored; the existing carry behavior is the starting implementation, not final acceptance.
Then repair only behavior that violates that contract. Combine this run with bell/guide and R4.

**Check:** no fall-through/blocked boarding/rail escape or moving-deck drift; all fishing transitions
remain readable and recoverable. P2's checker alone is not manual sign-off. E4 ship visuals are
handled in R11 without changing walk boxes accidentally.

## R9 — separate the lake's four appearance defects (E3, U4, E11, U5)

Use shared shoreline frames 13/33 plus low-sun 19:36/20:03 and all map corners, on both backends.
Capture full quality and optimizer-degraded output separately. Inspect the actual rendered source
of each artifact through bounded development A/B checks.

- **E3:** establish the reflection resolution/texel footprint and reflected geometry quality.
  Trial Babylon mirror sizing/filtering/blur options verified in installed source. Author a
  sufficient default within a measured target cost and let SceneOptimizer control reductions.
  Measure extra mirror work/memory. Resolution addresses blockiness; it does not establish U4's
  pale-tint cause.
- **U4:** isolate terrain-water intersection, clip plane/proxy mismatch, normals/material
  composition, fog and depth. Fix the evidenced seam source rather than concealing it with color.
- **E11:** evaluate wave/normal roughness and specular/bloom separately from distant sun occlusion.
  Current world.ts passes 100 m shadow distance; the old 600 m description is stale, and terrain
  is not a shadow caster. Use Babylon's shadow/lighting facilities and authored water inputs for
  a believable glitter path. Compare feasible occlusion solutions and their measured costs; do
  not globally enlarge all shadows without a representative check. Behind-rim direct glint must
  disappear, while valid sky/mirror reflection remains.
- **U5:** identify whether the blue corner horizon is water extent, sky/mirror composition or
  absent background land. Correct composition first if wrong. If actual backdrop terrain is
  needed, build a licensed, budgeted destination asset offline; an edge wall alone is not a view.

- **E25/E26/E27 (added 2026-10-17, web-ocean comparison):** one lake-surface shader pass as a
  material plugin on the existing water `PBRMaterial`, GLSL and WGSL. Order: E26 layered wind
  ripples (replace the tiled bump), then E25 footprint roughness on the sun lobe and the mirror
  sample (glitter path, also E11's appearance half), then E27 body colour. Measure each on the
  real GPU against the mirror's current cost; SceneOptimizer may drop layers, never the look at rest.

**Check:** smooth/readable reflections, no pale seam, plausible low-sun glint with proper rim
occlusion, believable horizon at all corners, and no new night/underwater/backend artifact.

## R10 — repair authoring inputs and caches, then rebuild assets

**P5 — whole-asset Babylon MCP pass (lead request, 2026-10-06):** run all assets through
a relevant Babylon MCP, everything, all of it. Start the inventory and representative
measured pilots early as a performance investigation, alongside P1; extend the pass to
every shipped/generated asset category, not only currently defective assets. Track tool
coverage, reproducible inputs/exports, runtime validation and matched before/after costs
for every asset or family. Record unsupported operations as explicit capability gaps and
unexpected behavior in the relevant MCP NOTES file. Preserve asset quality, offline
budgets and commercial provenance. ISSUES P5 owns full-inventory completion; Q1/Q4 own
its performance evidence, and S2 reconciles the resulting shipping inventory/credits.

**Small prerequisite with broad impact:** record source identity, mesh level, UV range, scale,
budgets, material/texture density and all relevant build/bake inputs before editing. Current
flora_models.py selects source LOD2, not the issue's older LOD1 claim; separate trunk budgets
already exist. Inspect actual source/cache artifacts before replacing working pieces.
run_dump's existence-only reuse and card_for's incomplete bake-input hash can hide changes.
Invalidate affected caches explicitly or key them by source/config/tool inputs, and prove a changed
input produces a changed output while an unchanged rerun is stable. Do not indiscriminately clear
all caches or repeat the already fixed pack-version bug.

**P1 flora track, started in parallel:**

1. Map geometry/material/card preparation to NGE/NME tools and adapt the existing pipeline or
   use the tools directly for supported operations. Inspect original source meshes/.blend
   availability, bark repeat UV range and actual pixels per
   metre at normal and lidar-scaled height. Set simultaneous-visible triangle and texel budgets,
   material count and per-level silhouettes from current measurements and the restored Packsmith
   design. Keep geometry and texel budgets explicit; no runtime asset derivation/downscaling.
2. Build one fir and one pine pilot from the suitable original trunk geometry, repeating bark
   material and authored normal/roughness/AO at the required density. Retain budgeted, branch-aware
   foliage/branch structure at middle levels. Removing foliage and support branches independently
   must not leave detached sprigs. Check tallest-instance scale as well as nominal scale.
3. Re-bake cards from the approved levels. Diagnose baked normal/color/alpha/lighting behavior
   before changing CARD_DARKEN. Preserve the intended distant silhouette and avoid orange sun-facing
   cards/black dots; no global exposure fix around incorrect cards. Recheck U6 shrubs and their
   texture/color space separately if pinkness remains.
4. Approve pilots at 2–7 m, multiple heights, low sun and rim distance, then rebuild variants and
   regenerate only downstream outputs that depend on them. Validate GLBs, authored LODs, mips,
   materials, textures, pack bytes/VRAM and transitions. Recheck U7/R6 after rebuilding.

   Rebuild chain: changed geometry/bounds/height/colliders/footprints → species_stats → forest
   manifest and affected leaf/mid placements → placement/patch checkers → pack index. Source model
   heights set lidar scaling globally. If a ground change modifies quadtree IDs/bounds, coordinate
   ground near/far/blocks/collision and all forest leaf ownership/files; partial --area rebuilds
   require unchanged leaf/species contracts.

**U19 terrain track:** retain the working NME-authored relief, tested normal directions and packed
micro/relief data. Reduce excessive fine rippling and improve broad grey cliff/pale scree contrast
by diagnosing the active asset/material/config inputs. Use matching NME MCP operations for the
normal-authoring graph and other covered work, then integrate exports with the existing PBR terrain
plugin and downstream assets. The normal bake graph alone does not control cliff/scree colors.
Use fixed-view material comparisons. Judge large ledges from the full-game south-west/reference
view, including the recorded camera (0,20,1800) toward (935,290,3800), and the actual midday boat
ride. The fixed eastern harness alone does not settle the tabletop outline. Separate material,
geometry and shadow/AO-reach findings. B remains first; denser near meshes A only if B is still
insufficient after comparison. Authored crag meshes C stay dropped. If A is warranted, establish
its source/near-region/LOD budget and R6 transitions before rebuilding; the 1 m sampler is not
already production input. Record controlled frame cost, not the ~10 FPS snapshot as a gain.

**Preserve derived terrain inputs:** a full ground manifest rebuild currently omits basaltUrl;
--textures refreshes rock_normal without necessarily repacking rock_normal_relief. Retain/reinstall
the basalt mask, normal/AO and relief references, rebuild affected derived textures and validate
the manifest's input/output dependency chain before accepting a ground rebuild.

**B4 bed branch:** judge the moss band with daylight and the night flashlight; replace its source
with commercially cleared authored moss if the straw appearance is confirmed unacceptable.
Rebuild the existing arrays/mips without multiplying bindings, then check every band and slope
transition underwater in WebGL2/WebGPU. Update credits alongside any source replacement.

**P3 sign-off:** run check_rock_patches.py and inspect the recorded cone shoulder and varied slopes
for floating patches and bare areas after the 24% drop. Improve authored distribution only if
coverage fails; the grounded-patch pipeline fix is not an unimplemented task.

**Exit:** lead-approved tree/terrain/bed appearance, no disconnected branches, stable rebuild
dependencies, preserved P4/S4, measured cost/memory, and a new indexed/cache-served pack. Rebuild
the index and restart Vite after adding public files so missing asset requests do not return HTML.

## R11 — finish play-object form and feedback (E4, E9, U11, E10)

Replace the cylinder/pole-thin stump/log and untextured ship-step placeholders with budgeted,
commercially usable authored assets, preserving interaction origins and ship collision metadata.
For E9, use a recognizable fish with sane proportions and pivot; align it on the shared stick
axis and rotate fish/stick slowly together above the fire. Preserve the approved heated stick.
Diagnose U11 with transformed normals, PBR defines, light inclusion/falloff and orientation.
Babylon already handles nonuniform-scale normal transforms; do not write a custom correction
from the untested sphere-normal guess.

For E10, judge the actual bobber at 33–34 m after R3. Add visible wait/bite motion or surface
response, rod response to tension and recognizable landing fish/splash, keeping text/tension
feedback as support. Reuse the authored fish and Babylon animation/particle/line facilities;
do not rebuild an animation/rendering engine. Choose assets/contrast/cues that work at realistic
scale and current resolution, including optimizer degradation, rather than silently scaling every
object to hide a visibility problem. Retain the existing wind-up, wait, fight and landing flow
unless the demonstrated UX defect requires a specific behavior change.

**Check:** noon/shade/night object appearance; fish skewered and rotating with no black silhouette;
stumps/logs have credible proportions; every fishing state is apparent without reading the card
alone, from shore and docked/moving deck, on keyboard and touch. Credit new assets as they enter.

## R12 — implement missing resource, recovery and dive-guidance systems (E14, E13, E22)

**E22 (later work, added 2026-10-06):** provide dive narration explaining current
depth and visible features when crossing authored underwater bands, potentially
with voice and accompanying text. Settle band boundaries, script, presentation and
repeat behavior before implementation; reuse destination band data and the existing
narrator/audio flow, and coordinate E14's underwater HUD. This addition does not
change the current execution priority or authorize invented narration content.

**E14:** before coding, resolve breath duration/refill, whether the scuba 30-minute daily allowance
uses real or game minutes, what defines/reset a day, initial/acquired gear, pause/time handling,
what drowning preserves. Rest behavior is settled: idle sinking with gravity/drag,
with active strokes required to swim upward. Keep these as product decisions, not invented
requirements. Implement breath from the player's actual submerged state, consume scuba allowance
only while applicable, then start normal breath when the allowance runs out. Connect to rucksack,
clock and existing HUD/touch flows. On exhaustion, recover at the nearest actual dock using
destination dock data, existing ground preparation/travel and a safe landing; terminate conflicting
fishing/held/swim state deliberately. T debugging travel is not the recovery mechanic.

**E13:** author/map gatherable stones as needed, collect them with bare hands into the rucksack,
and require exactly six stones and three logs to lay a fire. Make the resource consumption atomic
with valid placement: a rejected site or insufficient inventory consumes nothing. Keep the existing
no-fire-on-deck rule and rain/lighting behavior. Do not make physics rocks automatically harvestable
without an intentional authored interaction/availability rule.

**Check:** timed breath/refill, surface/submerge boundaries, scuba exhaustion and daily reset,
pause/resume and gear presence, drowning from several positions choosing the nearest safe dock,
clean activity state after recovery; stone gathering, partial/enough inventory, repeated input,
invalid placement and successful fire lighting. Use focused logic/integration tests for these
new state/resource systems rather than tests mirroring trivial visual edits.

## R13 — finish weather/light judgment and the remaining effects

Rejudge the implemented sky pass under current sampler/optimizer behavior: E1 morning/evening
mist; E2/U3 overcast; U2 rain veil; U1 noon and low-sun glare; U9 tone mapping; storms and evening
haze. Record the lead's storm choice for night flash brightness, strike rate, bolt width/reach
and delayed thunder. Cover night rain, previously untested. Re-shoot E19's exact zenith with
image-processing dithering on current beauty/restore paths and check the gradient and frame cost.

For sun shafts, first find a real view with sun behind near trees. Reuse Babylon's installed
VolumetricLightScatteringPostProcess, with separate postProcessRatio/passRatio, custom sun
position and correct sky/skyProxy exclusions verified from source. Compare occlusion, camera
movement, dawn/noon/sunset and both backends. Enable the finished effect by default and integrate
any quality reduction into SceneOptimizer, recording its cost. Do not re-add a pass that draws
no rays in the representative case.

For U2 drops, obtain the lead's choice on upward-facing rain visibility. If accepted as physical
end-on drops, record explicit acceptance and close that decision; if changed, implement the chosen
camera-facing cue through Babylon's particle/billboard facilities and verify all view angles.
The gray overhead veil is a separate already-implemented behavior.

E28 cloud shading (self-shadow, rim/silver lining, footprint-filtered octaves, antialiased edges)
and E29 AgX against ACES, judged on the same noon/low-sun/night frames; U21's navy zenith is
rechecked with E29 before any atmosphere retuning.

**Exit:** explicit visual sign-off/decisions for every existing light/weather item, visible sun
shafts in their intended view, no night-rain or optimizer-restoration regression. E21 night parity
is checked in R5, with the same night session reused here.

## R14 — settle the general precision risk (U12 follow-up)

Keep the proven skirt-depth fix and recheck its boat-ride sign-off first. Reproduce other distant
close-pair precision failures with exact geometry/camera/depth evidence. Installed Babylon has
useLargeWorldRendering/useFloatingOrigin support; prefer a bounded compatibility trial of that
facility to a handwritten origin system. Audit world-coordinate terrain sampling/bed depth,
thin instances, custom/native sky, Atmosphere, physics/player/boat, mirror, shadow and every
auxiliary pass on both backends. Atmosphere compensates for floating-origin offsets, but that
does not prove our plugins do. Its compositor's fixed far depth also explains why reverse depth
cannot simply be enabled without checking the sky.
Distinguish world-coordinate precision from depth-buffer precision: floating origin does not
itself change depth-buffer distribution. Measure both and choose the corresponding remedy.

Choose the compatible built-in precision strategy, or a demonstrably adequate near/far-plane
configuration, from those measurements. Preserve collision and absolute destination coordinates.
If broad work is not justified by the risk tests, present evidence for an explicit lead disposition
of the open risk; do not silently call the general cure implemented. Retire skirt-specific code
only after a replacement proves equivalent across the original crack/ridge tests.

**Check:** boat/rim/cone and all corners, near tools and distant card/terrain pairs, mirror/sky and
physics while walking/swimming/sailing, WebGL2/WebGPU, with no precision shimmer, black sky,
texture drift or new clipping.

## R15 — reconcile shipping inventory and finish owned sound work

S5/S6 add Cloudflare packaging and device-driven SW storage management to this
release track. Inventory and compression/decode pilots can start with P5; finish
against final authored assets. Follow the
[pack/storage preparation](../specs/2026-10-06-cloudflare-packs-and-storage.md).
The deployment gate covers the app/WASM as well as real zstd-22 shared/biome packs.

Begin S2 inventory during R0/R10 so a bad source is not rebuilt throughout the pack. Reconcile
files.json, runtime manifests, all public assets copied by Vite, obsolete shipped files and the
production bundle. The current pack has flora/ground paths rather than models/trees or terrain;
new lakeBed/relief credits do not close those older mismatches. Include thumbnails, sky maps/star
data, textures/flare/waterbump/environment files, global guide sample, recorded narration/sounds,
KTX/meshopt decoders, vendored code and generated/derived assets. For each, record actual shipped
path, source/author, license and required notice, modifications/derivation and build tool inputs.

Use commercially permitted sources and ship their obligations. Apply the project's settled rule
that inherited unrecorded prototype assets come from Babylon Assets under CC BY 4.0 unless their
folder specifies otherwise; do not invent unknown-origin blockers. Verify primary source/license
terms when obtaining/replacing an asset, and put genuine unresolved questions in LICENSING-TODO.md.
Include bundled software notices, including the phonemizer/eSpeak entry already in CREDITS, in
the distribution audit without presuming commercial use is prohibited. Refresh credits whenever
assets change, then do the final reconciliation after rebuilding/indexing.

B1 remains TAKEN by the lead: rim wind, jay/nutcracker calls and daytime rain sourcing belong to
them. Provide a list of expected destination entries, paths/licensing and integration checks.
Integrate supplied assets as authorized, then verify wind/day/night/shore/underwater/footsteps,
fishing/fire/rain/thunder/bell/guide and volume transitions. The observed surf/bell/guide playback
is not final sourcing approval; include dry-fire procedural crackle in the soundscape playback
and final listening sign-off.
Never claim B1 resolved while the lead's source work is outstanding.

**Exit:** shipped files/bundled notices reconcile with CREDITS, no unresolved commercial-use
question, final soundscape sign-off, and fresh/cached/partial-download entry works for the final
pack. Do not publish or deploy as part of this planning request.

## R16 — build the player feedback/bug-report path (E24)

Lead decision 2026-10-07: Cloudflare Worker relay only (approach C). No direct-client GitHub
PAT and no manual download-bundle fallback; a failed POST surfaces in-game.

1. Settle product inputs first: exact form fields and category list, log ring length (starting
   point: last ~15 min or ~2,000 entries, capped bytes) and clip cap (starting point: 30–60 s
   `.webm`), `report.json` system-detail allowlist with no personal data, and the Worker-side
   rate-limit/spam/abuse rules. Measure real repro bundle sizes against GitHub's caps (10 MB
   images, 10/100 MB video, 25 MB other) before fixing the bounds.
2. Build the client slice: central logger wrapping `console` with one shared clock per entry
   (wall ISO + `performance.now()` + game clock + frame + camera/position/weather/optimizer
   state), bounded ring + session manifest, Settings "Report a problem" DOM modal (form →
   capture offer → return-to-play badge → thank-you card), bounded `VideoRecorder`/screenshot
   capture reusing `src/core/Screenshot.ts` with filenames carrying the shared `reportT0`.
3. Build the Worker slice alongside S5/S6: validate, hold the PAT as a secret, store overflow in
   R2, file via `POST /repos/{owner}/{repo}/issues` with the summary inline and R2 links past
   the attachment caps. Failure is an in-game error, not a silent fallback.
4. Verify end to end through Chrome DevTools MCP (headed): file a repro from a real session and
   confirm the issue lands with matched video-second ↔ log rows, correct system detail, and no
   secret or personal data in the client bundle. Add focused tests for the ring bounds, clock
   sync, bundle shape and Worker validation; keep the flow mockup reference in E24.

**Check:** form → capture → back-to-play → filed issue with synced log/video and thank-you;
bounded sizes hold on days-long sessions; offline/denied/failed POST shows a clear error.
Depends on R0 baselines for representative capture; independent of asset rebuilds.

## Execution lanes and dependency order

Primary entry points for the next session (inspect before editing; this is not a mandate to change
every listed file):

| Group | Main code/authoring surfaces |
|---|---|
| R0 | src/core/Perf.ts, Settings.ts, SettingsPanel.ts, Engine.ts; src/engine/Optimizer.ts; src/narrator/ workers; tools/ |
| R1 | src/ui/DestinationScreen.ts, src/biomes/PackLoader.ts, existing destination styling |
| R2 | src/engine/player/PlayerController.ts, ground.ts, movement.ts; src/play/Play.ts |
| R3 | src/play/HeldItem.ts, Chopping.ts, Campfire.ts, Fishing.ts; src/engine/TerrainMaterial.ts, lake.ts, flora.ts, props.ts |
| R4 | src/engine/world.ts, environment/index.ts, boat.ts; src/sky/Weather.ts |
| R5/R6 | src/core/Engine.ts, nativeShader.ts; src/engine/ground.ts, groundStream.ts, flora.ts, props.ts; committed graphs and harness/ |
| R7 | src/engine/world.ts, underwater.ts, environment/Fog.ts, ground.ts, groundStream.ts, flora.ts |
| R8 | src/engine/boat.ts, player/PlayerController.ts; src/play/Fishing.ts, Play.ts; tools/build_props.py, check_ship_deck.py |
| R9 | src/engine/ground.ts, TerrainMaterial.ts, world.ts, environment/; tools/build_ground.py and water/reflection authoring |
| R10 | tools/flora_models.py, flora_dump.py, flora_geometry.py, flora_render.py, flora_glb.py, build_flora.py, build_forest.py; ground authoring/build_terrain_relief.py and tools/materials/ |
| R11 | src/play/Chopping.ts, Campfire.ts, Fishing.ts, HeldItem.ts; src/engine/boat.ts; tools/build_props.py and authored assets |
| R12 | src/play/rucksack.ts, actions.ts, Overlay.ts, Play.ts, Campfire.ts; src/engine/player/PlayerController.ts; src/sky/GameClock.ts; biome/placement data |
| R13 | src/engine/environment/ and moonMaterial.json; src/core/particles.ts; src/sky/Weather.ts |
| R14 | src/core/Engine.ts, nativeShader.ts; terrain, player/boat, instance, mirror and environment coordinate/pass code |
| R15 | CREDITS.md, LICENSING-TODO.md, tools/build_pack_index.py; src/biomes/crater-lake/index.ts, AmbientAudio.ts, WeatherAudio.ts, play/sounds.ts; public inventory |
| R16 | src/core/Screenshot.ts, Settings.ts, SettingsPanel.ts, Hud.ts, play/Overlay.ts; new logger/report bundle; Worker + R2 (with S5/S6) |

- **Primary engine lane:** R0 measured first pass → R1/R2/R3 first slice/R4 → R6 → measured
  R7 → R8/R9 → R3 submerged completion → R11/R12/R13 → R14 as justified → deferred U16 coverage → final review.
- **Pipeline delegate:** R10 source/cache/budget audit starts after R0, then P1 pilots → approved
  full flora rebuild; terrain U19/B4 and P3 checks are independent subtracks. Feed outputs and
  evidence to R6/R9/R11 and the final performance pass.
- **Release/content lane:** start S2 inventory early; lead owns B1. Coordinate final index, credits,
  browser/device access and sign-off after the authored outputs stabilize.
- **Feedback lane (R16):** settle lengths/fields/privacy after R0, then build client + Worker
  independently of asset rebuilds; verify against a real repro session.

Keep one editor for shared world.ts, TerrainMaterial.ts, flora/groundStream and environment files
at a time; delegate independent authoring, evidence and inventory work. Commit cohesive completed
slices directly on main, without worktrees or feature branches. Comment code in files being edited.
No implementation commits occur in this planning session.

Dependency edges: R2 enables R3 submerged/R7 underwater/R12 breath; R3 precedes R11 visual
judgment; R5 is an early gate for shader changes and repeats after them; R6 diagnoses U18 before
R10 changes its assets; R10 can begin pilots independently, then revalidates R6; R8 establishes
moving fishing behavior before final R11 feedback; R4 enables an ordinary clear-stop tour but
does not replace controlled R0 measurements; R15 finishes after all asset changes. R16 needs R0
representative capture for its bounds and rides with S5/S6 for the Worker/R2 path; it does not
block asset or engine slices.

## Verification sessions and closure rules

| Session | Cases | Issue closure/sign-off covered |
|---|---|---|
| Download/release | Fresh, cached, partial, stalled, retry; final file inventory | S3, S4 guard, S2, P4 guard |
| Shore/swim/dive | Walk-in, dry low land, surfacing, tools/H/T, breath/scuba, shallow/deep day/night | U15, E7 guard, E12/E14/E15/E16/E17/E18/E22, B4, Q3 |
| Complete boat tour | All piers/decks/steps under way, waiting/hooked/reeling casts, wet arrivals, Llao foothill | P2, U14, E20, U18, E4 ship, U12 sign-off, bell/guide B1 |
| Ground/flora motion | Close bark/canopy/shrub, low-sun cards, rim slivers, rock patch coverage, zoom/teleports/fades | P1, U6/U7/U13/U17, P3, U19 |
| Shoreline and horizon | Shared shoreline frames, low-sun occlusion, four corners, precision pairs | E3/U4/E11/U5, U12 follow-up |
| Play session | Tool lighting, chop/logs, stone gathering, night fire/cooking, full fishing loop | E8/E4/E9/U11/E10/E13; E5 touch guard |
| Sky/weather/night | Zenith, fog/overcast/rain angles, sun shafts, storm/night rain, moon phases | E1/E2/U3/U2/U1/U9/E19/E21, sun shafts, storms/evening mist |
| Backend/optimizer/performance | Repeat representative routes on each supported backend/browser, quality transitions and restoration | U16, Firefox/Safari, Q1/Q2/Q3/Q4, E19/U9, U13/U17 |
| Feedback filing | Settings report → form → video/screenshot/skip → filed issue → thank-you; failed POST error | E24 |

For each substantive code slice, run the appropriate existing tests and type/build checks; use
focused new tests for demonstrated transitions, resource accounting and cache/dependency bugs.
Use asset checkers for rebuilt outputs and real-GPU videos for visual/motion claims. Standard
commands are bun test, bun run typecheck and bun run build; data tools use python3. Documentation
edits need coverage/link/diff checks, not a new application test suite. Do not commit dist,
node_modules, ignored source caches/near-ground/collision outputs or screenshot/video evidence.
Commit the tracked public pack assets, authoring inputs, manifests and index changes required by
the current repository workflow; generated content is not categorically excluded from commits.

Record commit/pack/backend/camera/time/weather/optimizer state for each result. An implementation
pass moves an item to awaiting sign-off when lead judgment is still required; a build or harness
pass never supplies that judgment. Close only with the item's specific evidence and required
lead acceptance. Keep completed E5/E6/B3/E7/Q2-half/P2-checker/P4/S4 as regression anchors, not
tasks to reimplement. Preserve the 120-minute day and verify changed time logic still respects it.

## Final release gate and next-session handoff

- [ ] R0 baseline and the full Q1/Q4 review ledgers are complete; retained optimizations have matched
  before/after evidence, and final normal target-FPS behavior is recorded with the completed pack.
- [ ] Every open issue/remainder has its implementation or explicit accepted disposition; none was
  moved to v2. Every section-B sign-off and undecided/unowned atmospheric/browser item is settled.
- [ ] Backend matrix includes full instancing, bed depths, moon/night, weather/fades and optimizer
  restore. Missing Firefox/Safari/device access remains a visible gate until the lead resolves it.
- [ ] Final authored assets have budgets, LODs/mips, valid manifests/index, complete near coverage,
  stable cache keys and preserved derived terrain inputs; P4/S4 do not regress.
- [ ] Relevant Babylon MCP tools were used, exported authoring inputs are reproducible, and the
  pipeline incorporates their outputs. Browser evidence was collected through Chrome DevTools
  MCP in headed Chrome/Chromium, with any permitted headless fallback and renderer recorded.
- [ ] S2 final inventory/credits and lead-owned B1 sound sourcing/sign-off are complete.
- [ ] Relevant tests/typecheck/build, manual keyboard/touch gameplay and lead visual sessions pass;
  ISSUES statuses/test log and current baselines match those results.

Start the next session by reading AGENTS.md, ISSUES.md and this plan, checking git/pack state and
doing R0's first baseline. Begin the small engine slices and assign the independent R10 audit.
Resolve product choices at the relevant slice: breath/scuba clock/recovery, moving fishing,
deck accessibility, unattended-stop weather, upward rain and storm appearance. Browser work retains
its recorded lead go-ahead. Today this is a complete proposed sequence, not approval of invented
product defaults or evidence that any still-open issue has been fixed.
