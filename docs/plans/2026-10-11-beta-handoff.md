# Stable playtest and beta visual work

## Branches and verification

- `main` and `playtest-2026-10-11`: `8956bfeb1c1cf6103901e0c9fff49298eeb04def`, October 7, 22:58 MDT. Last verified checkpoint preceding the recent work; no intervening commits until October 10, 23:31.
- Stable source and committed pack stay together. Independent typecheck/build pass, 52 tests pass. Headed AMD WebGL2 verification loads through sound check and destination download, enters aboard, T reaches Cleetwood pier, and W changes the grounded player position. No captured page errors.
- `beta`: current work through `872b419`, including land POIs, underwater rain repair, geological palette, cinder/relief work and ship-clock feature. `786706c` also preserves the existing close-ground tool/collision metadata and tracked screenshot deletions. Beta typecheck/build and 62 tests pass.
- Original checkout `/home/mirai/projects/sojourney` stays on stable `main`, served at port 3000. Beta worktree `/home/mirai/.codex/worktrees/sojourney-beta/sojourney` stays on `beta`; its development server uses port 3001. Coordinating agents branch/worktree from beta and integrate verified chunks into beta, preserving stable main.
- Exact local WIP/artifact backup: `/home/mirai/sojourney-checkpoints/pre-beta-2026-10-11`. Includes manifest/hashes, binary diff and original files, including uncommitted content. Local screenshots and video were preserved outside tracked beta source. The ignored generated near/collision pack inputs (2,622 files) are copied into the beta worktree and also backed up with hashes under `generated-pack/`; their byte counts match the beta pack manifest. Fresh worktrees require those generated inputs as well as tracked files. After adding ignored pack files, restart Vite: its pack watcher is deliberately disabled, so its initial public-file inventory otherwise returns HTML for newly copied GLBs.

## Current visual scope

Reference-photo fidelity and immersive realism first. Performance tuning is a separate subsequent session. The current viewed appearance was accepted generally; this does not close individual reference gaps.

First targets: Pumice Castle and Devils Backbone. Check viewpoint, lighting, real geological material boundaries and distinctive geometry before global palette adjustments. The first scoped Castle viewpoint/material batch is preserved below; landmark geometry remains unfinished.

## Pumice Castle registration findings

- Existing guide aim `(7234,160,-985)` samples neutral substrate255. Nearby GNIS point transforms to approximately `(7298,226,-1003)` and is grey/forested in the aerial image; do not assume GNIS is the turret centre.
- Current authored `dcp`/class128 band is near x7578–7794,z-1009–-367; its centroid is approximately `(7704,-728)`, ground elevations288–383m. Independent 2016 NAIP/DS716 inspection places the strongest orange steep face near `(7730,335,-645)`, with moderate uncertainty on the exact turret.
- A 450–500m discrepancy at this landmark is not proof of a global geology/terrain translation. Cross-check additional photo/topographic/orthophoto/geological anchors before moving maps. The older ledger records a separate ~9km displacement in a cached GPKG; that cache was replaced by original PAL polygons with registered Wizard/Phantom anchors.
- The face points roughly WNW; afternoon illumination is the useful comparison. Current beta ship hours assign Pumice Castle17:00, while ordinary land clock is independent.
- New public-domain USGS photograph: `references/pumice-castle/usgs-heather-wright-rim-view-north-2012.jpg`, source metadata beside it in `SOURCES.md`. Shows the orange turret, adjacent pale talus and Redcloud Cliff from a second direction. Existing USGS SIM2832 photo is another primary reference.
- Dry collision-prepared candidate views toward the new target: `(7410,35.8,-450)`, heading121.4°, pitch-38.6°; `(7394,25.8,-450)`, heading120.1°, pitch-38.5°. Source heightfield visibility tests alone do not establish a good game view; inspect prepared runtime screenshots before changing authored POIs or guide aims.

## Runtime and coordination safeguards

Use one active headed game browser. Stop rendering and close test browsers when finished; do not leave unattended headless GPU work. Preserve precise scoped-file baselines before gameplay batches. Validate load/entry/input and build independently before integrating.

VORTEX direct-stream leak was repaired (`dee2105` in VORTEX), all three identities now on repaired daemons. Stored40-message receipt checks passed beyond the old32-stream failure. Distinguish historical inbox messages from current state and transport-write from actual peer receipt.

## Evening pause: exact state and next session

The operator explicitly paused development on October 11 for a fresh session tomorrow. Do not resume automatically, wake another model, or start unattended tests. This is a preservation checkpoint, not acceptance of final landmark fidelity.

### Saved Pumice Castle batch

Five scoped files: `src/biomes/crater-lake/index.ts`, `src/engine/TerrainMaterial.ts`, `tools/build_route.py`, `public/packs/crater-lake/route/boat_tour.json`, and `public/packs/crater-lake/files.json`.

- Teleport index 6 now arrives on the rim edge at `[7434,381,-1174]`, heading29.2°, pitch4°, facing the identified ochre formation. Other POIs, especially map extrema, were unchanged in this batch.
- Boat guide aims at `[7730,335,-645]`. Only that sight’s target changed in generated JSON; sight distance21403.6 and all path samples were preserved. Generator source agrees.
- Mapped pumice/tuff substrate class2 uses `(4.50,2.20,1.00)` over the dark carrier in both GLSL and WGSL. No global map shift, forest change or other substrate tint change. This is a first photo comparison pass; the bright region still looks broad and simplified, and the distinctive turret/columns need further investigation.
- Regenerated pack manifest: version `41e443a4f7feee03`, 5189 entries, approximately813.7MB.
- Independent validation logs: clean typecheck, 62 tests/0 failures/451 assertions across17 files, production build passed3.21s. Final headed AMD WebGL2 run used authored POI data: arrival `[7434.0002,380.7302,-1174.0028]`, dry/non-swimming, slope0.0229; W moved the grounded player; guide target matched; loading0; no captured page errors. WGSL values match but final WebGPU appearance was not independently verified.
- The final screenshot was inspected: ochre face visible across the valley, trees in foreground, turret still insufficiently distinctive. Comparison used17:00 and diagnostic clear-weather override in a disposable profile; it did not change shipped weather or optimizer defaults.
- Exact pre-batch originals: `/home/mirai/sojourney-checkpoints/pumice-beta-batch/`. Current verification evidence is durable under `/home/mirai/sojourney-checkpoints/session-pause-2026-10-11/scripts-and-logs/` and `temporary-images/` (including `pumice-beta-final.png`). See hash manifest at that checkpoint.

### Corrections and failed hypotheses to preserve

Do not repeat a global geology translation based on the Castle/GNIS discrepancy. Cross-landmark registration is not established. Pixel checks found identical PNG/KTX2 substrate masks; south-origin samples near the target correctly encoded class2. The apparent diagnostic mask mismatch was a visual misreading. Runtime target projected near the screen centre, ray hit leaf818 LOD0 at approximately `[7714.34,320.41,-635.73]`; rendered floor and collision agreed within0.0002m. Backface and flora removal probes did not justify production engine changes. Low shoreline views were obscured by real terrain ridges; the rim edge is a better reference view.

The earlier anisotropy16→1 triangle conclusion was invalid because sunlight changed between shots. Frozen-time comparisons retained the artifact. Do not call the dark-triangle issue fixed. The operator subsequently accepted the generally viewed appearance and prioritized reference fidelity; revisit only when relevant to actual POI views.

### Browser verification prerequisites

Chrome DevTools MCP became stale after browser windows closed; repeated navigation attempts timed out. Reliable fallback was headed bundled Puppeteer via Bun, `pipe:true`, `/usr/bin/google-chrome`, and no remote-debugging-port. Bundled module: `/home/mirai/.bun/install/global/node_modules/chrome-devtools-mcp/build/src/third_party/index.js`. Use current desktop DISPLAY/XAUTHORITY, not a stale copied authorization path. Scripts are saved in the durable checkpoint.

Wait for `window.__player`, an active engine render loop, and scene frameId>20 before teleporting: DEV exports are assigned before initial spawn completes, so an earlier manual spawn is overwritten. Use a single headed browser; close it in finally. After copying ignored public pack files, restart Vite before checking GLB responses. Never infer geometry failures from HTML returned in place of a missing GLB.

### Coordination and ownership

VORTEX checkout `/home/mirai/projects/vortex`; append-only `CHAT.md` is the human-visible repair record. Codex uses only `/home/mirai/projects/vortex/.vortex/codex` state/API7800/peer port7810. Claude owns its own state/API7801/7811, OpenCode7802/7812. Receiver stream leak fixed in `dee2105`; direct40-message stored receipts passed in both directions and for OpenCode. Do not inspect another agent’s private state or treat old inbox history as new failure.

Codex owns materials/assets/reference/browser decisions; Claude supplies read-only source/photo assessment unless given scoped ownership; OpenCode gets one bounded supporting task at a time through the installed helper, no parallel delegates. No coding delegates or QA browsers remain active at pause. Keep stable port3000 available for human playtesting; beta port3001 is stopped at pause. Idle VORTEX services need no restart or ring activation.

### Resume checklist

1. Read this handoff and actual beta AGENTS; check both checkout statuses and branch heads. Stable main remains `8956bfeb1c1cf6103901e0c9fff49298eeb04def` with tag `playtest-2026-10-11`. Do all new work in beta worktree; do not update stable main without lead direction.
2. Read current own VORTEX inbox and coordinate with Claude directly. Preserve current edits and obtain fresh scoped-file copies before each gameplay batch.
3. Start beta with Bun at3001 only if needed; confirm the generated near/collision files exist (2622 ignored files backed up separately), pack loading, gameplay entry and input.
4. Compare saved primary photos with final Castle view. Next visual work is distinctive local turret/column geometry and neighboring talus, then Devils Backbone; avoid blanket palette/map shifts. Claude’s ranking: Castle/Devils furthest from reference, then Llao/Wizard; Phantom closer but blunt/dark. Cleetwood talus/shallows, foliage and sky remain broader visual gaps.
5. Independently review each narrow diff and run typecheck/tests/build plus headed load/entry/input before accepting it. Performance optimization remains a separately authorized later session after the look is dialed in.

### Reference preservation

All existing reference photos remain in the project’s `references/` folder. Both checkout libraries plus readable temporary images and test scripts/logs were copied and SHA-256 verified into `/home/mirai/sojourney-checkpoints/session-pause-2026-10-11/` (292 files,316976779 bytes at initial preservation). Recovered loose Cleetwood photo is in `references/cleetwood-cove/cleetwood-clear-source-unconfirmed.jpeg`; attached operator images are under `references/user-provided/` when available. Source/licence uncertainties are documented in `references/PAUSE-PRESERVATION.md`. Research photos are outside shipped assets; do not assume reference licences permit commercial redistribution. No reference/evidence recovery should depend on `/tmp` surviving reboot.
