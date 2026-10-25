# Quadrant culling + optimizer haze implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise clear-day FPS in two stacked stages: free behind-camera culling first, reversible optimizer haze second.

**Architecture:** Stage A splits the flora far/mid/beyond thin-instance meshes into 4 directional buckets around the camera so Babylon's per-mesh frustum culling can skip whole buckets behind the camera (no visual change). Stage B adds a priority-0 `CustomOptimization` visibility step to `src/engine/Optimizer.ts` that ramps an extra fog density toward storm levels and feeds it through the existing `rainReach` culling path, unwinding in improvement mode (visible haze, Oregon-acceptable, reversible).

**Tech Stack:** Babylon.js 9.x (as installed in `node_modules/@babylonjs/`), TypeScript, Bun (`bun test`, `bun run typecheck`).

---

## Files

- Modify: `src/engine/flora.ts` — bucket `far`/`beyond`/`mid` draws ×4, bucket by direction at `buildFar`/`buildMid` time.
- Modify: `src/engine/world.ts` — mirror render list picks up the bucketed meshes; shadow far/beyond split keeps working per bucket.
- Modify: `src/engine/environment/Fog.ts` — accept an optimizer haze density alongside weather density for `scene.fogDensity` and the veil.
- Modify: `src/engine/Optimizer.ts` — priority-0 `CustomOptimization` visibility step (3–4 rungs toward storm density), `degraded()` includes it, improvement mode unwinds it.
- Modify: `src/engine/world.ts` (sky observer) — effective reach = min(weather reach, haze reach, underwater reach).
- Test: `tests/` — extend `weatherSampler.test.ts` pattern with new `tests/optimizerHaze.test.ts` (pure math: density/reach rungs) and quadrant bucketing unit test for the bucket function.
- Docs: update `WEATHER.md` optimizer decision section once built and measured.

---

### Task 1: Quadrant bucketing for flora far/mid/beyond

**Files:**
- Modify: `src/engine/flora.ts:86-97` (`Batch` interface), `buildFar`, `buildMid`
- Modify: `src/engine/world.ts:224-228` (mirror render list)
- Test: `tests/floraBuckets.test.ts`

- [ ] **Step 1: Write the failing test** — bucket function assigns instances to the correct directional quadrant:

```ts
import { expect, test } from "bun:test";
import { bucketFor } from "../src/engine/floraBuckets";

test("bucketFor assigns by direction from eye", () => {
  expect(bucketFor(10, 0, 0, 0)).toBe(0);
  expect(bucketFor(-10, 0, 0, 0)).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/floraBuckets.test.ts`
Expected: FAIL with "function not defined" (module does not exist yet).

- [ ] **Step 3: Write minimal implementation** — pure `bucketFor(dx, dz)` helper plus `Batch` carrying `far: Draw[4]` / `beyond: Draw[4]` / `mid: Draw[4] | null`, filled by direction at build time; per-bucket meshes keep current material/level setup.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/floraBuckets.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire mirror + shadow split per bucket, measure**

Run: `bun run typecheck`, then headed-browser A/B at the rim viewpoint (same camera/time/resolution as `ISSUES.md` Q1 baseline). Expect: no visual change, fewer far instances drawn when looking one way, ~20 extra draws in view.
Expected: typecheck clean; screenshots identical.

- [ ] **Step 6: Commit**

```bash
git add src/engine/flora.ts src/engine/floraBuckets.ts src/engine/world.ts tests/floraBuckets.test.ts
git commit -m "perf: quadrant-bucket flora far instances for behind-camera culling"
```

---

### Task 2: Optimizer haze as priority-0 visibility step

**Files:**
- Modify: `src/engine/Optimizer.ts:39-53` (`options()`), `src/engine/environment/Fog.ts`, `src/engine/world.ts:104-106`
- Test: `tests/optimizerHaze.test.ts`

- [ ] **Step 1: Write the failing test** — haze rungs map step index to density/reach:

```ts
import { expect, test } from "bun:test";
import { hazeReach } from "../src/engine/Optimizer";

test("haze rungs tighten toward storm reach", () => {
  expect(hazeReach(0)).toBe(Infinity);
  expect(hazeReach(3)).toBeLessThan(150);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/optimizerHaze.test.ts`
Expected: FAIL with "function not defined".

- [ ] **Step 3: Write minimal implementation** — `CustomOptimization` visibility step at priority 0 with 3–4 rungs (clear → drizzle-equivalent → rain-equivalent → storm-equivalent density); `Fog.ts` adds haze density to `scene.fogDensity` and veil; sky observer uses `min(weather, haze, underwater)` reach; `degraded()` returns true while any haze rung is applied; improvement mode removes rungs first.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/optimizerHaze.test.ts` and `bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/engine/Optimizer.ts src/engine/environment/Fog.ts src/engine/world.ts tests/optimizerHaze.test.ts
git commit -m "perf: optimizer haze as first visible degradation rung"
```

---

### Task 3: Measure, document, clean up

- [ ] **Step 1: Headed-browser A/B** — rim viewpoint, clear 11:00, optimizer on, same resolution/backend as baseline. Record FPS per haze rung and with quadrants alone.
- [ ] **Step 2: Update `WEATHER.md`** optimizer decision section with measured numbers and the new rung order (quadrants → haze → resolution → post → shadows → particles/render targets).
- [ ] **Step 3: Commit docs**

```bash
git add WEATHER.md docs/plans/2026-10-05-quadrant-haze-performance.md
git commit -m "docs: record quadrant + haze measurements"
```
