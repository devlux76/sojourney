# Brief: the forest, engine half

Do this work yourself, in this session. Repo: `/home/mirai/projects/sojourney`, in place on `main`.
Do not commit, branch, or start/stop/install anything; run no server, browser or model. Bun only
(`bun run typecheck`). Do not ask the user anything: choose, and say what you chose in the report.
Read `AGENTS.md` first; its rules bind.

## What to build

The engine side of `docs/specs/2026-10-02-forest-from-canopy-design.md` ("Decisions" and "The pack, as
the engine will read it"), reading the files the pipeline half wrote (types in `src/engine/pack.ts`,
manifest and per-leaf files under `public/packs/crater-lake/flora/`; see
`docs/plans/2026-10-02-forest-pipeline-brief.md`). Placements stream with the ground leaves; near trees
are models then cards, the middle band is thinned cards, and the far ground is darkened and greened by
the forest mask; a felled tree stays felled when its leaf is reloaded; nothing vanishes while it is
larger than about two pixels. When it works, the old `flora.json` / `placements.bin` path is removed.

## You may change only

`src/engine/flora.ts`, `src/engine/groundStream.ts`, `src/engine/ground.ts`,
`src/engine/TerrainMaterial.ts`, `src/engine/pack.ts`, `src/engine/world.ts` (only the lines that load
flora), `src/play/Chopping.ts`, `src/play/Sitting.ts`, `src/play/TrunkGrid.ts`. If the forest mask is
not yet in the ground pack, say so in the report rather than building ground files.

## Where to look

`src/engine/flora.ts` (thin-instance batches per level, sorted by distance; trunk colliders; rock
seats; felling), `src/engine/groundStream.ts` (how leaves load and unload around the camera and around
a teleport target), `src/engine/TerrainMaterial.ts` (the ground material plugin and its samplers; the
WebGPU limit is 16 per stage), `src/play/Chopping.ts`.

## Keep in mind

- Frame rate here is 9–14 fps; building matrices for a leaf must not stall a frame (spread it out).
- The lake mirror and the shadow cascades redraw flora; the mirror takes far tree levels only
  (`world.ts`).
- Never cull to gain frame rate; the lowest level is the floor.

## Report

Files changed with a sentence each, `bun run typecheck` output, what you could not do, and what the
reviewer should look at first in the game.
