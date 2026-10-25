# Crater Lake baseline (2026-09-28, code as of ae16de5)

The pack as it stands before any packsmith work, for the M8 before/after comparison. Measured on
the dev machine (WebGL2 through ANGLE/Vulkan, 1276×591, hardware scaling 1) with `bun run dev`
driven by the Chrome DevTools MCP. Numbers are a regression baseline, not phone targets.

## Health

- `bun test`: 105 pass, 0 fail. `bun run typecheck`: clean. `bun run build`: succeeds (one
  >500 kB chunk warning, the engine chunk, expected).
- Destination screen → Crater Lake (Enter) → world ready in about 5 s (1.5 s on reload).
- **No console errors or warnings, no failed network requests.**
- Renders on WebGL2, not WebGPU.

## Scene at spawn, 09:40, clear

| Stat | Value |
|---|---|
| FPS (camera still) | 44 |
| Meshes / active meshes | 416–443 / 40–72 |
| Active indices | ~4.1–4.5 M |
| Materials / textures / lights | 67 / 124 / 4 (sun-or-moon, hemispheric fill, flashlight, campfire) |
| Particle systems | 2 at start (dust motes, rain) |
| JS heap | ~260–500 MB (GC sawtooth) |

## A full day, camera still (5-minute day, sampled every 10 s)

- **Nothing accumulates**: meshes, materials, textures and lights stay constant for a whole
  cycle; the heap is flat apart from GC.
- FPS: 42 in the morning, 38–39 in the rain and at night, one dip to 32 at dusk.
- That day's weather had a rain spell 12:00–19:00 (rain up to 0.92, ~6,400 active rain
  particles). Wetness eases out slowly in continuous play (still 0.14 at 21:40); a paused jump
  snaps it. Measured effect on night brightness: under 1 luminance step, so this is **not** the
  "terrain doesn't darken" cause.

## Night brightness (23:00, facing the cone, no fire, standing)

Mean luminance (0–255) of screen regions:

| Region | Continuous | Weather snapped | Jump to noon and back |
|---|---|---|---|
| Mountain (cone slope) | 23.7 | 24.5 | 24.5 |
| Ground | 22.6 | 23.4 | 23.4 |
| Trees | 18.3 | 18.7 | 18.7 |
| Sky | 1.3 | 1.3 | 1.3 |

- With no fire and no sitting, the frame is a pure function of the hour: no hysteresis between
  continuous play and a jump.
- The land is lit far above the night sky (about 18×) by the hemispheric fill light (0.15) and
  IBL (0.05) at exposure 0.35, with the sun and moon both off. That reads as terrain that "doesn't
  darken", and it is the same in both paths.

## Known issues to reproduce next

1. **Terrain not darkening / FPS drop / fans, worse after chopping a tree and sitting on a stump**
   (reported). The steps above didn't reproduce the continuous-vs-jump difference, so it depends
   on what that scenario adds: the campfire (a point light, flames and smoke), the chopped stump,
   the flashlight light or the sitting pose. Next: reproduce with those exact steps while
   sampling the same stats.
2. **Trees "lit up" by campfire smoke instead of hidden.** Smoke particles are unlit and
   alpha-blended in a fixed pale grey (`src/play/Campfire.ts`: `SMOKE_COLOUR_*`, at most 80% dimmed
   at night), so at night they are lighter than the trees behind them. Likely fix: tint smoke by
   the scene's current light/fog colour, not a fixed colour.
3. **Daylight looks flat and weak** (grey, low contrast), as the asset-pipeline research
   predicted (look-dev milestone M1).
