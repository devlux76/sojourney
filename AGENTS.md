# Sojourney — agent instructions

Relaxing "pocket vacations" to real wild places — Crater Lake first, each destination a downloadable
pack chosen at a destination screen: Babylon.js + TypeScript, built with Vite.

**Sojourney is a commercial product.** Every shipped asset must allow commercial use and be credited
in `CREDITS.md` (CC0/public domain preferred; no NC or SA licences unless we obtain a commercial licence
from the rights holder). Open licensing questions live in `LICENSING-TODO.md`. Assets inherited from the
original prototype whose source is not recorded come from the Babylon.js playground asset sets
(github.com/BabylonJS/Assets: CC BY 4.0 unless the asset's folder says otherwise), so credit them as
such rather than treating them as unknown. Packsmith, the asset pipeline, will also be offered for
non-commercial use so people can build community packs; that doesn't make Sojourney itself
non-commercial. Keep personal notes about anyone out of the repo.

## How Sojourney is built

The first version was written from outdated knowledge of an older Babylon.js, then hand-optimised by
switching features on and off. It ran at about 19 fps with everything on and did not look good. On
2026-10-01 its designs, specs, plans, tests, guide and code comments were withdrawn, and the engine and
asset pipeline are being rebuilt on these rules:

1. **Babylon first.** If Babylon.js 9.x provides it, use it as it ships. Never reimplement an engine
   feature. The authority is the installed source in `node_modules/@babylonjs/`, not memory of older
   versions — read it before writing or keeping any system. Official sources also include the
   Babylon.js documentation and what it documents: the official demos
   (`https://www.babylonjs.com/Demos/<name>/source/`), the asset guide
   (`https://doc.babylonjs.com/preparingArtForBabylon/`), and documented community extensions such as
   Dynamic Terrain (`https://doc.babylonjs.com/communityExtensions/dynamicTerrains`). The docs site is
   rendered in the browser; read its text from
   `https://raw.githubusercontent.com/BabylonJS/Documentation/master/content/<path>.md`.
2. **Everything on.** Engine features are enabled by default. No feature flags, URL switches or
   per-feature settings for performance.
3. **One performance input: a target frame rate.** The player sets a target FPS; Babylon's
   `SceneOptimizer` lowers and raises detail to hold it. Nothing else trades quality for speed.
   Lead-authorized exception (2026-10-06): settings offer Scene optimization On/Off for comparison;
   default On, with Off stopping automatic tuning and restoring full detail.
4. **Assets carry the quality, within a budget.** The pipeline in `tools/` follows Babylon's asset
   guide: triangle budgets set by how many assets are on screen at once, one texel density with
   textures sized to it, few materials per asset, authored LOD levels, full mip chains. Assets must
   look good even when the optimizer has switched features off. The engine does not bake, derive or
   downscale assets at runtime.
5. **Import whole Babylon packages**, at `latest`; prune once we know what is unused.
6. **Comment code as you edit it.** The old comments were removed because stale ones misled; write
   new ones that describe what the code does now and why, in any file you are already changing. Do not
   make a separate pass to comment files you are not otherwise editing.
7. **Nothing from the withdrawn documents is binding**, and they stay withdrawn unless the project lead
   asks for one back. Restored so far: the packsmith design
   (`docs/specs/2026-09-28-asset-pack-pipeline-design.md`) and roadmap
   (`docs/plans/2026-09-28-packsmith-roadmap.md`).

## Bun only

This project runs on **Bun**. Never use `npm`, `npx`, `yarn`, `pnpm` or `node` directly.

| Task | Command |
|---|---|
| Install / add a dependency | `bun install`, `bun add <pkg>`, `bun add -d <pkg>` |
| Dev server (http://localhost:3000) | `bun run dev` |
| Production build | `bun run build` |
| Tests | `bun test` |
| Type check | `bun run typecheck` |
| One-off package binaries | `bun x <bin>` |

`bunfig.toml` sets `[run] bun = true`, so package scripts (vite, tsc) run on Bun's runtime
even though their shebangs say `node`. The lockfile is `bun.lock`; don't create
`package-lock.json`.

Data tools in `tools/` are Python 3 (`python3 tools/<name>.py`).

## Plan, delegate, verify

Use OpenCode for well-specified implementation work to conserve Codex credit. Codex handles
planning, consequential decisions, supervision and independent verification. Small documentation
edits can be made directly. Use the installed `delegate-to-opencode` skill at
`~/.codex/skills/delegate-to-opencode/SKILL.md` (invoke with `$delegate-to-opencode`); its helper is
`scripts/delegate.py` relative to that skill. It adapts the working Claude delegation skill.

- Lead-directed workflow (2026-10-07): Codex handles asset, shader/material and Babylon MCP
  work directly. Delegate bounded supporting code; Codex handles browser verification.
- Delegate one bounded task at a time to `opencode/muse-spark-1.3-contributor-free`, with serial
  fallback to `opencode/mimo-v2.6-flash-free` on a model error. Do not launch parallel delegates or
  delegated subagents. Do not select paid models automatically.
- Give the delegate a concise brief with allowed files, source pointers, invariants, defaults,
  exact validation commands and acceptance criteria. Preserve existing user edits and enforce
  this repo's Bun, Babylon, licensing and main-only rules. Codex reviews and commits verified work.
- Keep supervision active until completion or an orderly stop. Answer routine clarifying questions
  from the brief; surface consequential ambiguity to the user. Review permission requests against
  existing authorization. Inspect stalls and continue the same stopped session with a specific
  correction or nudge; avoid repeated attempts without new evidence.
- Use the helper's watchdog to stop stalls, timeouts and retry loops. On a retry or quota signal,
  abort and confirm the affected session and descendants have stopped; observe its 24-hour
  cooldown before another free-model attempt. Quota exhaustion is not a reason to try another
  free model repeatedly. Resolve any unconfirmed abort before launching more work.
- Before gameplay changes, verify a playable baseline and save exact copies of the scoped files,
  including uncommitted content, outside the repo. Work in small batches and reserve time and
  credit for verification and recovery. Independently review the diff, build, and check loading,
  entry into gameplay and input before accepting a batch; compilation alone is insufficient.
- If a batch cannot be completed, stop the delegate and restore only that batch's changes from
  the saved baseline, preserving concurrent user edits. Recheck playability. Do not leave the
  game broken because delegation or Codex credit ran out; report any recovery blocker explicitly.

## Working in this repo

- If it compiles, commit it: build completed changes and commit them directly on `main`.
- Maximize reliance on the available tools, especially Babylon MCPs for supported operations and
  Chrome DevTools MCP for browser inspection, testing and performance measurement.
- Remove closed issues from `ISSUES.md` and update their references; keep verification evidence
  and regression anchors in the review ledger. Items needing sign-off stay open until accepted.
- Commit directly on `main`; no worktrees or feature branches.
- Build output (`dist/`) and `node_modules/` are never committed.
- Specs and plans live in `docs/specs/` and `docs/plans/` respectively.
- `ISSUES.md` lists what blocks Sojourney v1. `sojourney2.md` is notes for the next version, not a
  backlog being worked. v1 is not frozen yet, only getting close to it, so work can still be added to
  v1; don't push something to `sojourney2.md` unless the project lead says so.
