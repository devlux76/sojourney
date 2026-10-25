# Q1 baseline measurements — 2026-10-03

The numbers behind the code efficiency review (Q1 in `ISSUES.md`). Conditions: WebGPU,
1276×591, SceneOptimizer held off (`targetFps: 1`), everything on; rim viewpoint 82, 286, −2956
facing north unless noted. GPU figures are from the game's WebGL 2 path, where Babylon's
`EngineInstrumentation` timer works without flags — on WebGPU Chromium hides the timings unless
started with `--enable-dawn-features=allow_unsafe_apis` (now in `start-game.sh`).

Superseded in part by the optimizer rework and look tuning of 2026-10-04/05 (see section F in
`ISSUES.md`). Re-measure before trusting any figure here.

## Frame split (107 ms frame, script side)

- 35–55 ms is the game's JavaScript: ~24 ms issuing draw commands, 7.6 ms choosing what is in
  view (4,313 meshes in the scene), 5.6 ms on the mirror and shadow passes.
- All of our own per-frame callbacks together take ~3 ms — they are not where the time goes.
- The ground was 27 ms of it: 484 leaves in view, each its own draw command at ~56 µs, against
  6 ms for the ship, trees, rocks and everything else. Freezing the ground material changed
  nothing.

## GPU costs by switching off (rim, card 108 ms of a 113 ms frame; parts overlap)

All trees 57 ms; shadows 40 (casters 23, receiving 17); half resolution 40; the 92 near tree
models 31; far tree cards 19; the ground 17; anti-aliasing 10; mid tree cards 5; bloom 3;
sharpening under 1.

## Done under Q1

- **Far ground drawn in blocks.** `tools/build_ground.py` also writes the leaves of each 1 km
  square joined into one mesh at levels 3 and 4 (`blocks.glb`, 150 blocks covering 1,158 of the
  1,311 leaves, 5 MB), and `src/engine/groundStream.ts` draws a block in place of its leaves once
  all of them have reached that level. Ground draw commands at the rim fell from 484 to 148 and
  their time from 27 ms to under 11 ms; the view is the same
  (`tools/.cache/shots/light-pass/10-ground-blocks-summit.jpeg`).
- **Frame rate at full resolution did not change** (8.9 fps before and after): the graphics card
  is the limit there. With pixels cut to a sixteenth it rose from 14.7 to 16.6 fps, so the card is
  also limited by something other than pixels, most likely the three million tree instances.
- **Far instances past the shadows' reach cast none.** Each species' far mesh is split in two at
  the shadow distance (600 m) and the part beyond it is left out of the shadow pass
  (`src/engine/flora.ts`, `beyond`). At the rim that is 11,836 of 21,655 far instances, and the
  card's time fell from 108 to 105.7 ms. The piers and the ship in the shadow list kilometres away
  cost under 1 ms (Babylon already draws their coarsest level), so they are left in.
- **Splat map as KTX2.** It was the one ground texture still shipped as a PNG, which the graphics
  card holds unpacked: 4096×4096 RGBA, 64 MB before mip levels, against 16 MB as BC7. Compared in
  one session by swapping the two on the live material: no difference in GPU time (143.9 ms both
  ways), and the picture differs by a third of one level in 255 on average. The download is
  13.4 MB instead of 15.8 MB. So it saves video memory, not frame time.

## Measured, not built

- **Drawing only the instances in view.** About four fifths of the far and mid instances at the
  rim are behind the camera, since a species is one mesh and Babylon does not cull instances one
  by one. Cut into four quadrants around the camera so that Babylon culls whole quadrants, the card
  would save 4.7 ms there (measured by filtering the buffers by hand), for about 20 more draw
  commands in view and about 60 more in the lake's mirror, which draws its whole list.
- **Replaying recorded draw commands** with no per-mesh JavaScript (WebGPU snapshot rendering —
  a v2 item in `sojourney2.md`).
- **230 leaves are still enabled near the camera**, and a block of two leaves saves little.

## Pipeline note

`tools/build_ground.py --meshes` rebuilds only the leaf, block and collision files (6 minutes).
The build now fetches the mesh compressor once before its parallel jobs: started together on an
empty cache they failed on each other's files.
