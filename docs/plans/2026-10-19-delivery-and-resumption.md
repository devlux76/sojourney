# Sojourney delivery and resumption plan

**Start in a fresh session.** The operator requested completion of work already in flight, consolidation onto `main`, preservation of test-only experiments, and then stand-down. This plan records the remaining work; it does not start another intensive batch. Claude is unavailable until Friday morning, October 23, 2026, America/Denver.

## Working arrangement

- Codex owns material/asset/Babylon decisions, scope, source and licence checks, browser verification, integration and commits.
- MiniMax M3.1 Flash implements one bounded supporting-code task at a time, with an exact file list and no services, inference, subagents or unrelated changes. Preserve its existing OpenCode model/session when continuing it; do not silently replace it with a paid model.
- Use the installed Babylon sources and Babylon MCPs for supported material/geometry operations. Use Bun for application commands. Keep one canonical checkout on `main`; no beta/dev/rc branches or extra worktrees.
- Before each gameplay change, save the affected files outside the repository and establish load, entry and input on the current build. Review the whole diff and run typecheck, tests, build and browser acceptance before committing. Failed or incomplete batches must leave the known working application recoverable.
- The current `ISSUES.md` and `docs/plans/2026-10-06-v1-issue-resolution.md` remain the full v1 backlog. Do not mark their open or sign-off items complete merely because the old worktrees were folded in, and do not move them to v2 without the lead's direction.

## What was folded in

`main` advanced from stable `8956bfe` to the existing terrain branch `a6a6f20`: the registered substrate/cinder work, authored landmark arrivals, ship time, lake ripples/roughness, depth-based shallows, rim-occluded lake glint, cloud self-shadowing/AgX comparison harness, Babylon 9.31 and the two terrain-edge smoothing changes. These were already implemented; closeout adds no new renderer architecture.

The cloud branch's committed patch is identical to the copy already in the terrain branch. The uncommitted package/lockfile upgrade is also identical to consolidated `main`. A harness favicon edit and temporary comparison baselines were archived instead of treated as product features.

Closeout then repaired a GLSL declaration-order error in the merged contact smoothing. WebGL2 loading, gameplay entry and keyboard movement passed after the repair; see [the verification ledger](../baselines/2026-10-19-closeout.md) for evidence and limits. This does not close the WebGPU, performance or visual acceptance work below.

Trailblazer's generated T1-T4 branches are test-only experiments. None was merged. In particular, the latest T4 imported nonexistent `MathUtils` from Babylon despite its PASS report. The correct installed namespace is `Scalar`; the acceptance failure belongs in Trailblazer's follow-up, not in Sojourney's production source.

## Delivery slices after resumption

### 1. Finish the current renderer verification before adding gameplay

**Codex:** read `ISSUES.md` E25/E26/E27/E31 and the terrain-zigzag brief. Recheck the current merged main, renderer, camera, time and weather; old screenshots are references, not current proof.

**MiniMax M3.1 Flash:** if a code defect is reproduced, implement only the bounded supporting change Codex specifies. Existing source pointers are `src/engine/TerrainMaterial.ts`, `src/engine/LakeSurfaceMaterial.ts`, `src/engine/LakeLight.ts`, `src/engine/environment/Clouds.ts`, the moon material and their existing tests. Codex handles shader/material edits directly when required by the project's workflow.

Acceptance:

1. Reproduce E31's WebGPU moon-material readiness hang and record the actual shader/error path. Compare the installed Babylon 9.31 implementation and NME graph; add a failing readiness regression before a minimal fix. Do not turn the moon off or weaken scene readiness to hide it. Confirm WebGL2 still enters and responds to input.
2. Validate the merged terrain smoothing at the original zigzag view with fixed time/weather and the real generated pack. Keep collision, material boundaries and the reference geology unchanged unless a measured defect justifies the next scoped batch.
3. E25/E26 remain visual sign-off items: calm versus wind, low sun, night, WebGL2 and WebGPU, plus measured GPU cost. Codex captures comparable views; the lead decides visual acceptance.

### 2. Complete the missing E27 colour component

**Codex:** compare Cleetwood's reference and current shelf, inspect the installed Babylon material extension points, and define one offline-authoring/material change. Existing files: `src/engine/TerrainMaterial.ts`, `src/engine/LakeSurfaceMaterial.ts`, `src/engine/LakeLight.ts`, `tools/build_ground.py` and `tests/lakeSurface.test.ts` / `tests/lakeLight.test.ts`.

**MiniMax M3.1 Flash:** implement bounded data plumbing or tests after Codex fixes the material interface and file scope; no parallel rework of the water renderer.

Deliver per-channel absorption over the actual view path to the bed, as already proposed in E27. Preserve the repaired shoreline seam, deep-blue water, reflection and underwater view. Verify shallow-to-deep transitions, grazing/underwater views, both shader backends, and asset/VRAM budgets. A tint that merely makes a screenshot turquoise is insufficient; compare the same view and lighting, and keep the lead's colour judgment open.

### 3. Deliver E30 huckleberries as one asset slice and one gameplay slice

**Codex asset slice:** source or author *Vaccinium membranaceum* within the existing P1/P5 budgets, verify commercial rights and `CREDITS.md`, use the installed Babylon asset/MCP workflow, and produce real shrub/fruit geometry with authored LODs. Place it in the specified forest understory/open-slope habitats; don't substitute billboard-only gameplay props or invent ripe July fruit. The existing E30 requirement calls for Aug-Sep ripeness unless the lead chooses a different season.

**MiniMax M3.1 Flash gameplay slice:** after the asset schema and interaction brief are fixed, add hand picking, rucksack transfer and existing campfire/recipe integration. Start from `src/play/rucksack.ts`, `src/play/HeldItem.ts`, `src/play/Campfire.ts`, `src/biomes/crater-lake/index.ts` and `docs/research/live-off-the-land-recipes.md`; locate their current interaction/tests before choosing new filenames. Do not replace the inventory or campfire systems.

Acceptance tests must cover one pick adding one item, exhausted fruit refusing a duplicate pick, season/state controlling fruit availability, capacity/interaction refusal preserving the shrub, eating/cooking consuming the right amount, and returning/reloading not duplicating harvested fruit if persistence is supported. Codex verifies the actual interaction, rucksack and campfire in the browser, asset credits and rendering budget before committing either slice.

### 4. Continue the existing v1 plan in measured slices

Once the above is accepted, use the current root-cause ordering in the v1 issue-resolution plan for the remaining asset, culling, transition, shipping/licence and reference-fidelity work. Codex selects and verifies a slice; MiniMax M3.1 Flash implements only a concrete supporting-code brief. Performance tuning, Firefox/Safari work deferred by the lead, and v2 notes do not become implicit work during this closeout.

## Recovery and first reads

- Read this file, `AGENTS.md`, `ISSUES.md`, the v1 resolution plan and the current `docs/baselines/` closeout evidence before editing.
- Full branch history before cleanup is in `/home/mirai/.local/state/codex/closeout-2026-10-19/sojourney.bundle`; it passed `git bundle verify`. `git bundle list-heads` lists original names/SHAs. Fetch a needed archived ref only for an explicit recovery or inspection, not to re-create the old branch layout.
- The same archive holds exact uncommitted file copies, binary patches and SHA256 manifests for each retired worktree, failed trial reports, and ignored authored/cache evidence. Generated canonical `public/packs/crater-lake/ground/near` and `collision` directories were preserved in place.
- The pre-existing `.codex/` files and `sojourney_2026-10-11_08-34-25.webm` in the primary checkout are user artifacts, not cleanup targets.
- Start with `git status --short --branch`, `git worktree list`, `bun run typecheck`, `bun test`, and `bun run build`. Confirm the main server's working directory before using it. Read actual test results in the closeout ledger rather than assuming this plan proves them.
