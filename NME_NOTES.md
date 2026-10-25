# Babylon Node Material Editor notes

Recorded against installed Babylon.js and MCP servers **9.29.0**, 2026-10-06.
Treat these as observed behaviour at this version. Recheck installed source after upgrades.

## MCP and editor workflow

### Cross-project lessons retained, 2026-10-11

- Read the verified tutorial notes in `/home/mirai/projects/sojourney2/babylonjs-node-render-graph_NOTES.md` and its class-to-MCP mapping in `AGENTS.md` before using render graphs. Those observations are for Babylon 9.29.0; check installed source after upgrades.
- The render-graph MCP exports only explicitly set properties. Deserialization can overwrite constructor defaults with `undefined`: explicitly export relied-on properties such as ObjectRenderer `depthTest: true`, `depthWrite: true`, `disableShadows: false`, and `isMainObjectRenderer: true`. Check runtime values, not just graph validation.
- InputBlock `type` also needs an explicit property in the exported graph; constructor parameters alone were insufficient. External camera/object/backbuffer inputs require `isExternal: true`. Clear colours serialize as arrays.
- Use actual installed block property names: shadow filtering is `filter`/`filteringQuality`, not guessed `useXxxShadowMap` properties. The tutorials verified PCSS with manual directional-light extents; earlier PCF/ESM failures preceded that extents fix and are not proven filter limitations.
- With a frame graph, `scene.activeCamera` can be null outside tasks and many scene observables do not fire. Set `cameraToUseForPointers` and verify camera-dependent code before integration. Post-process sources need internal textures; the backbuffer can be the final target. `dependencies` preserve resource lifetime, not task order; geometry-only renderers should omit unused target/depth connections.
- Use graph MCPs for their supported authoring types. Existing PBR MaterialPlugin shader hooks require code changes followed by real-browser compilation and visual checks; NME graph validation does not validate those hooks.
- Keep newly verified MCP surprises here (or in the matching MCP notes): record version, symptom, cause, workaround, and runtime evidence. Label unverified hypotheses and distinguish application mistakes from MCP behavior. Export graph state to tracked files before ending a session.

### VS Code connection repair, 2026-10-07

The installed package included all seven editor servers, but the Codex extension's
shared `~/.codex/config.toml` registered only `babylonjs-nme` and Chrome DevTools.
The other six Babylon servers were missing configuration entries, rather than
failing to initialize. Added `babylonjs-nge`, `babylonjs-npe`, `babylonjs-gui`,
`babylonjs-flow-graph`, `babylonjs-smart-filters` and `babylonjs-nrge`, preserving
the existing connections and other settings. Each starts with Bun, its installed
`node_modules/@babylonjs/mcp-servers/dist/<editor>-mcp-server.js`, the project as
working directory and a 30-second startup timeout; no download is needed.

All six passed MCP `initialize`, `tools/list` and a read-only `tools/call` through
stdio. Their catalogs contain 25, 25, 29, 26, 29 and 24 tools respectively (158
total). This verifies server operation, not geometry/particle/rendering results.
The active chat retained its original tool catalog after the configuration edit;
refresh the Codex extension in VS Code and verify callable tools before dependent
asset authoring. The installed extension restarts its app server using VS Code's
`Developer: Reload Window` command. Do not treat omitted connections as a reason
to bypass the relevant Babylon MCP workflow.

### Original NME observations

- The callable server in this Codex session is `babylonjs-nme`. Having the server in
  Codex configuration is insufficient: its tools must appear in the current session.
- Create/import a material, add blocks, connect ports, validate, then export JSON.
  Read block IDs from tool results; do not invent IDs or assume a fresh graph's range.
- The session URL is a local document endpoint, **not the editor page**. Open
  `https://nme.babylonjs.com/`, connect its MCP Session panel to the returned URL.
- MCP edits update the server's graph. **Push to MCP sends the editor's graph back
  to the server**; it is useful after editor-side edits, and is unnecessary while
  the assistant edits directly through MCP. Avoid competing edits in both places.
- Graphs held in MCP memory need an export to survive loss/restart of that process.
  Commit the exported JSON to a tracked authoring directory. `assets/` is ignored
  here; current relief graphs live in `tools/materials/terrain-relief/`.
- This repo's Vite watcher ignores `tools/` and `public/packs/`. Reloading may not
  invalidate an imported graph JSON module, so the authoring harness fetches JSON
  with `cache: "no-store"`. Newly created public assets can be absent from Vite's
  public-file index: a texture URL then returns **200 HTML**, causing a misleading
  "texture missing KTX identifier". Check response bytes/content type and restart
  the dev server after adding pack files. The material harness uses `/public/`
  root-file serving for the new asset until that restart; production uses pack URLs.
- Validation checks graph structure. It does **not** compile GPU shaders, confirm
  texture readiness, check GPU binding limits, or establish visual quality/speed.
  Load exported JSON using the installed Babylon version and render both backends.
- Batch operations can partly succeed. Inspect every result before continuing.

## Serialization and runtime loading

- Use enum names in MCP properties, e.g. `type: "Vector3"`, not guessed enum numbers.
- Input values are serialized with `valueType`, e.g. `BABYLON.Vector3`, and arrays.
  `InputBlock._deserialize()` resolves these names through Babylon's type registry.
- **Observed whole-package import trap:** `import * as B from "@babylonjs/core"`
  exposed `Vector3`, but `B.GetClass("BABYLON.Vector3")` was undefined in the Bun
  probe and browser. A vector constant then failed in `InputBlock._emitConstant`
  with `Cannot read properties of undefined (reading 'x')`.
  Call Babylon's `RegisterMathVector()` and `RegisterMathColor()` before parsing
  graphs containing those values. These are Babylon's existing registration APIs.
  Source: `Maths/math.vector.pure.js`, `Maths/math.color.pure.js`,
  `Materials/Node/Blocks/Input/inputBlock.pure.js`.
- An `ImageSourceBlock` needs a real `Texture` bound to `.texture` in the runtime
  scene. An empty image block passing graph validation does not prove it samples
  the intended image. Set normal/height texture `gammaSpace = false`.
  Current relief exports embed their small height image in serialized `.texture`,
  so the NME editor preview works without an external asset server. The prepare
  tool updates that image and the height amplitude together; re-import its exports
  to refresh a live MCP session after changing the source.
- **Port names can include whitespace.** In this version, VectorSplitterBlock's
  three-component input is literally `"xyz "` (trailing space); `"xyz"` fails.
  Discover exact ports with `get_block_type_info`, then use the exact returned name.

## Relief authoring findings

### WebGPU: request the adapter's limits, not just the defaults

**Observed on this AMD GPU:** the terrain comparison initially failed with:

```text
The number of sampled textures (19) in the Fragment stage exceeds the maximum
per-stage limit (16). This adapter supports a higher
maxSampledTexturesPerShaderStage of 48, which can be specified in requiredLimits
when calling requestDevice().
```

**16 was the default requested device allowance, not this GPU's hardware ceiling.**
Babylon already provides `setMaximumLimits: true` to request the adapter's supported
limits. Use that option at WebGPUEngine creation; do not hardcode 48 for other GPUs.
`enableAllFeatures: true` requests supported features and is a separate option.

Sojourney's `src/core/Engine.ts` already passes both options through
`WebGPUEngine.CreateAsync`. The first terrain comparison harness omitted them,
which created an artificial 16-texture restriction. It now matches the game.
Check the adapter's advertised limits and the created device's actual limits;
the requested limit cannot exceed what that adapter supports.

Existing terrain comments claiming the whole material always fits 16 bindings
were inaccurate: count the complete compiled shader, including atmosphere and
Babylon's own textures, rather than the terrain plugin alone. Packing normals is
still useful to avoid adding a binding, but is not evidence of a universal ceiling.

### Authoring and material composition

- Current terrain uses a PBRMaterial with TerrainMaterialPlugin plus other
  plugins. NodeMaterial is a separate material; replacing PBRMaterial with a small
  NME graph also requires preserving atmosphere, tile fades, skirts, lake bed,
  caustics, wetness and distant forest painting. Do not assume plugin compatibility.
- The selected U19 work is material relief first, without denser terrain meshes.
  NME's native HeightToNormalBlock is being used **offline** to author a normal map.
  The game will sample the authored asset, consistent with the asset pipeline rule.
- HeightToNormalBlock uses screen derivatives. Its input positions must be actual
  world metres and the height input must also be in metres for predictable strength.
  Read the installed implementation before choosing the bake plane/orientation.
- The normal bake uses an XZ plane and world normal +Y, then converts world XYZ
  into tangent XZY. **A render that looks plausible can still point the wrong
  way:** analytical increasing-X and increasing-Z height ramps initially produced
  RGB `(137,128,255)` and `(128,137,255)`, i.e. positive slopes instead of normals
  opposing the increasing height. For this plane/camera/left-handed setup, the
  native block output needs tangent XY inverted before encoding. The graph now
  uses `tangentConvention = (-1,-1,1)`; both backends return `(118,128,255)` and
  `(128,118,255)`. `reliefBake.checkNormalDirections()` reads GPU pixels and throws
  for the wrong signs. Treat this convention as verified for this bake setup,
  not a universal instruction to invert every normal map. Both backend bakes render
  on the real AMD GPU. Maximum unit-normal error is 0.0065 after 8-bit encoding.
  WebGL versus WebGPU pixels differ by 0.33 byte on average (largest difference 7),
  consistent with derivative sampling differences; do not claim bitwise equality.
- The runtime packs the original rock normal XY into RG and NME macro normal XY
  into BA of `rock_normal_relief.ktx2`. Positive Z is reconstructed using Babylon's
  native detail-normal convention (`ShadersInclude/bumpFragment.js`). Both pairs
  use the same texture binding and their own repeat scale. The packed map has the
  original rock map's dimensions and BC7/ASTC footprint, plus a full authored mip
  chain. It increases download size, not binding count or mesh triangles.
- The terrain comparison renders on WebGL2 (no compilation error, `getError() = 0`)
  and WebGPU with the adapter's 48-texture allowance (validation error scope = null).
  The full game downloaded all 5,105 indexed files and completed travel through
  the ship, Wizard Island and Llao Rock without a captured console error. All
  1,311 near GLBs have valid headers and every indexed file exists. No speed
  improvement is claimed.
- Full-quality inspection uses clear weather, fog disabled and optimizer decisions
  paused **in the browser session only**, at the lead's request. Reloading restores
  normal settings. The material harness already omits the game optimizer and keeps
  a fixed LOD for controlled comparisons; it cannot establish final streaming quality.
- Avoid `Runtime.queryObjects` heap scans in the live Havok scene: an attempt to
  enumerate SceneOptimizer instances stalled the inspection renderer and its CDP
  calls. Closing that inspection target and opening a new one recovered gameplay.
  Use existing references and ordinary camera APIs; do not repeat the heap scan.
- **Pack-cache trap:** the indexer originally hashed paths and sizes only. A
  same-size texture edit could therefore keep the old cache version. It now
  includes actual file content hashes. The regression check exercises two distinct
  five-byte files and verifies version change plus stability on an unchanged rerun.

## Current authoring commands

1. `python3 tools/build_terrain_relief.py --prepare` updates source metadata,
   embedded height image and graph amplitude from the registered lidar cache.
2. Run `bun run dev`; open `/harness/terrainRelief.html?backend=webgpu` (or omit the
   query for WebGL). Save its normal image using the authoring download button.
3. `python3 tools/build_terrain_relief.py --install <saved PNG>` validates normal
   length, encodes the linear KTX2 maps, packs RG/BA and updates the pack manifest.
4. Restart Vite after adding public files; inspect `/harness/terrainMaterial.html`
   with either backend. `terrainCompare.compare(false/true)` performs material A/B
   on identical geometry, camera and lights. These controls exist only in the
   authoring harness; the game has no relief feature switch.

## Related prior learning

Read `/home/mirai/projects/sojourney2/babylonjs-node-render-graph_NOTES.md` and
`RESUMPTION.md` for that separate project's framegraph findings. Relevant common
lessons: editor/MCP/runtime are three distinct steps; check exported defaults and
exact property names against installed source; a successful validator is not a
successful runtime render. Framegraph-specific fixes are not automatically NME fixes.


## E8 play-material pilot

Initial capability inspection found NME's PBRMetallicRoughnessBlock and the
Atmosphere addon's automatic stock-PBR-only plugin attachment. That established an
automatic attachment gap, not that manual NME integration cannot work. At the lead's
request, a native NME PBR/reflection/fog/image-processing pilot is exported to
tools/materials/play-pbr/pilot.json and tested before production adoption.
Constructor defaults must establish its material parameters; runtime binding may
supply changing atmosphere inputs.

Observed graph traps in this pilot:
- ImageProcessingBlock.color requires Color4: FogBlock.output is Color3, and MCP
  rejects that direct connection. Use ColorMergerBlock, with explicit alpha 1.
- ColorMergerBlock's three-channel input is literally `rgb ` (trailing space), like
  the VectorSplitterBlock port noted earlier. Preserve exact discovered names.
- Inspect partial batch results: the other reflection/output connections succeeded
  when the image-processing connection failed. Repair that input before validation.

Pilot runtime result (headed Chrome WebGL 2 / AMD): stock PBR and both NME
variants compile and become ready. Explicitly attaching AtmospherePBRMaterialPlugin
to the NodeMaterial registers the plugin, but its compiled fragment source remains
identical in size (63,368 characters) to the bare graph and contains no
sampleTransmittanceLut. Stock PBR's shader contains it (76,365 characters). Thus
plugin registration alone does not inject the addon code into NodeMaterial here.
The noon/sunset three-sphere comparison shows the NME dark side going black.
Next pilot wiring uses Atmosphere.getDiffuseSkyIrradianceToRef, Babylon's existing
LUT query API, as the graph's sky ambient input. That API already applies additional
sky irradiance and diffuseSkyIrradianceIntensity; do not add them a second time.
This is a uniform sky-fill experiment, not full per-normal or aerial-perspective parity.


## Regional normal/AO maps — 2026-10-07

The callable Babylon MCP catalog has graph/material/geometry editors, but no raster
crop or KTX2 encoder. This asset family uses the offline Python/KTX pipeline;
no unrelated graph tool was substituted for image processing. Runtime loading,
URL-based texture sharing, mip filtering, UBOs and material hard-bind hooks use the
installed Babylon implementations (`texture.pure.js`, `pbrBaseMaterial.pure.js`,
`materialPluginManager.pure.js`). There is no custom decoder or per-tile material.

`tools/tile_ground_normalmap.py` registers 81 padded 2 km crops at the original
8192/18 km density and authors a 2048 distant map. Mips are sampled from a common
whole-map pyramid. A first 1 km pilot revealed UASTC block-phase differences at
mips 3–4 despite matching source pixels. Aligning crop origins to 64 texels and
grouping existing blocks on 2 km boundaries makes the tested decoded overlaps
identical through mip 4 without changing terrain meshes. Deeper mip tails still
represent local regions; they are not claimed identical to whole-map tails.

Terrain's normal/AO binding uses Babylon's extra-event `hardBindForSubMesh` because
normal binds can be skipped between meshes sharing a material. The shader's UV
rectangle and texture must both update per draw, including render targets. WebGPU
has a dedicated clamp sampler for this map; repeating ground layers still share
their existing sampler. Standalone GLSL scenes also require an explicit highp
sampler2DArray precision declaration. Eight rendered fixture checks cover cached
shared-material draws, independent maps/UV registration and release fallback on
AMD WebGL2, with GL error 0. This reboot's headed Chrome reports no WebGPU adapter;
WGSL backend verification remains pending, not inferred from GLSL success.
