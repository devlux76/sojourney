# POI basalt design (2026-10-04)

Points of interest (Phantom Ship, Devils Backbone, Llao Rock) render in the wrong rock:
the generic cliff texture `rockyGround` averages sRGB (166, 153, 132), pale tan, so the
Backbone wall is cream wall-to-wall and the Ship is uniform brown. The references show
dark basalt spires in pale pumice scree. The deep lake-bed layer `dark_rock_02`
(Poly Haven, CC0, already credited, already ships in the bed texture array) averages
(58, 52, 44) with brown weathering, close to both references.

## What changes

- The ground shader samples the already-bound bed-array basalt layer (layer 3, 10 m tile)
  above the waterline, blended over the pale rock component by a new whole-map basalt mask.
- The mask is baked by the pipeline, not painted by hand: a circle round each dark-rock
  sight (Llao Rock 500 m, Devils Backbone 400 m, Phantom Ship 250 m), gated to steep
  ground (`smoothstep(0.7, 0.9, slope)`, so talus and scree stay pale gravel) and kept off
  the waterline (`smoothstep(1, 3, height)`, so the white pumice shore stays).
- Pumice Castle is left out: it is famously orange pumice, a different fix for later.
- One new texture binding (the mask, linear KTX2 like the splat map). No new downloads,
  no CREDITS change, no new samplers beyond one (7 of 16 used).

## What does not change

- Splat map, meshes, lake-bed shader path, and every cliff outside the three circles.
- The mask rebuilds alone (`build_ground.py --basalt`): mask KTX2 plus `ground.json`.

## Alternatives tried or rejected

- B (new 2k basalt land layer + hand dike corridors): sharper, but a bigger pack and hand
  art to maintain. Revisit if A reads too soft in the flashlight pool.
- C (darken all steep cliffs): recolours the whole rim, including correct pale walls.

## Check

Reload the pack, T to each sight, B for 10x: dark spires, pale scree, white waterline,
against the two reference photos. WebGL 2 path (Firefox) still untested.

## Inversion (2026-10-04, after judging option A in game)

Layering basalt over the pale rock read as pasted-on patches. Inverted instead: the
steep-ground base is dark basalt everywhere (`dark_rock_02` at 2k, 8 m tile, replacing
the Babylon `rockyGround`), and the pale gravel lies on top of it as talus, shore and
pumice flats through the unchanged splat logic. The POI mask blend is reverted out of
the shader; its builder (`build_ground.py --basalt`) and `basalt.ktx2` stay for later
multi-rock work (e.g. a light dacite band on Llao Rock). Pumice Castle still waits for
an orange pumice texture.
