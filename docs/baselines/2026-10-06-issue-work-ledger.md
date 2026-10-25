# v1 issue work ledger — 2026-10-06

Starting commit: `e480177`. Runtime Babylon packages and MCP servers: 9.29.0
(Havok 1.3.14; installed editor packages are 9.28.0). Crater Lake index version:
`220ad0bfb5e883cd`, 5,105 files. Starting typecheck and 26 Bun tests pass.

## Tool and measurement coverage

Only `babylonjs-nme` is exposed in the callable tool catalog. No Chrome DevTools,
GUI, Flow Graph, NGE or NPE tools or tool-discovery endpoint are callable here.
NME's shader graph operations do not cover DOM progress UI or player movement.
The lead’s Rule #4 permits practical fallbacks when a file requirement blocks progress.
Headed Google Chrome was launched with an isolated temporary profile and controlled
through a Bun CDP script because Chrome DevTools MCP is not callable. R0's runtime
baseline and Q1/Q4 completion remain open; old timings are not current evidence.

The installed source confirms the existing weather sampler/easing path and native
PhysicsCharacterController movement APIs; performance changes require measurements.
The independent quality settings noted in R0 still need their own resolution.

## S3 — download feedback

Implemented percentage, network-only rolling ETA and estimating/waiting/finishing
states. Polling at 250 ms updates the label during silence; retry creates fresh state;
finally clears its interval. PackLoader reports cumulative network bytes separately
from cache hits. Cache naming/content hashing and file-fetch concurrency stay intact.

Validation: application typecheck, 30 Bun tests and production build pass. Four new
estimator regressions cover partial/full cache, slow rates, rolling rates, stalls,
recovery, completion and fresh retry state. S4's real-indexer regression passes.
Build reports chunk-size and ineffective-dynamic-import warnings.

Headed Chrome DOM checks with controlled fetch/CacheStorage fixtures verified:
- Failed fetch shows the retry message and hides the progress bar.
- Partial cache (800/1000 bytes) then two 50-byte network chunks shows 90%,
  `About 2s left`; visible text, bar width and aria-valuenow agree.
- Fresh progress shows 10%, `About 12s left` with the same UI agreement.
- Successful retry removes the destination UI and invokes onChoose; the next
  fully cached entry bypasses download.

Stall/recovery and rolling-rate arithmetic are covered by deterministic Bun tests.
Transport fixtures exercise the actual loader/UI in a browser, not a real remote
connection or full-pack duration estimate. S3 is removed from pending work and retained
as a regression anchor in this ledger. No frame-cost claim is made.


## U15/E7 — swimming diagnosis and harness repair

Real-game headed Chrome WebGL 2 uses AMD Radeon Pro Series / radeonsi polaris11
ACO through ANGLE, 1042×657, hardware scaling 1. At (300,900), the native physics
raycast reads bed -68.186 m. Entry settles the eye above the surface (0.210 m),
C dives to eye -3.563 m, and release resurfaces to 0.248 m; swimming stays true.
Thus deep-water entry and E7 surfacing work in this backend. U15 remains open
until ordinary shoreline walking is followed through the transition. An initial
12-second walk only reached bed -1.151 m, too shallow for the current swim-entry
condition; it does not demonstrate the reported failure.

The old player harness used the removed `spawn` biome field instead of `places`
and never loaded a lake mask (inLake consequently always returned false). It now
uses the current places API and feeds an analytical-basin mask through the real
loadLakeMask path. The loader accepts just the manifest fields it consumes.
Application and standalone player-harness typechecks and production build pass.
TypeScript’s installed CLI requires --ignoreConfig for this standalone-file check.


## Chrome DevTools MCP connection repair

Issue work paused at the lead's request. The package was already installed (1.10.1)
and configured in VS Code's MCP settings, but absent from Codex's MCP configuration.
Added `chrome-devtools` to Codex with the installed Bun entrypoint, isolated headed
Google Chrome, usage statistics and CrUX disabled. A real stdio MCP connection
initialized, listed 30 tools and successfully called list_pages. The current chat's
tool catalog still needs the Codex extension restart. See
[CHROME_DEVTOOLS_MCP_NOTES.md](../../CHROME_DEVTOOLS_MCP_NOTES.md) for the observed
configuration/runtime distinction and verified launch. No new gameplay closure is
claimed by this connection repair.


## U15 — closed after ordinary shore transition

Chrome DevTools MCP, headed Chrome / WebGL 2 on ANGLE AMD Radeon Pro Series
(radeonsi polaris11 ACO). The tracked real-world harness (`0471c09`) builds the
production world, uses actual streamed pack assets and Havok collision, and exposes
its references for repeatable inspection without heap scans. It bypasses the
destination downloader, so this check is gameplay evidence, not download evidence.

Keyboard-equivalent virtual inputs: from (0,761) / bed -1.183 m, W entered swimming
at (0.024,762.166), bed -1.776 m. C reached eye -0.518 m (limited by the shallow
bed); Space resurfaced to +0.203 m with swimming true. S returned to bed -1.655 m
and swimming false. The previous deep test at (300,900) also passed C and passive
resurfacing. Current code did not reproduce the reported inability to enter;
U15 is removed from open work and retained as a regression anchor.

No console errors/warnings were captured through this sequence. This is not full
U16 backend/instancing/boat/underwater-band coverage.


## E20 — tour-weather runtime verification

Chrome DevTools MCP on the actual world/boat/environment: selected day 0, hour
11.9, where the unchanged automatic sampler yields rain 1.0/cloud cover 1.0.
Explicit storm selection remained storm during a dwell (rain 1.4, storm 1).
Returning to auto while the real boat dwell predicate held eased rain to 0.515
after 20 seconds, then 0.076 after 58 seconds; cloud cover fell to 0.102.
Setting dwellLeft to zero released both the weather and optimizer stop predicates;
12 seconds later rain rose to 0.496 toward the still-rainy schedule. The player
was ashore, confirming the intended unattended-stop behavior. This exercised real
easing and the shared weather state; it did not replay a full narrated voyage.

## E8/NME — authored pilot and partial rendering checks

Production PBR migration `dd2274d` passes application typecheck, 32 Bun tests and
production build. MCP verified atmosphere attachment on all five held materials,
chopped wood and bobber, with 10 held meshes in the sun-shadow list. Night-fire
logs use PBR, receive/cast shadows, are excluded from the near point light and
use emissiveIntensity 1/30 at exposure 30; cooking fish also carries the atmosphere
plugin. Visual fire inspection was obstructed by foliage and needs a clearer spot.

At the lead's request, NME authored and exported a PBR/reflection/fog/image-processing
graph to tools/materials/play-pbr/pilot.json. PlayPbrPilot establishes its defaults
in the constructor. Bare NME and explicitly attached Atmosphere plugin variants
both compile, but compiled source lacks the addon's transmittance code. A manual
constructor-configured binding through Babylon's getDiffuseSkyIrradianceToRef API
restores the shadow-side sky fill on the sunset sphere comparison. Native PBR remains
the production material while per-normal/aerial-perspective/backend/performance
parity is unresolved. This is a rendered pilot, not a closed P5 whole-asset pass.

E8 evidence currently saved to /tmp/e8-* and /tmp/nme-pbr-*; relocate final useful
captures under ignored tools/.cache/shots before relying on them across sessions.
No performance improvement is claimed by these screenshots.

## Resumed inspection — E11 and U16 shadow transition

The handoff was read and removed at the lead's request. Main retained the existing
ERRORS.md/session-ses_ef04.md deletions without staging them. Chrome DevTools MCP
connected, but the previous world page was gone; a new headed WebGL2 world harness
was opened. Vite required the same approved socket-unrestricted execution path
already documented in CHROME_DEVTOOLS_MCP_NOTES.md. The snap-packaged rg could not
run in this sandbox, so text searches used grep after the rg failure.

Inspected the preserved sojourney-four-artifacts-02.png before recreating any view.
It shows a narrow bright water path below the obscuring ridge and a mountain hidden
by haze. This supports the existing E11 symptom; the screenshot alone cannot assign
its rendering path. The three pilot spheres were diagnostic references, and none
were recreated in the new world. No E11 closure is claimed.

**U16 isolated repro:** browser-only wrappers around all four native draw methods
read getError before and after each draw. On the actual AMD/ANGLE WebGL2 world,
switching noon to hour 23 captured glDrawElementsInstanced failing in lakeMirror,
render pass 46, with before=0 and after=1282. The flora PBR effect still declared
shadowTexture0 (SAMPLER_2D_ARRAY_SHADOW) at unit 6, while aerialPerspectiveLut
(SAMPLER_2D_ARRAY) used unit 5. A second capture recorded unit 6's bound array as
an unsigned-byte colour texture (internal ID 18, format 5), comparison mode NONE;
it was not the cascaded shadow depth texture. The atmosphere LUT samplers remained
distinct. A fresh five-light shader variant reproduced the failure, including shrub
cards; merely revisiting cached variants can hide the transient bug.

Installed Babylon 9.29 sources establish the lifecycle: light.shadowEnabled dirties
mesh lighting defines; PBRBaseMaterial.isReadyForSubMesh keeps the previous effect
while its replacement compiles when allowShaderHotSwapping is true. Meanwhile,
CascadedShadowGenerator.bindShadowLight returns early for a shadow-disabled light.
Our environment switches that property at sunset. Old shader + new binding policy
therefore leaves the comparison sampler without its expected depth array. This
explains the captured format/type failure; it does not independently prove the
earlier exact same-sampler-location message has the identical cause.

**Repair:** use Babylon's allowShaderHotSwapping=false for PBRBaseMaterial instances
in createEnvironment, both existing and added through the scene's native material
observable. Remove that observer on environment disposal. No shader rewrite or
replacement texture binder is introduced. Assets can briefly wait for a shader
variant to compile rather than draw using obsolete sampler bindings; visual motion
acceptance remains to be checked. No frame-time improvement is claimed.

With the setting applied in-browser, fresh six-light variants passed more than
21,000 draws. After integrating and reloading, all 99 inspected PBR materials had
hot swapping disabled, as did a newly cloned held material. Fresh seven-light
variants and controlled day/night/render-target transitions passed more than
114,000 draw checks with no pending or draw-generated GL errors. Renderer:
ANGLE (AMD Radeon Pro Series, radeonsi polaris11 ACO), OpenGL 4.6. Integrated
probe output is preserved under ignored tools/.cache/shots/resumption-2026-10-06/
u16-integrated-transition.json. Browser draw wrappers were restored afterwards.

Application typecheck, all 32 Bun tests and the production build pass; existing
large-chunk and ineffective-dynamic-import warnings remain. U16 retains extended
voyage, natural-sunset, optimizer-driven transitions, underwater-band and exact
sampler-location-message coverage. Firefox/Safari were not started. The controlled
renderTargetsEnabled toggles test binding lifecycle, not the optimizer's decisions.

## Verified issue regression anchors (archived from ISSUES.md)

One line each; the record matters if anything regresses (U15 was an E7 regression).

- **E20.** Automatic weather eases clear during boat dwells and resumes the schedule on departure
  (`c564a0c`, verified 2026-10-06 via MCP): rain 1.4 → 0.515 at 20 s → 0.076 at 58 s;
  departure restores rain toward the scheduled 1.0 (0.496 after 12 s). Explicit storm override
  and unattended stops verified; the shared dwell predicate also releases optimizer beauty.
- **U15.** Ordinary lake entry works in the current code (2026-10-06, MCP real-world WebGL 2
  on AMD): walked from (0,761), bed -1.183 m, into swimming at z 762.166 / bed -1.776 m; C
  dove to eye -0.518 m, Space resurfaced to +0.203 m; backing into shallows ended swimming.
  E7's deep-water entry/passive resurfacing at (300,900) also passed earlier this session.
  No speculative boundary change was needed. Harness `0471c09`; evidence in the work ledger.
- **S3.** Download percentage and network-only ETA (2026-10-06, `74fb041`); estimating,
  stalled and finishing states, cache-safe rate and retry cleanup. Typecheck/build and 30 tests
  pass; headed Chrome controlled-fixture checks cover fresh/partial/full cache, failure/retry,
  completion and matching visible/bar/ARIA progress. Details in the current work ledger.
- **E5.** Touch prompts said "Enter" — key named only on keyboard (`src/play/Play.ts`), "Let go" /
  "Hold" / "Hold to reel" on touch.
- **E6.** Release day length — `dayLengthMinutes` 120 (`src/core/Settings.ts`); clock and boat run at
  that pace (0.0168 game hours in 5 s).
- **B3.** Leftover biome fields — `terrain` is only `worldSizeMetres`, `water` only `colour`; old
  URLs, `water.level`, lake-seed and lake-bed fields gone from biome and `Biome` type. Still carried
  but read by nothing (may be plans, not leftovers): `flora`, `groundCover` (with forage), `fauna`,
  `ingredients`, `recipes`, `lighting`, all of `climate` but `weatherSeed`.
- **E7.** A swimmer could not surface — float level 0.25 m above the surface (`FLOAT_HEIGHT`,
  `src/engine/player/PlayerController.ts`); C dives, Space or letting go surfaces (3.5 s from
  3.4 m). The later U15 report was rechecked through shore entry and T3 below.
- **Q2 (ground/forest half).** Rain fog skips what it hides (`rainHides`, `Fog.ts`; under a
  thousandth of colour, 228 m in full rain; high ground kept longer) — measurements in R7.
- **P2 (checker).** `python3 tools/check_ship_deck.py` passes (59.7 m² deck, none floorless, no rail
  inside a deck, bow closed).

- **P4.** Interrupted near-pack compression repaired (2026-10-06, `1b91cc3`): 146 → 1,311 valid
  GLBs; `build_ground.py --resume-near` checks cached IDs/bounds and writes atomically. Pack/travel
  verification is in ISSUES section D; generated files stay ignored. U18/U13/U17 still need their own checks.
- **S4.** Same-size asset changes now invalidate the pack cache (2026-10-06, `b2663e9`):
  `build_pack_index.py` includes content hashes, not only paths/sizes; the real-indexer regression
  verifies different five-byte files yield different versions and an unchanged rerun is stable.


## Resumed issue work — order, submerged objects and T3 swimming

Starting commit cb9494e. Reviewed the ranked plan against ISSUES and installed
Babylon 9.29.0. S3, U15 and E20 first slices were already verified; E8 awaited
visual judgment; E12 object dimming was the remaining bounded lighting change.
R5 precedes further shader acceptance; R6/R7 stay ahead of larger authoring and
missing gameplay. Full R0/Q1/Q4 baseline inventories are still incomplete. Closed
entries have moved from ISSUES to the regression anchors above, and active plan/
section references were updated. Sign-off items remain in ISSUES.

**E12 implementation:** WaterDepthMaterialPlugin uses Babylon's material-plugin
API, priority 700 after Atmosphere's 600, and shares the already-uploaded lake
mask. It applies the existing bed's 40 m e-folding depth at each fragment's world
height, including thin instances and surface-straddling geometry. Directional/
hemispheric light and sky reflection terms attenuate; point/spot light and emission
are untouched. Terrain and the lake surface are explicitly excluded. The native
scene material observable covers imported materials and later play clones and is
removed on scene disposal. Native Scene.addMaterial notifications are deferred;
the clone acceptance waits for that notification. No runtime asset baking occurs.

Read installed materialPluginManager, MaterialPluginBase, PBRMaterial.clone,
lightFragment GLSL/WGSL, pbrBlockFinalLitComponents and AtmospherePBRMaterialPlugin
before implementation. NME MCP PBR block discovery was used to check the available
operation: it authors separate NodeMaterials, not custom hooks in existing stock
PBR shaders. The earlier E8 pilot already established the atmosphere composition
gap. No suitable material-plugin authoring tool is exposed; native plugin glue
preserves the existing atmosphere/PBR contract rather than replacing the material.

**Rendered-pixel test:** harness/waterDepth.html isolates sun, hemispheric sky,
point lamp and emission without scene fog/exposure. The same material is sampled
above the surface, at 30 m, at 140 m, and on dry terrain below lake elevation.
RGB channel readings on both AMD WebGL2 and WebGPU are:

| Light path | Above | 30 m | 140 m | Dry at -140 m |
|---|---:|---:|---:|---:|
| Sun | 147 | 104 | 30 | 147 |
| Hemispheric sky | 183 | 130 | 37 | 183 |
| Point lamp | 109 | 109 | 109 | 109 |
| Emission | 136 | 136 | 136 | 136 |

A box spanning the surface with one material reads 147 above and 47 at 100 m
below; its origin is fixed. The test asserts clone inheritance and water-material
exclusion. These pixel values include native output encoding; they are not linear
light ratios. Sharing the mask avoids a duplicate texture upload but adds one
sample/binding to object PBR shaders. No frame-time improvement is claimed.

**Browser method:** headed Chrome DevTools MCP on AMD. The ordinary MCP browser
exposed no WebGPU adapter, so a temporary stdio MCP session used documented
--chrome-arg options for enable-unsafe-webgpu, Vulkan, use-angle=vulkan and
ignore-gpu-blocklist. This is browser-test configuration, not a shipped feature
switch. Babylon's isWebGPU property/describeBackend identify the backend;
getClassName is inherited and cannot reliably do so. WebGPU reports amd/gcn-4,
validation scope null. The integrated world rendered at noon and hour 23 near
(1424, -25.4, 3274.2): 87 object materials attached, 301 ready submesh effects
contain the depth code, swimmer state true, no captured console messages and no
WebGPU validation errors. The same integrated day/night cases passed on WebGL2
through ANGLE/Vulkan RADV POLARIS11: 87 materials, 301 ready effects, native GL
error 0, and no captured console messages. Test transport/output files are temporary under /tmp;
accepted evidence is recorded here. This is bounded shader/runtime acceptance,
not the extended natural-sunset voyage or the lead's appearance approval.

**Swimming recheck:** lead recalled walking on water at T3, Llao Rock. The current
full-world WebGL2 harness was checked at its actual travel point (1424,3,3274.2),
with bed about -166.15 m. It falls into swimming and floats with eye about
0.20–0.25 m above the water. Forward motion remains swimming rather than grounded.
C dives to eye -16.40 m; Space surfaces to +0.20–0.24 m while remaining swimming.
The shore route from (0,761) also transitions at z 762.31 / bed -1.85 m, stays
swimming while moving out and uses the authored 1.2 m/s stroke speed. Native GL
error reads zero. No player code was changed: the reported failure was not
reproduced on these routes. These checks cannot prove every entry route safe.

**Remaining:** E12 lead dive/flashlight visual sign-off; U16 extended voyage,
natural sunset, optimizer transitions and exact sampler-location message; Q1/Q4
complete baselines/reviews. Neither compilation nor isolated pixel tests close
those gates.

Application and water-depth harness type checks pass, all 32 Bun tests pass,
and the production build passes with existing chunk/dynamic-import warnings.

## Lead-requested Scene optimization comparison toggle

Added a persistent On/Off choice beside target FPS, default On. The lead explicitly
authorized this exception to the one-performance-input rule on 2026-10-06; AGENTS
and the active plan preserve it for later settings reviews. Off disposes the active
native SceneOptimizer and restores clear haze, native resolution, bloom/sharpening/
AA, shadows, particles and render targets. On starts a fresh sample/retry window.
Reset returns to On. The scene interval is cleared on disposal; queued completion
callbacks check optimizer identity so an old run cannot finish a newly started one.
Installed SceneOptimizer.stop/dispose/_checkCurrentState were read before editing.

Headed Chrome DevTools MCP / AMD WebGPU exercised the real settings buttons after
seeding degraded settings. Off restored scaling 1, haze 0, bloom/sharpening true,
samples 4 and scene shadows/particles/renderTargets true immediately, and held
these values for 16 seconds. Saved Off survived a reload; On and Reset to defaults
both restored the On setting. No captured console warnings/errors. Typecheck, all
32 Bun tests and build pass, with existing build warnings. Browser transport/log
are temporary; raw MCP evidence is retained in the ignored shots cache.

## Lead playtest: view-directed swimming and sinking

The lead demonstrated the defect in the actual game near Cleetwood, at
(4751.87,4212.02), lake bed about -19.56 m. Headed Chrome DevTools MCP captured
swimming=true and grounded=false: looking down and holding W left vertical
velocity exactly zero, while C descended. After release, eye height rose from
-7.55 to -4.80 m without upward input. The earlier C/Space checks established
those dedicated controls only and did not verify view-directed swimming. Their
passive-resurfacing expectation is now superseded by the lead's explicit choice.

Changed forward/back swimming to use view pitch with normalized 3D stroke
velocity; walking retains the horizontal basis. The entry/exit state is decided
before choosing movement speed/basis. Removed automatic buoyant ascent and
stationary vertical locking. Idle motion accelerates under gravity opposed by
linear water resistance, while strokes drive the requested direction. The native
PhysicsCharacterController still handles movement/collisions and surface contacts.
Installed characterController.integrate/_integrateManifolds/_resolveContacts have
no fluid or damping setting; this bounded desired-velocity calculation is gameplay
input to the native controller, not a replacement physics/collision engine.

The analytical linear-drag update uses 9.81 m/s² gravity and authored resistance
16/s, giving an idle terminal sinking speed about 0.61 m/s. This is a gameplay
model, not a calibrated human-fluid simulation. Unit tests verify idle downward
acceleration, bounded terminal speed, equal results across subdivisions, upward
strokes/release and pitch direction with no diagonal speed bonus. Space swims up;
C dives; looking down/up with W dives/climbs. The existing surface clamp prevents
a swimmer being launched into the air. Touch Dive now shows while swimming at the
surface as well as submerged, and the jump control is titled Swim up in water.

At the same real-game location after the change: idle eye -3.42 -> -4.90 m,
vertical velocity -0.613 m/s; looking down + W reached -8.99 m at -1.623 m/s.
Space returned the eye to +0.246 m; release sank to -0.339 m at -0.613 m/s.
All samples stayed swimming and ungrounded. These are real scene/physics checks
on AMD WebGPU through the persistent headed MCP session, not teleported-camera
shader checks. Existing player-step time capping remains: at very low FPS it
can advance less simulation time than wall time; the analytical drag law itself
is independent of subdivision. No performance claim or breath/recovery closure.

Typecheck, all 35 Bun tests and build pass. E15 remains in the visual acceptance
group; the plan/E14 references now record idle sinking as a settled choice.

Looking up + W independently climbed from eye -3.006 to -1.856 m in 3 s,
with upward velocity +0.397 m/s and swimming=true. Touch Dive was present during
the swimming check. The live game is left open for the lead's own acceptance.

## Lead-requested highest/deepest debugging travel points

Appended Highest point (debug) and Deepest point (debug) at indices 7/8 in
Crater Lake's existing places list, preserving all prior destinations and their
indices. No new travel mechanism: the native Babylon camera travel animation and
existing ground/forest preparation, collision-height clamp and announcement run
unchanged. Updated the edited biome's old passive-floating comment to sinking.

Scanned assets/crater-lake/terrain/source/heightmap.bin (9001² uint16 samples)
using its heightmap.json datum and grid spacing. Maximum at row 6485, col 7071:
(x,z)=(5142,-3970), +604.496 m lake-relative. Minimum at row 3660, col 7060:
(x,z)=(5120,1680), -593.145 m. Destinations request eye height +606.5 and -591.1 m,
about 2 m above the source surface; runtime collision clamping remains in place.

Headed Chrome DevTools MCP exercised actual player.travel(7) and travel(8).
Highest landing: eye +606.5 m, collision ground +604.274 m, swimming=false.
Deepest landing: eye -591.100 m, collision ground -593.132 m, swimming=true.
Typecheck/build/diff checks pass. This is completed debugging support rather than
an unimplemented item for ISSUES. No new assets or licensing changes.

## Lead playthrough — U16 deferred until beauty/assets are complete

On 2026-10-06 the lead reported a generally good playthrough including the boat tour,
highest peak and deepest depths, and requested striking through the next U16 coverage
item to revisit after the remaining beauty and asset work. U16 remains an outstanding
verification gate; the report supplies no backend, console or controlled sunset/optimizer
evidence. R6/R7 become the next active investigations. The deepest visit still left the
flashlight unhelpful, reinforcing E23’s deep-water acceptance check. The wish for a
wingsuit or hang glider is feedback, not authorization to implement a new activity.

## R6/U7 — stationary flora fade completion and underwater invalidation

Chrome DevTools MCP opened the real world harness in headed Chromium. Renderer:
ANGLE (AMD Radeon Pro Series, radeonsi polaris11 ACO), OpenGL 4.6, WebGL2.
WebGPU reported “No available adapters”; no WebGPU parity claim is made.

On an actual loaded fir_b record (leaf 1137, record 155), the production sort was
isolated to one record to avoid other active fades masking the defect. Starting at
7 m selected LOD0; moving to 9 m began an outward LOD0→LOD1 fade. Reversing to
3 m during the fade and stopping let the old goal complete at LOD1. Both continuation
conditions (fading and fadesUntil) then expired: no distance recheck occurred until
further camera movement. This is a reproduced wrong-LOD lifecycle defect, not proof
that the original shot-32 pine had exactly this trigger.

Read installed Babylon 9.29 DitheredTileFadeMaterialPlugin source: it already supplies
per-mesh/thin-instance bounds, packed-buffer validation, material-generation checks
and framebuffer Bayer coverage. Keep the stock plugin. The available Babylon MCP
operations author NME materials; none manages this application-owned streaming/sort
lifecycle. No shader or alternative fade implementation was introduced.

Repair in flora.ts schedules one more sort after fade completion so a changed
camera distance is reconciled before resting. Mode changes (water entry/exit) also
invalidate the near sort; immediate underwater selection ignores the old fade goal.
Half-second fades, hysteresis and drawn quality remain unchanged.

Regression anchor: from /harness/world.html with loaded trees, import
/harness/floraTransitions.ts and call verifyFloraTransitions(window.__flora).
The probe executes the production sorter and Babylon instance-buffer setters,
restores its record/state, and invalidates draw lists for rebuilding. Seven checks
pass: complementary outgoing levels, completion recheck, reversal settling at LOD0,
full settled coverage, underwater cancellation of an obsolete goal, no unnecessary
stationary sorting, and mode-change invalidation at rest. Output is cached at
tools/.cache/shots/r6-flora-transitions/regression.json. A live-camera 7→9→3 m
travel smoke sample stayed at LOD0 on arrival (24 samples, full resolution); that
sample did not capture an active fade and is not motion acceptance evidence.

Application and probe typechecks pass; all 35 Bun tests pass; production build passes
with existing chunk-size/dynamic-import warnings. No frame-time improvement is claimed.
U7 retains the original pine/teleport recheck and WebGPU coverage. U13 auxiliary-pass,
prop and 600 m handover work, U17's actual corrupt-frame capture, and U18's exact
foothill diagnosis remain open. U16's deferred voyage timing is unchanged.

## R6/U13 — ground fade cancellation on water entry (2026-10-07)

Starting commit: `be59d1d`. The ground selector retained an active fade's goal
before checking whether fades were disabled underwater. A synthetic 0→1 fade
reversed to 3 m reproduced selecting LOD1 when immediate selection should give
LOD0. This mirrors the previously repaired flora lifecycle, but ground updates
every frame and does not have flora's stationary-sort scheduling defect.

Repair: only preserve active goals and fade hysteresis while fades are enabled.
Immediate selection uses current camera distance/zoom and retains the missing-near
LOD2 fallback. Above-water fades still finish before rechecking distance. Installed
Babylon 9.29 DitheredTileFadeMaterialPlugin remains responsible for coverage;
its source confirms that standalone shadows/depth passes are outside its contract.
Callable Babylon tools cover NME graph authoring, not application-owned LOD selection;
no matching Babylon MCP operation exists for this change. Browser checks use Chrome
DevTools MCP in headed Chrome 154 on AMD/ANGLE radeonsi polaris11 ACO, WebGL2,
1042×601, hardware scaling 1.

Regression anchor: import `/harness/groundTransitions.ts` from the world harness
and call `verifyGroundTransitions(window.__ground.stream, window.__scene)`.
The probe uses the production selector and stock Babylon mesh bounds with isolated
leaf/block fixtures; it starts no loads, moves no player, and disposes its diagnostic
meshes. The reversal assertion fails before the repair. Seven checks pass afterwards:
active above-water reversal, underwater cancellation/current-distance selection,
full leaf coverage, outward block ownership, resuming fades on exit, completed
leaf/block ownership, and missing-near fallback. MCP output is preserved at
`tools/.cache/shots/r6-ground-transitions/regression.json`; the MCP file-output
root rejected the repo path, so its returned output was saved through the workspace
file tool. This is selector/binding evidence, not rendered-pixel or motion acceptance.

Application and standalone probe typechecks, production build and all 35 Bun tests
pass. Existing build chunk-size/dynamic-import warnings remain. No performance
improvement or WebGPU parity is claimed. U13's shadow/props/600 m handover,
U17's checkerboard capture, U20's quilting and U18's foothill remain open;
this does not establish any of those visual reports' root cause.

## R7/Q3 — skip distant sky behind the water volume (2026-10-07)

The production world in headed Chrome DevTools MCP reproduced active sun/cloud meshes
while the diver's opaque water volume covered the view. Installed Babylon 9.29 source
(`scene.pure.js`, `atmosphere.js`) confirms that layer masks reject active meshes before
submission and a negative Atmosphere.skyRenderingGroup skips only sky composition.
Atmosphere.setEnabled would also remove required lighting/LUT behavior, so it is not used.
Available Babylon MCP tools author NME graphs, not camera masks or atmosphere pass state;
no matching Babylon MCP operation exists. All browser inspection used Chrome DevTools MCP.

`skyLayer` registers distant geometry in a WeakSet; the fallback dome is registered too.
The environment saves/restores each mesh's layer mask and the original compositor group
only on water entry/exit. Weather and astronomy continue updating enabled states while
submerged. The world sync runs after Underwater.update but before active-mesh evaluation,
so restoration has no extra frame delay. Local rain/lighting/physics/audio and atmosphere
irradiance remain active. All asynchronous sky assets are ready before rendering starts.

Renderer: headed Chromium 154, ANGLE AMD Radeon Pro Series, radeonsi polaris11 ACO,
OpenGL 4.6/WebGL2, 1042×601, hardware scaling 1. Matched draws at (4950, -30, 1705)
by day, and (4950, -0.2, 1705) by day and night have zero changed pixel channels when
hidden sky is suppressed. Simulation callbacks and image-processing dither were temporarily
frozen for the comparison, then restored. Day sun/cloud submission falls from 57 to 54
draws; night clouds/moon/stars/Milky Way falls from 59 to 54. The missing draw beyond
the sky mesh count is the compositor. Layer masks and compositor group restore on the
first surfaced render at y=2, with current night or day sky enabled states. A y=-490
entry suppresses sky and the water top, and resurfacing restores both. GL error is 0;
no captured console warnings/errors. This is Chromium WebGL2 evidence, not backend parity.

Babylon GPU timer results in two alternating A/B pairs vary: 30 m day medians are
22.96/22.54 ms, then 22.53/22.61 ms (hidden/visible order in the second pair).
Shallow night medians are 20.62/20.74 ms, then 20.01/20.43 ms; shallow day pairs
are 21.05/21.50 ms, then 21.64/21.03 ms. Only 7–8 completed timer queries per
36 rendered frames. Reduced submissions are established; no repeatable overall GPU-time
gain is established, and the old ~3 ms sky-cost estimate is not reused.

Regression anchor: stop the world harness render loop, disable physics for a fixed view,
enter water through player.teleport, render twice, then import `/harness/underwaterSky.ts`
and call verifyUnderwaterSky(window.__scene, window.__environment). The probe compares
production visibility toggles with pixels, active meshes, draw counts and the existing
engine GPU counter, restoring diagnostic overrides in finally. MCP results are cached at
`tools/.cache/shots/r7-underwater-sky/regression.json` (uncommitted).
The pixel probe warms the nondithered effect for 12 yielded frames: a fresh-harness
rerun before that warmup showed a transient two-byte-level pixel difference while
effects settled. The final probe passes again at 30 m with zero changed channels;
its alternating draw counts remain 57/54/54/57. This timer rerun also shows no
overall GPU-time gain (22.63/22.96/22.87/22.53 ms).

Application and probe typechecks, production build and all 35 Bun tests pass. Existing
chunk-size/dynamic-import build warnings remain. No new assets/licensing changes. Q3's
depth-hidden tree/prop work and lead dive sign-off stay open; Q2 rain/mirror work and
deferred R5 backend coverage are not closed by this slice.

## R7/Q3 — whole-cell flora hidden by water depth (2026-10-07)

Starting commit: `6d448f7`. Rain culling bounds use horizontal cell distance plus
an elevation-dependent sky-veil test. They can retain submerged plants/rocks or
surface flora hidden vertically by the opaque water volume. Prop culling already
uses three-dimensional distance and is not duplicated. An initial forced-camera
350 m probe near Cleetwood was below the subsequently loaded lake bed; that view
is excluded from acceptance/performance evidence. Valid checks below use ordinary
teleport with collision loaded (bed about -76.51 m at 4725, 4100).

Installed Babylon 9.29 sphere builder confirms the opaque BACKSIDE volume's
outer radius; scene source rejects disabled meshes before submission. Flora uses
Babylon's raw bounding sphere for each authored level, enlarged about the model
origin by center.length + radius. Placement decoding aggregates scaled enclosures
into each cell's minimum/maximum height once, covering uniform scale and rotation
without new per-record arrays. Near lists skip wholly hidden cells with 0.25 m
travel slack; far/middle lists use their existing 25 m rebuild slack. Cells that
intersect the volume stay conservative. Existing batching, streaming, collisions,
lighting and stock dither plugin remain. Water-radius changes invalidate all three
lists at rest. Underwater reach is now computed from the current eye/settings,
like the radius, so sky-notification consumers do not inherit the previous surface
state's distance/fade inputs during entry/exit.

Callable Babylon MCP tools cover NME material graphs; none performs this
application-owned instance-list/visibility operation. No new shader was authored.
All browser work uses Chrome DevTools MCP, headed Chrome 154 on ANGLE AMD Radeon
Pro Series/radeonsi polaris11 ACO, WebGL2, 1042x601, hardware scaling 1.

Regression anchor: stop the world harness loop, disable physics for a fixed view,
load collision/flora through player.ground.prepare, teleport into water, render
twice, import `/harness/underwaterFlora.ts` and call
verifyUnderwaterFlora(window.__scene, window.__flora, window.__environment).
The probe freezes simulation and image dithering, compares production lists with
finite/infinite water radius, reads pixels and draw counts, checks conservative
height boundaries, and verifies stationary list restoration. It restores its
overrides in finally. Cached MCP evidence:
`tools/.cache/shots/r7-underwater-flora/regression.json` (uncommitted).

At (4725, -70, 4100), visibility 5 m (volume radius 15 m), 18 rock/plant instances
become zero and total draws fall 54 to 50 with zero changed pixel channels. A day
view facing the bed and night view looking upward with the existing flashlight
at a diagnostic intensity both pass. This is not flashlight product acceptance.
At 30 m with visibility 5 m, the intersecting cells retain all 18 instances.
At default visibility 40 m, the tested 30/70 m views retain about 1,600 instances,
with unchanged pixels and submissions: conservative volume culling is not a
complete per-record water-fog culler. No total GPU-time/FPS gain is claimed.

A production -70 m → 2 m → -70 m entry/resurfacing check now forwards the
current radius/reach/fade mode on the first render. The near-dock instance count
is 0 → 95,489 → 0; both piers and the ship disable/enable/disable accordingly.
Before the reach getter repair, that transition inherited surface reach and
submitted 20,726 flora instances on re-entry. Final GL error is 0, with no
captured console errors/warnings. The stationary radius-only restoration in the
pixel probe restores exactly its baseline counts, independently of camera travel.

Remaining Q3 work: individually hidden records in intersecting cells, separately
drawn play flora, broader moving-prop/shadow coverage and lead dive acceptance.
Q2 rain/mirror work and deferred WebGPU/WebGL voyage parity remain open. Application
and standalone probe typechecks, 35 Bun tests and production build pass; existing
chunk-size/dynamic-import warnings remain. No assets/licensing changes.

## R7/Q3 — vertical depth-hidden records inside intersecting flora cells (2026-10-07)

Starting commit: `256debf`. Whole-cell bounds leave individual hidden records submitted when
other records in the same cell cross the water volume. Near sorting now tests each placement's
vertical enclosure from the existing Babylon raw-sphere radius across all authored LODs,
scaled by the placement matrix's uniform scale. Far/middle paths compact contiguous surviving
ranges into their existing Babylon thin-instance buffers. Above water retains the single bulk
copy. Near records use 0.25 m camera-travel slack; far/middle use 25 m. Hidden near records clear
obsolete fade state and reappear at their current LOD with full coverage. No geometry, material,
collisions or asset authoring changes. This is conservative vertical culling, not spherical or
lateral occlusion; oversized bounds deliberately retain uncertain records.

Inspection also found that invalidating midAt on water-radius changes did not rebuild middle
lists when rain reach was infinite. update now rebuilds an invalid middle list in clear air and
follows submerged camera travel after 25 m, independently of rain. Resurfacing restores it too.

Installed Babylon 9.29 BoundingSphere source confirms center/radius construction and placement
scale behavior; existing raw bounds cover all authored LODs. Callable Babylon MCP tools cover
NME graphs, not application-owned instance-list selection/compaction. No new shader was needed.
Browser inspection and verification used Chrome DevTools MCP, Chrome 154, AMD Radeon Pro Series
through ANGLE/radeonsi polaris11 ACO, OpenGL 4.6/WebGL2, 1042×601, hardware scaling 1.

Regression anchors:

- Import `/harness/underwaterFloraRecords.ts` and call verifyUnderwaterFloraRecords(scene).
  Eleven checks exercise the production selector/compactor with mixed-height records in one
  intersecting cell: retained ordering, touching bounds/travel margins, uniform scale, near fade
  reset, Babylon instance-buffer restoration, and clear-air middle-list radius/travel invalidation.
  The synthetic diagnostic mesh is disposed afterwards.
- Existing `/harness/underwaterFlora.ts` fixed-view pixel probe passes at (4725, -depth, 4100),
  with ordinary player.teleport after ground.prepare and player.update, physics/render loop stopped.
  It freezes simulation and image dithering for each comparison, then restores them. Twelve
  matched views cover 5/10/30/40/50/60/70 m depths, day/night, and visibility 5/10/20/40 m;
  every comparison has zero changed pixel channels and restores baseline instance counts.
  These cases sample production shadow passes, not complete moving-shadow acceptance.

At 50 m depth with visibility 5 m, day and night both reduce 18 instances to 2 and total draws
54 to 52. Disabling only the new record predicate leaves 17 instances under the existing
whole-cell culler, establishing an additional 15-record removal from intersecting cells.
At 5 m depth/visibility 5 m, 18 instances become 5 and 56 draws become 54. At 40 m/5 m,
18 become 17; at 60 m/10 m, 18 become 12; at 60 m/20 m, 150 become 145 (draw counts unchanged).
At default visibility 40 m, sampled 10/30/70 m views retain their 1,602–1,603 instances and
pixels. No repeatable overall GPU-time/FPS gain is established or claimed.

Production -50 m → 2 m → -50 m entry/resurfacing restores counts 2 → 95,489 → 2, with the
water volume enabled/disabled/enabled. GL error is 0; no console warnings/errors captured.
Cached MCP evidence: `tools/.cache/shots/r7-underwater-flora/records-regression.json` (uncommitted).
Application and standalone harness typechecks, all 35 Bun tests and production build pass;
existing build warnings remain. No new assets/licensing changes.

The vertical per-record subset is completed and removed from Q3's remaining work. Q3 stays
open for lateral-hidden records retained by conservative bounds, separately drawn play flora,
broader moving props/shadows/dive coverage and lead acceptance. Q2, Q1/Q4 and the lead-deferred
backend/Firefox/Safari gates remain open. ISSUES.md and the resolution plan now agree on this scope.

## R3/E23 — widen and soften the flashlight (2026-10-07)

Installed Babylon 9.29 `spotLight.pure.js` defines angle as the full cone angle;
`light.js` maps automatic spot intensity to luminous intensity (candela), scale 1.
`pbrDirectLightingFalloffFunctions.js` keeps physical angular falloff at 1 on-axis
regardless of cone angle. Therefore no intensity multiplier is needed. Play now
uses `2 * atan(2.5 * tan(0.4 / 2))`, or 0.93810596 rad, for exactly 2.5 times
the previous geometric width at matched distance. The first comparison preserved
intensity; the lead then requested a 25–50% reduction because the larger beam
looked washed out. The final change reduces both intensities 40%, from 800/300
to 480/180 (land/water). Range, color and stock PBR light falloff are preserved.
No shader, material or asset changes.
Available Babylon MCP tools author NME graphs and have no spotlight-parameter
operation; all rendered verification used Chrome DevTools MCP.

Regression anchor: stop the world harness render loop, import `/harness/flashlight.ts`,
and call `verifyFlashlight(worldHarness.scene.getLightByName("flashlight"), [480, 180])`.
The probe copies production light parameters into a separate Babylon scene with
a matte panel 10 m away, uses linear 256-square render-target pixels, compares
old/current cones at both production intensities, and disposes all probe resources.
Rendered preparation precedes readback; effect compilation alone yielded black
pixels in the initial probe and is insufficient. Initial full-output results:

| Intensity | Old peak / half-brightness width | New peak / width | Width ratio |
|---|---|---|---|
| Land, 800 | 108 / 50 px | 108 / 114 px | 2.28 |
| Water, 300 | 69 / 48 px | 69 / 114 px | 2.375 |

Final reduced-output rerun (the old cone also uses reduced intensity here):

| Intensity | Old-cone peak / half-brightness width | New peak / width | Width ratio |
|---|---|---|---|
| Land, 480 | 85 / 50 px | 85 / 114 px | 2.28 |
| Water, 180 | 55 / 48 px | 55 / 112 px | 2.333 |

Thus widening itself preserves on-axis illumination, while the requested power
reduction lowers measured peak pixels from 108/69 to 85/55. Pixel encoding is
nonlinear; a 40% intensity reduction does not mean a 40% byte-value reduction.

Renderer: headed Chrome 154, ANGLE AMD Radeon Pro Series / radeonsi polaris11 ACO,
OpenGL 4.6 / WebGL2, 1042×601, hardware scaling 1. The isolated panel establishes
coverage and brightness; it is not underwater visual acceptance or backend parity.

Matched production screenshots through MCP compare old/new cones at night, looking
down with pitch 1.1 rad. Deepest eye is (5120, -591.1, 1680), loaded collision bed
-593.131958 m, underwater=true, intensity=300. Highest land eye is
(5142, 606.5, -3970), bed +604.274048 m, underwater=false, intensity=800.
Normal ground.prepare/teleport/player.update establishes each placement; physics
and the render loop are paused for fixed-view comparisons. Scene optimization is
off via its authorized comparison setting. Both views show substantially broader
coverage; the bright close-range center present in the old beam remains in the
new one. Production off/on intensity is 0/800 on land; resurfacing from the deep
view restores the land intensity. After the lead's reduction request, both exact
views are rechecked: deep intensity=180, land intensity=480 and off=0. Screenshots
show softer broad coverage, with bright close highlights still present. Final
GL error is 0; no console errors/warnings in either run.

Application/probe typechecks, all 35 Bun tests and production build pass. Existing
chunk-size/dynamic-import build warnings remain. E23 moves from open implementation
to section B sign-off; lead width/brightness/deep-usefulness acceptance remains open.
No WebGPU/Firefox/Safari coverage or performance gain is claimed. R6/U13/U17/U20
and the lead-deferred U16 gate remain unchanged.

## R6/U13 — publish full-file and middle-card ownership together (2026-10-07)

Starting commit: `d171850`; installed Babylon core 9.29.0. Full-file arrival marks
flora lists changed, but the middle rebuild waits for the load queue or its one-second
cadence. Camera travel can rebuild the full lists sooner and leave the previous middle
cards drawing too. Release invalidates the full lists immediately, while the same
throttle can leave middle cards absent. These are application list-publication defects,
not evidence of a shader or dither interval failure.

Before any edit, Chrome DevTools MCP reproduced the arrival/travel overlap with
production loadNear/update/buildFar/buildMid methods and actual Babylon thin-instance
buffers. A two-record full file became the full-list owner while its one-record middle
file remained enabled. The probe simulates a remaining load and a 30 m camera move,
inside the one-second upload cadence. Renderer: ANGLE AMD Radeon Pro Series,
radeonsi polaris11 ACO / OpenGL 4.6, WebGL2. Browser headed/headless mode was not
independently established in this session; no appearance or timing claim follows.

update now publishes pending middle changes whenever the full lists rebuild early,
consuming the pending change once. The existing stationary arrival batching remains;
when that batch publishes, both lists change together. No additional buffers, shaders,
materials, assets or shipped controls. The installed Babylon thin-instance setter and
partial-update source were inspected; stock buffer ownership/upload is retained.
Callable Babylon MCP tools cover NME graphs, not these application-owned lists.

Regression anchor: import `/harness/floraOwnership.ts` and call
verifyFloraOwnership(scene). Eight checks cover the unloaded sole owner, arrival plus
travel during another load, same-update release/restoration, stationary batching and
expiry, already-loaded preparation caching, publication of unrelated middle changes,
and queue completion. All eight pass on the final code with Babylon NullEngine through
Bun and through Chrome DevTools MCP on AMD WebGL2, GL error 0. Final browser probe
canvas: 300x150, hardware scaling 1; these empty diagnostic meshes exercise actual
GPU instance buffers/counts, not appearance. The world harness reached ready too.

The WebGPU engine-creation probe stalled; subsequent MCP evaluation/navigation
attempts were delayed, so the final probe was also run locally with NullEngine.
For that fallback, set document.baseURI just for importing the browser asset-URL modules,
then remove the document stub before constructing/disposing NullEngine. This verifies
production selection and Babylon CPU buffer/count state, not GPU rendering. The delayed
MCP WebGL2 result subsequently returned all eight passing checks and worldReady=true,
and the navigation recovered. Full-world motion acceptance remains open; no WebGPU
parity or performance result is claimed.

Application and standalone harness typechecks, all 35 Bun tests and the final production
build pass. Existing dynamic-import/chunk-size warnings remain. ISSUES.md and the
resolution plan track this completed ownership subset and its evidence limits. U13
remains open for timed props/card handover, shadow/SSAO coverage and motion acceptance;
U7, U17, U18 and U20 are not closed. No asset/licensing changes.

## R6/U7/U13 — discard near transition state on cell reentry (2026-10-07)

Starting commit: `39a921c`; clean `main`, Babylon core 9.29.0. The previous
ownership repair publishes full/middle lists together. A separate boundary remained:
buildFar removes a cell from near sorting without clearing its saved shown/fadeStart
state. Its far mesh draws the last LOD whole, but returning to the near sorter can
resume an obsolete outward fade. Whole-cell rain/water hiding retains the same state;
the prior per-record water repair did not cover these branches.

Before the implementation edit, Chrome DevTools MCP reproduced this with production
buildFar/sortNear: start LOD0 at 7 m, begin the outward switch at 9 m, hand ownership
to the far list at 100 m, then return to 3 m before the fade's half-second expiry.
The current-distance/full-coverage assertion failed because the old goal resumed.
This establishes another stale-transition trigger, not the original shot-32 pine,
reported popping or U17's checkerboard flash.

Cells assigned to far lists or wholly hidden by rain/water now reset shown to 255
and fadeStart to -1 over only their record range. Whole-cell hiding in sortNear
also resets before the next far-list rebuild. Reentry uses the existing first-sort
distance selection and uploads [0, 1] through Babylon's stock fade plugin. Cells
that remain near keep their active fades and settled hysteresis. No shaders,
materials, assets, quality controls or engine features change. Installed Babylon
thin-instance storage and DitheredTileFadeMaterialPlugin source were inspected.
Callable Babylon MCP tools author NME graphs; no matching streaming-list operation
is exposed. Browser verification uses Chrome DevTools MCP.

Regression anchor: import `/harness/floraReentry.ts` and call
verifyFloraReentry(scene) with an existing Babylon scene. Its synthetic placements
exercise actual production builders/sorter and Babylon GPU instance/fade buffers,
then dispose their meshes/material. All 17 checks pass: outward-fade fixtures,
far-list sole ownership, far/depth/rain/near-sort-hidden reentry, full-coverage
attributes, neighboring record preservation, uninterrupted fade timing and settled
hysteresis. Existing floraOwnership (8) and underwaterFloraRecords (11) MCP checks
also pass. This isolates lifecycle/buffer state with empty diagnostic meshes;
it does not establish rendered forest appearance, motion or frame-time improvement.

Browser context: Chrome 154, ANGLE AMD Radeon Pro Series / radeonsi polaris11 ACO,
OpenGL 4.6 / WebGL2, 1042×601, hardware scaling 1. The probe used the existing
terrain-material harness scene; GL error 0 and no console errors/warnings. Browser
headed/headless mode was not independently established. Pack files/index remain
unchanged; synthetic placements have no gameplay clock/weather or optimizer state.
No WebGPU/Firefox/Safari or extended voyage check is claimed; the deferred U16
gate and all outstanding U7/U13 visual/backend checks remain open.

Application and standalone probe typechecks, all 35 Bun tests and production build
pass. Existing dynamic-import/chunk-size build warnings remain. ISSUES.md and the
resolution plan record this completed subset, preserving the remaining sign-offs
and investigation branches. No issue is closed merely from this bounded regression.

## R6/U13 — timed ship and pier level coverage (2026-10-07)

Started on `b7005ef`; setup-note commit `dd20c06` landed independently during this
slice. Before edits, Chrome DevTools MCP inspected the real ship in the WebGL world:
Babylon selected LOD0 at 59.99 m and LOD1 at 60.01 m, with no timed transition.
Its actual shipped thresholds are 60/180/500 m. This demonstrates the explicitly
uncovered prop path; it does not identify the reported forest/terrain pop or U17.

Installed Babylon 9.29 Mesh.getLOD, InstancedMesh.getLOD, active-mesh selection,
ObjectRenderer visibility filtering and DitheredTileFadeMaterialPlugin source were
read. The native selector immediately returns one mesh. The stock plugin supports
independent ordinary-instance bounds and color/integrated-prepass coverage, excluding
standalone shadows/depth/custom passes. The active catalog exposed NME graph tools
but no corresponding instance-placement operation; Chrome DevTools MCP supplied
browser verification. The separately repaired editor-server configuration is recorded
in NME_NOTES.md; its additional tools require session refresh.

Prepared prop geometry now has a separate disabled native Babylon LOD selector.
Each placement owns ordinary instances of all authored levels; their sources have
no automatic LOD chain to replace the level mid-fade. The production controller
applies complementary stock-plugin intervals to every shipped submaterial over
500 ms, finishes active fades before rechecking reversed distance, and uses a
five-percent inward hysteresis gap. Initial placement and hidden reentry select
the current level at full coverage; submerged lake entry cancels a fade and selects
the current distance immediately. World culling still enables/disables the whole
prop through its existing child-mesh snapshot. Collision boxes and boat motion
remain attached to the shared root. The lake mirror explicitly lists all four
levels of each pier and the ship, plus the ship's existing steps.

Regression anchor: `/harness/propTransitions.html` loads actual shipped ship/pier
GLBs, validates four nonempty prepared levels each, and calls the same placement
controller as gameplay. All 22 assertions passed: initial near selection, half-time
complementary intervals on all submaterials, reversal completion and stationary
return, hysteresis, underwater cancellation/current near and far selection, hidden
reentry reset, unchanged prepared source dispatch and independent shared-material
placements. An additional MCP camera sweep rendered LOD0–3 of each asset: all 20
submaterial effects were ready, compilation-error strings empty, native dither
code present, and GL error 0 at all eight asset/level samples. The full world also
showed sole ship LOD1 visibility at roughly 103 m, with every ship level included
in lakeMirror, GL error 0 and no console errors/warnings. A submerged 100 m sample
confirmed existing world culling disables all four ship instances together.

Browser: Chrome/ANGLE AMD Radeon Pro Series, radeonsi polaris11 ACO, OpenGL 4.6 /
WebGL2; world viewport 1042×601, scaling 1. Browser headed/headless mode was not
independently established in this session. Screenshot of standalone rendering:
`/tmp/prop-transition-harness.png` (uncommitted). These verify actual compiled
instance coverage and list integration, not pixel-perfect mirror/prepass output,
motion acceptance or a performance improvement. No WebGPU/Firefox/Safari claim
is made. Extended U16 remains lead-deferred. Campfire's independent instant LOD
path, standalone shadow/SSAO coverage and forest card/full-file timed handover
remain open; both visible levels still cast during a fade. U13 retains lead
visual acceptance and is not closed by this bounded slice.

Application and standalone harness typechecks and production build pass. Existing
dynamic-import/chunk-size build warnings remain. Earlier unchanged-suite evidence
is 35 passing Bun tests; this slice's meaningful regression is the real-asset browser
harness. ISSUES.md and the resolution plan now remove ship/pier instant-switch
work from the open remainder and retain the exact pending coverage above.

## R6/U13 — prop instance frustum-cull repair (2026-10-07)

Playtest screenshots showed ship and dock geometry missing whenever its centre left
the screen, while the lake-mirror reflection and shadows of the same objects still
drew. The user's centre-based-culling theory was exact.

Root cause: the timed ship/pier slice registered every merged prepared level as an
LOD slave of a bare selector mesh (`selector.addLODLevel`, since removed). Babylon
9.29 lends a master's bounds and transform to its LOD slaves
(`AbstractMesh.getBoundingInfo`/`getWorldMatrix` delegate to `_masterMesh`), so each
level read back the selector's empty bounds, and `placeProp`'s `level.createInstance`
copied that degenerate sphere into every ship, pier and fire-pit instance. Each
instance then frustum-tested a point at its placement: drawn only while the centre
was inside the main frustum, but still inside the mirror/light frustums — hence
reflections and shadows surviving the culled mesh. The browser fade harness passed
all 22 checks because it asserts distances and dither intervals, never the bound
radius. World rain/water culling also read `radiusWorld ≈ 0` for its distance
margin; it self-heals with the same fix.

Evidence (headless, Babylon 9.29.0 NullEngine, Bun): a 60 m merged test level reads
radius 30.37 m; after `addLODLevel` onto a bare mesh it reads 0.00, and an instance
created from it reads radius/radiusWorld 0.00, against 30.07 for an unregistered
control. Repro script (uncommitted): `/tmp/prop-cull-repro.ts`.

Fix: level selection is now a plain authored-distance comparison in
`PropTransitions.update` — the same mapping the native dispatch used (each level
takes over once the eye is strictly past its distance), with the existing
hysteresis/fade logic unchanged. No mesh is ever registered as an LOD slave, so
instances keep their merged bounds; `props.ts` no longer builds or stores a
selector. `src/engine/propTransitions.ts` and `src/engine/props.ts` carry comments
explaining why the native chain must stay out.

Verification: headless `scene.render()` with a 60 m level whose centre sits outside
the camera frustum while its extent reaches in keeps the instance in the active
set; near selection draws LOD0 alone and a far sample settles on LOD1.
`harness/propTransitions.ts` anchors every placed ship/pier instance radius to its
source level's raw radius (30 shipped-GLB checks, was 22). `bun run typecheck`,
`bun run build` and 35 Bun tests pass.

Limits: no new browser run in this slice — the harness assertions await the next
AMD WebGL2 pass, plus the already-pending motion/visual acceptance, standalone
shadow/SSAO coverage and backend parity. No WebGPU/Firefox/Safari claim is made.


## S5 — regional normal/AO streaming (2026-10-07)

Replaced the 75,603,376-byte 8192² normal/AO KTX2 with 81 padded maps on existing
2 km terrain boundaries (each 1024²) and a 2048² distant map. All 1,311 leaves
reference their region by URL and padded world rectangle; geometry is unchanged.
`tools/tile_ground_normalmap.py` retains the 2.197265625 m source spacing,
linear RG world-normal east/north plus B sky visibility, full authored mip chains,
edge extension and content-keyed resumable staging. The installer and ground
rebuild retain/re-author the regional metadata. No runtime baking/downsampling.

Native Babylon Texture objects share regional internal textures by URL. Their
load/release follows existing near geometry, with ready/failure fallback, clear
before disposal, deduplicated leaf jobs and late-callback protection. One PBR
material uses Babylon's per-submesh hard bind for texture plus UV rectangle;
block meshes and mirror proxy use the small whole-map representation. GLSL
array-sampler precision is explicit; WGSL gets a dedicated clamp sampler.

Measured final asset bytes: regions 95,454,775; distant map 5,066,193;
total 100,520,968. Largest regional file 1,302,123. Padding makes the download
24,917,592 bytes larger than the original map; this is a GPU residency and single
file budget repair, not a compression gain. Pack index a79035519214e0e5 has
5,186 files / approximately 813.7 MB. Final dist: 5,897 files / 856,610,727 bytes.
The terrain no longer exceeds the 25 MB cap. Five other files remain oversized:
ship, pier, pine, surf audio and ONNX WASM; S5 archive delivery and S6 stay open.

Verification:
- Application and isolated harness typechecks pass; production build passes.
- 52 Bun tests pass, including nine loader lifecycle checks. Four Python checks
  cover source registration/density, shared mips, edge padding and larger leaves.
- All 82 KTX2 headers, full mip indexes and payload extents pass the authoring
  gate. An idempotent rerun reports current assets without re-encoding.
- An encoded overlap pilot (regions 60/61) matches all three decoded channels
  exactly at mips 0–4: 131,072 / 32,768 / 8,192 / 2,048 / 512 pixels. The earlier
  1 km / 16-texel-aligned pilot differed at mips 3–4; 64-texel alignment and 2 km
  grouping corrected compressed block phase. Coarser local tails are not claimed
  identical to whole-map tails or universally seam-free.
- `harness/terrainNormalTiles.html` renders eight production-plugin checks on
  AMD WebGL2: independent maps, cached shared-material draws, UV registration and
  fallback restoration, including render-target draws. GL error 0. Regression anchor
  is the harness plus `tests/groundNormalTiles.test.ts` and
  `tools/test_ground_normal_tiles.py`.
- Headed Chrome DevTools MCP loaded the final 81-region world at a fresh port
  (3001, bypassing the main game's older SW cache), entered gameplay, accepted
  camera input, prepared and travelled to Wizard Island. At Cleetwood, 33 ready
  leaf bindings share 11 native textures including the distant map, approximately
  19.6 MB of BC7 data versus 89.5 MB for the original full texture/mips. Travel
  requests new regions and releases old bindings. Intermediate 303-region pilot
  also showed residency dropping on travel; its figures are superseded above.

Capability/acceptance limits: the available Babylon graph MCPs do not slice raster
images or encode KTX2, so these operations use the offline pipeline. Headed Chrome
exposes navigator.gpu but reports no available WebGPU adapter after reboot; WGSL
rendering remains unverified. Broader moving seam/visual and backend acceptance
remain open. The lead observed 5 FPS becoming 10–12 with optimizer/SSAO/shadows off,
not a controlled performance experiment. Near-dock quilted patches persisted with
SSAO/shadows off; a separate orientation-like symptom disappeared after browser/dev
server restart. Neither establishes that this asset split fixed U20 or its cause.
No claim that PNG compression was lossy: it is lossless; UASTC is the shipped encoding.


### 2026-10-07 — original fir A/B inspection and procedural wood pilot

- Source viewer `/harness/sourceAsset.html` selects original A/B at LOD0 and compares original/procedural wood on bark/trunk primitives, retaining original foliage/dead branches. C is excluded from this authoring screen.
- Headed Chrome DevTools / AMD WebGL2: A 4,176,819 triangles; B 2,300,624. Both ready with empty compilation errors and GL error 0. Original/procedural switches preserve the camera. Readiness is bounded to 15 s with native forceCompilationAsync; failed variant imports retain the previous tree.
- NME graph validation alone missed the native Worley block's absent manhattanDistance serialized default; explicitly authored false and verified GPU compilation. Graphs are tracked under tools/materials/bark and tools/materials/wood.
- Lead judged the procedural result as wood, requested use on logs/stumps. This does not close bark quality, foliage/LOD quality, production NodeMaterial atmosphere integration, or performance review. No CPU/GPU speedup established.


### 2026-10-07 — fir C retirement

- Removed fir C from future authoring and the shipped fir GLB, retaining pine C. Existing A/B positions, normals, UV1 and triangle indices match the old packed asset byte-for-byte after standard glTF Transform pruning.
- Migrated 963,800 near/middle placement records to A/B. Independently compared all 6,919,829 records against exact backups: locations, poses, counts, non-C species and scales unchanged; maximum preserved-height quantization error 0.00948 m. Native species/cell/descending-scale ordering retained.
- Twelve Python migration tests pass; dry-run is read-only and repeat apply is a no-op. Typecheck/build pass. Fresh headed AMD WebGL2 gameplay loads and responds to arrow input. Asset backup: /tmp/sojourney-fir-c-assets-baseline. This does not close A/B forest LOD/foliage quality.


### 2026-10-07 — authored wood and corrected bark-scale binding

- Lead requested brown procedural grain on chopped logs/stumps. Native NME ProceduralTexture authoring generates 1024px, 0.5m periodic albedo/normal tiles; runtime uses one shared KTX2 pair per scene on stock PBR (atmosphere, water-depth, shadows and fire emissions retained). Campfire ash drops the brown albedo so the existing grey tint remains grey. Cylinder geometry stays at 46 log / 54 stump vertices; caps retain the first-slice grain crop rather than authored growth rings.
- Native GPU slope fixtures use separate authored graphs with zero-amplitude relief plus X/Y ramps, avoiding the empty-define procedural effect case. AMD WebGL2 decoded normals agree within 0.003907 with analytical directions. Wood bake, two-object preview and live game wood textures are ready with no fallback.
- Lead refined bark to cool-grey surfaces, thinner dark fissures and fingernail-scale Phantom Ship fine relief. Native NGE cylindrical mapping adds only UV2 to woody primitives, with a 256px/0.125m normal tile; foliage and source UV1/geometry stay unchanged. A and B shaders compile with GL error 0.
- Checkerboard was the engine fallback, not an accepted surface effect. Texture.Parse loads serialized name by default; the descriptive label was a nonexistent image path. Corrected name to the asset URI, added harness base href=/ for local KTX decoder URLs, and reject loadingError after compilation. Forced failed-texture test restores original bark; correct map loads with no fallback. Bark explicitly ignores alpha and is opaque. Compression diagnosis was not established; retained full-mip UASTC after correcting binding.
- Inspector uses native UniversalCamera with game WASD/arrows/mouse bindings, Shift speed, Space/C inspection elevation, T reset and Close bark framing. Canvas-dispatched native keyboard input changes yaw. Color/mode switches preserve the camera; variants are serialized and failed loads keep the prior tree.
- Bark remains an authoring pilot for lead visual acceptance and later forest-LOD/atmosphere integration. This does not establish production bark adoption or a performance gain.
