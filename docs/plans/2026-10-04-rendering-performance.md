# Rendering performance pass

> **For agentic workers:** Execute inline as small, compiling slices; commit each slice.

**Goal:** Refactor per-frame CPU and GPU work while preserving the current look, all features, and near-field detail.

**Architecture:** Audit TypeScript frame callbacks, terrain GLSL/WGSL, render passes, and asset formats. Use Babylon.js 9.x APIs verified against installed source/docs. Implement only changes with a clear cost rationale; do not benchmark or claim numeric gains.

**Tech Stack:** TypeScript, Babylon.js 9.29, GLSL/WGSL, Bun, KTX2 tools.

---

## Sequence

- [ ] Review engine/render-target/shadow/pipeline setup and terrain shader; make verified hot-path refactors, run correctness checks, build, commit.
- [ ] Review scene callbacks and player, ground, and flora update loops; remove repeated work/allocations where behavior permits, test, typecheck/build, commit.
- [ ] Review geometry, KTX2, mip, and far-LOD asset paths; change only supported opportunities that preserve close detail, validate build/assets, commit.
- [ ] Run `bun test`, `bun run typecheck`, and `bun run build`; inspect staged diff and commit any final cohesive fix.

## Guardrails

- Keep all features active; no new performance switches or global quality cuts.
- Preserve near-field appearance; distant authored LOD/culling is permitted.
- Keep GLSL and WGSL behavior aligned; verify Babylon 9.29 source/types/docs before engine-facing changes.
- Do not stage or modify unrelated existing user files; no benchmark work or unmeasured FPS claims.
