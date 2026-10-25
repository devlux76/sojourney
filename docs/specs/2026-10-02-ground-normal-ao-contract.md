# Ground normal + sky-visibility map — contract

Date: 2026-10-02. Implements decision 6 of `2026-10-02-terrain-ds716-design.md`: a baked whole-map
normal map carries the 1 m surface detail at distance, sampled by the ground material alongside the
splat map. This document is the interface contract between the bake, the pack and the ground shader.

## Files and pipeline order

| Role | Path |
|---|---|
| Bake (not shipped) | `tools/.cache/ground_normalmap/terrain_normal_ao.png` |
| Source of truth | `assets/crater-lake/ground/terrain_normal_ao.png` |
| Shipped texture | `public/packs/crater-lake/ground/terrain_normal_ao.ktx2` |
| Manifest key | `material.normalAoUrl` in `public/packs/crater-lake/ground/ground.json` |
| Bake tool | `tools/ground_normalmap.py` |
| Install stage | `tools/install_ground_normalmap.py` |

Order: `tools/build_ground.py` (rewrites `ground.json` without the entry) →
`python3 tools/install_ground_normalmap.py` → done; the install stage encodes the texture, patches
`material.normalAoUrl` into `ground.json` and rebuilds `files.json` with `tools/build_pack_index.py`.
Re-bake with `uv run --quiet --with numpy --with scipy --with pillow python tools/ground_normalmap.py`,
or let the install stage do it with `--bake`.

## Format

8192 x 8192, RGB, linear UNORM (`R8G8B8_UNORM`, transfer function `linear`), Basis Universal UASTC,
zstd level 18, full mip chain — `tools/encode_ktx2.py --linear`, same encoder as every other pack
texture. 8192 is a whole number of 4x4 blocks. Nothing about this texture is sRGB.

## Geometry

- World axes: +x east, +z north, y up; origin at Wizard Island summit; map spans 18000 m square.
- Texel size S = 18000 / 8192 = 2.197266 m.
- Pixel (row j, column i) of the source PNG covers world x in [-9000 + i*S, -9000 + (i+1)*S],
  z in [9000 - (j+1)*S, 9000 - j*S]. Row 0 = north, column 0 = west — same orientation as
  `window1m.npy` and `heightmap.bin` (row 0 = north).

## Channel packing

| Channel | Meaning | Decode |
|---|---|---|
| R | world-space normal x (east) | `nx = R/255 * 2 - 1` |
| G | world-space normal z (north) | `nz = G/255 * 2 - 1` |
| B | sky visibility 0..1 | `vis = B/255` |

ny is not stored; it is rebuilt (WGSL — the project targets WebGPU and Babylon handles any
backend conversion):

```wgsl
let packed = textureSample(normalAo, normalAoSampler, uv);
let nxz = packed.rg * 2.0 - 1.0;
let ny = sqrt(clamp(1.0 - dot(nxz, nxz), 0.0, 1.0));
let n = normalize(vec3f(nxz.x, ny, nxz.y));
let vis = packed.b;
```

Rules the shader must follow:

- The `saturate` before the `sqrt` is mandatory: per-channel 8-bit rounding can push
  `nx^2 + nz^2` marginally above 1 on near-vertical faces.
- Renormalise after any filtering. Component-wise filtering (mips, bilinear) averages unit
  vectors, which can only shrink `(nx, nz)`, so the rebuild stays valid at every mip level.
- `ny > 0` everywhere; the normal points up at the surface.

## Sky visibility

`vis = mean over 16 azimuths of (1 - sin(horizon))`, horizon from terrain alone over distances
8-480 m on a 4 m grid, bilinearly upsampled. Flat open ground = 1.0, a gully floor < 1, minimum
on the map 0.107. Use it to attenuate the sky/ambient term (`ambient * vis`); it is not a
directional-light occluder. It is derived from the same filled surface as the normals, so it is
continuous across data voids.

## Orientation invariant

The source PNG is north-up (this contract). `tools/encode_ktx2.py` applies the same vertical flip
before `ktx create` that it applies to every pack texture, and the result lands in GL bottom-up
row order, which is what `src/core/ktx2.ts`'s KTX2 loader expects. Verified on the shipped file:
`ktx extract` round-trip of `terrain_normal_ao.ktx2` matches the vertically flipped source PNG
(MAE 0.88 — UASTC noise) and is far from the unflipped source (MAE 23.3); the south-wall and
Llao Rock landmarks read +0.502 and −0.693 at the mirrored rows, identical to the source.
Consequently the texture samples exactly like the pack's other image-derived textures: derive
world to UV from the splat-map path (same mesh UVs, `u = (x + 9000) / 18000`,
`v = (z + 9000) / 18000` with north at v = 1).

In-game orientation check (all three asserted on the source PNG by the install stage):

- Wizard Island summit, world (0, 0), pixel (4096, 4096): normal ≈ (−0.05, 0.998, 0.03), near straight up.
- Caldera wall 300 m north of the south shore, world (80, −2700): block nz > 0 (ground rises south).
- Below Llao Rock on the north wall, world (935, 3600): block nz < 0 (ground rises north).

## Rebuild

```sh
uv run --quiet --with numpy --with scipy --with pillow python tools/ground_normalmap.py
python3 tools/build_ground.py
python3 tools/install_ground_normalmap.py
```
