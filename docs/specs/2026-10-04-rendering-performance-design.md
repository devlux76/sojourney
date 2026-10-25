# Rendering performance design

**Status:** proposed for review
**Date:** 2026-10-04

## Goal

Improve the per-frame efficiency of Sojourney's Crater Lake scene through code and asset-pipeline refactoring, while retaining the current appearance, all gameplay and rendering features, and sharp close-range detail. Treat the reported roughly 5 FPS from the first scene as the motivation; do not make a numeric speedup promise because this work will not run A/B benchmarks or performance measurements.

The audit is deliberately broad: inspect first-party TypeScript and custom shaders line by line, prioritizing work that executes during rendering or changes GPU work. “Optimize everything possible” means look for worthwhile algorithmic, data-flow, and Babylon API improvements throughout the frame path—not change source text for negligible instruction-count reductions.

## Constraints

- Keep all existing scene features active: terrain and water, reflections, shadows, post-processing, atmosphere and weather, particles, physics, streaming, interactions, audio, and UI. Do not solve the problem by disabling features or adding new performance toggles.
- Preserve the established Crater Lake look. Authored distance LOD and distance culling are allowed; the nearest views must retain their current sharpness and geometry/material detail.
- Follow the repository's Babylon-first rule. Check installed `@babylonjs` 9.x source/types and current official Babylon documentation before changing engine usage; do not replace a shipped engine capability with a custom implementation.
- Respect existing pack licensing, texture colour-space, mip-chain, quality, and texel-density requirements. KTX2 is already used for the principal terrain textures and texture arrays; evaluate remaining candidates based on runtime/GPU benefit and correct visual decoding, not file extension alone.
- Do not add a profiling campaign, benchmark harness, A/B matrix, or numerical FPS acceptance target to this work.
- Keep changes incremental. After a cohesive change compiles, commit that change; inspect status and stage only files belonging to that change, leaving unrelated user files untouched.

## Audit and implementation scope

Review every first-party TypeScript file on the runtime frame path and the custom GLSL/WGSL in `src/engine/TerrainMaterial.ts`. Inspect adjacent code where it determines render work or per-frame inputs, including engine creation, environment, water/reflection, shadows, terrain and flora streaming/LOD, player updates, particles, and render callbacks. Review asset-building/conversion scripts and shipped asset metadata where they determine per-frame geometry, texture sampling, draw submission, or GPU memory use. Treat vendor code as read-only unless an independently verified integration defect requires a focused change.

For each candidate, establish from code and Babylon 9.x references whether it is actually in the hot path and whether the proposed change preserves behavior. Prefer refactors with a clear cost mechanism, such as:

- Avoiding repeated work, unnecessary allocations, temporary collections, redundant observable callbacks, or per-frame traversals when state has not changed.
- Improving batching, visibility/culling, LOD selection and transition bookkeeping, and CPU-to-GPU buffer updates without increasing nearby pop-in or degrading close detail.
- Reducing redundant shader calculations and texture samples, making shader branches/derivatives safe, and simplifying expressions only when GLSL and WGSL remain equivalent in appearance and valid on their respective backends.
- Reviewing reflection, render-target, shadow, and post-process setup for avoidable duplicate work while retaining those effects and their current intended quality.
- Reviewing geometry and texture formats, mipmaps, embedded model textures, and far-distance authored representations. Convert remaining eligible textures to KTX2 only where existing runtime support, GPU format selection, colour space, alpha, mip behavior, and visual quality are maintained.
- Removing redundant engine work only when Babylon.js 9.x provides a correct supported alternative and project behavior is preserved.

Do not make speculative arithmetic substitutions whose benefit is not credible in context, weaken correctness for marginal gains, or create hand-maintained duplicate paths between GLSL and WGSL. Update comments in files as they are changed so they describe the resulting implementation.

## Change and validation approach

Implement in small cohesive slices, favoring hot-path changes first. Before each change, inspect relevant installed Babylon.js 9.x implementation/types and the matching official documentation. Keep each change reviewable and commit after the project compiles, per the user's instruction.

Use correctness checks, not performance measurements: run the relevant focused tests where available, then `bun test`, `bun run typecheck`, and `bun run build` for completed slices or groups. Ensure shader source continues to compile for both WebGL/GLSL and WebGPU/WGSL paths when those compile paths are available through normal build/runtime validation. Check that LOD/culling preserve close views and that feature wiring remains enabled in code. Do not report a speedup without measurement.

## Initial codebase context

- The installed package lock resolves Babylon.js core to 9.29.0. The optimizer API and its trade-offs are documented in the installed declarations and the official Scene Optimizer documentation.
- `SceneOptimizer` already changes hardware scaling, post-process effects, shadows, particles, and render targets to hold a target FPS. This project must retain the user's “all features on” constraint, so optimizer behavior must not become the substitute for code-path optimization or silently disable features.
- Terrain maps, including the lake-bed texture arrays, are already KTX2. Texture conversion therefore needs an inventory of what remains and a reasoned GPU/runtime case before implementation.
- Existing terrain and flora streaming/LOD are sophisticated and preserve fine near geometry. Refactors must account for those transitions, zoom, weather visibility, shadow range, and gameplay collision/interaction dependencies.
- The prior FPS baseline predates substantial recent forest-detail changes and is not a valid numeric comparison for this work.

## Completion criteria

- The intended runtime TypeScript frame paths and custom GLSL/WGSL have been reviewed, and changes are confined to candidates with a clear per-frame or GPU-work rationale.
- All scene features remain wired and enabled; close-range visual quality is preserved, with only the agreed distant LOD/culling tradeoffs.
- Babylon.js 9.x source/docs informed engine-facing changes; KTX2 decisions are documented by asset category and runtime implications.
- Relevant correctness checks and the project build/typecheck/tests pass.
- Every compiling cohesive implementation slice is committed without including unrelated working-tree files.
- Results describe code changes and validation only, not unmeasured FPS claims.
