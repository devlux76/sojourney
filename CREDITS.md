# Credits

With gratitude to [Poly Haven](https://polyhaven.com) and its artists and supporters, who
release their scanned and hand-built assets into the public domain (CC0). Sojourney's
vegetation and rocks come from their library:

| Asset in game | Poly Haven source | License |
|---|---|---|
| `public/packs/crater-lake/flora/fir.glb` (fir A/B; C retired) | [Fir Tree 01](https://polyhaven.com/a/fir_tree_01) | CC0 |
| `public/packs/crater-lake/models/trees/pine_tree_01_{a,b,c}.glb` | [Pine Tree 01](https://polyhaven.com/a/pine_tree_01) | CC0 |
| `public/packs/crater-lake/models/rocks/rock_boulder.glb` | [Moon Rock 01](https://polyhaven.com/a/moon_rock_01) | CC0 |
| `public/packs/crater-lake/models/rocks/rock_pebble.glb` | [Moon Rock 03](https://polyhaven.com/a/moon_rock_03) | CC0 |
| `public/packs/crater-lake/models/rocks/rock_07.glb` | [Rock 07](https://polyhaven.com/a/rock_07) | CC0 |
| `public/packs/crater-lake/models/rocks/boulder_01.glb` | [Boulder 01](https://polyhaven.com/a/boulder_01) | CC0 |
| `public/packs/crater-lake/models/rocks/namaqualand_boulder_02.glb` | [Namaqualand Boulder 02](https://polyhaven.com/a/namaqualand_boulder_02) | CC0 |
| `public/packs/crater-lake/models/rocks/namaqualand_boulder_03.glb` | [Namaqualand Boulder 03](https://polyhaven.com/a/namaqualand_boulder_03) | CC0 |
| `public/packs/crater-lake/models/rocks/namaqualand_boulder_04.glb` | [Namaqualand Boulder 04](https://polyhaven.com/a/namaqualand_boulder_04) | CC0 |
| `public/packs/crater-lake/models/rocks/namaqualand_boulder_06.glb` | [Namaqualand Boulder 06](https://polyhaven.com/a/namaqualand_boulder_06) | CC0 |
| `public/packs/crater-lake/models/rocks/coast_land_rocks_04.glb` | [Coast Land Rocks 04](https://polyhaven.com/a/coast_land_rocks_04) | CC0 |
| `public/packs/crater-lake/models/rocks/sand_rocks_small_01.glb` | [Sand Rocks Small 01](https://polyhaven.com/a/sand_rocks_small_01) | CC0 |
| `public/packs/crater-lake/models/shrubs/shrub_dense.glb` | [Shrub 04](https://polyhaven.com/a/shrub_04) | CC0 |
| `public/packs/crater-lake/props/stone_fire_pit.glb` (campfire ring) | [Stone Fire Pit](https://polyhaven.com/a/stone_fire_pit) by Sebastian Platen | CC0 |
| `public/packs/crater-lake/props/modular_wooden_pier.glb` | [Modular Wooden Pier](https://polyhaven.com/a/modular_wooden_pier) by Rico Cilliers | CC0 |
| `public/packs/crater-lake/props/dutch_ship_medium.glb` | [Dutch Ship Medium](https://polyhaven.com/a/dutch_ship_medium) by James Ray Cock | CC0 |
| `public/packs/crater-lake/terrain/forrest_ground_03_*` (pine needles) | [Forrest Ground 03](https://polyhaven.com/a/forrest_ground_03) | CC0 |
| `public/packs/crater-lake/terrain/brown_mud_rocks_01_*` (dark volcanic soil) | [Brown Mud Rocks 01](https://polyhaven.com/a/brown_mud_rocks_01) | CC0 |
| `public/packs/crater-lake/terrain/coast_sand_03_*` (pumice pea gravel) | [Coast Sand 03](https://polyhaven.com/a/coast_sand_03) | CC0 |
| `public/packs/crater-lake/terrain/aerial_beach_01_*` (rippled lake bed) | [Aerial Beach 01](https://polyhaven.com/a/aerial_beach_01) | CC0 |
| `public/packs/crater-lake/ground/rock_albedo.ktx2` and `rock_normal.ktx2` (exposed cliffs; albedo graded toward neutral dark volcanic rock, at the source's 2.7 m scale) | [Rock Face 03](https://polyhaven.com/a/rock_face_03), photography by Dario Barresi, processing by Rico Cilliers | CC0 |
| `public/packs/crater-lake/ground/lakeBed_albedo_array.ktx2`, `lakeBed_normal_array.ktx2` (five lake-bed bands plus a sixth shared layer for loose cinder above water) | [Aerial Beach 01](https://polyhaven.com/a/aerial_beach_01), [Forest Leaves 02](https://polyhaven.com/a/forest_leaves_02), [Brown Mud](https://polyhaven.com/a/brown_mud), [Dark Rock 02](https://polyhaven.com/a/dark_rock_02), [Red Dirt Mud 01](https://polyhaven.com/a/red_dirt_mud_01), [Gravel Floor 03](https://polyhaven.com/a/gravel_floor_03) by Charlotte Baglioni (cinder layer, albedo desaturated) | CC0 |

## Terrain

The ground's elevation source is real Crater Lake: Robinson, J.E., 2012, USGS Data Series 716, https://pubs.usgs.gov/ds/716/ (US Government
work, public domain). It is a 1 m mosaic of the bare-earth lidar flown in August-September 2010 for the
Oregon Lidar Consortium / DOGAMI by Watershed Sciences, and the July 2000 multibeam bathymetry of the
lake (Gardner and Dartnell, 2001, USGS Digital Data Series DDS-72, with the University of New Hampshire
Center for Coastal and Ocean Mapping and the National Park Service). `tools/build_heightmap.py`
cuts the 18 km window around Wizard Island, fills the empty shoreline ring between lidar and sonar, and
resamples it to 2 m.

`public/packs/crater-lake/ground/normal_tiles/*.ktx2` and
`terrain_normal_ao_far.ktx2` are derived from the same public-domain DS 716
terrain bake. They carry world-normal east/north components and sky visibility;
regional maps preserve the bake's 2.197265625 m texel spacing. The offline pipeline
adds registered border pixels and full mip chains, with a smaller whole-map
representation for distant terrain. No additional source asset or licence is used.

`public/packs/crater-lake/ground/terrain_relief_normal.ktx2` is derived from the same
public-domain DS 716 lidar, using a 64 m crop at Llao Rock (world x=935, z=3800).
`tools/build_terrain_relief.py` records its registration, removes the crop's broad
slope and boundary discontinuity, and retains 2–16 m wavelengths. Babylon's Node
Material Editor HeightToNormalBlock bakes the tangent normal in the authoring
harness; no third-party photograph or uncredited texture is used for this asset.
`ground/rock_normal_relief.ktx2` combines the CC0 Rock Face 03 micro-normal XY in
RG with that public-domain lidar-derived normal XY in BA; each is sampled at its
own world scale. It retains the existing rock texture's GPU dimensions and binding.

Where each ground layer is painted (`public/packs/crater-lake/ground/splatmap.png`) is derived from that
elevation and from two National Park Service datasets: the Crater Lake vegetation map (NPS Vegetation
Mapping Inventory, 2018, https://irma.nps.gov/DataStore/Reference/Profile/2254202) for the open pumice
and the cliff-and-scree units, and the canopy-height grid from the same 2010 lidar survey
(https://irma.nps.gov/DataStore/Reference/Profile/2254189) for where trees stand.
Both are US Government works, public domain. `tools/ground_structure.py` stages the masks and
`tools/ground_splat.py` paints from them.

The alpha channel of `public/packs/crater-lake/ground/splatmap.ktx2` contains
substrate classes derived from Charles R. Bacon's [Geologic Map of Mount Mazama
and Crater Lake Caldera, USGS SIM 2832 (2008)](https://pubs.usgs.gov/sim/2832/),
database by David W. Ramsey, Dillon R. Dutton and Charles R. Bacon. US Government
work, public domain. `tools/build_terrain_geology.py` reprojects the original
ArcInfo coverage from NAD27 Oregon South, checking Wizard Island cinder and
Phantom Ship andesite against surveyed points. These classes guide authored
surface-colour grades; they are not measured spectral reflectance or a replacement
for the report's detailed units and vertical caldera-wall sections.

The forest (`public/packs/crater-lake/flora/forest.json`, `leaves/`, `mid/`) comes from the same two
datasets: every tree stands where the canopy-height grid has a crown top and is scaled to the height
measured there, and it is a fir or a pine by the vegetation map unit it stands in. Both are US
Government works, public domain. `tools/build_forest.py` places them.

The Llao Rock wall's look target (`docs/research/llao-rock-boat/`, and any rock/scree albedo sampled
from it into the ground pack) is a National Park Service boat-tour photo of Llao Rock — a US Government
work, public domain — plus an AI-upscaled copy used for texture extraction. No snow is modelled from
it: the photo's white areas are early-season snow over glacial scree, and the game runs midsummer
(15 June + 60 days), so they are built as pale scree.

## How the GLBs were made

Trees keep only the LOD1/LOD2 meshes from the original `.blend`, exported with
`tools/export_polyhaven_lods.py` (the pine is additionally decimated):

```
blender --background fir_tree_01_1k.blend --python tools/export_polyhaven_lods.py -- \
  public/packs/crater-lake/models/trees fir_tree_01 LOD1,LOD2 a,b,c
blender --background pine_tree_01_1k.blend --python tools/export_polyhaven_lods.py -- \
  public/packs/crater-lake/models/trees pine_tree_01 LOD1,LOD2 a,b,c LOD1:0.11,LOD2:0.07
```

Rocks and the shrub are the 1k glTF downloads, trimmed to one mesh (boulder: LOD1 + LOD3),
scaled to 1 m (boulder, shrub width) or 0.3 m (pebble) with the base at y = 0, and textures
resized to 512 px using [glTF Transform](https://gltf-transform.dev).

Then every model's textures are re-encoded as KTX2 (Basis Universal UASTC, Zstandard) by
`python3 tools/compress_textures.py <models>`, so they stay compressed on the GPU.

Terrain layer textures are Poly Haven's 1k JPG diffuse maps (plus the OpenGL normal map for the
land layers), unmodified. The lake bed's five depth bands ship instead as two KTX2 texture arrays
(`ground/lakeBed_albedo_array.ktx2` and `ground/lakeBed_normal_array.ktx2`, one 1k layer per band),
built by `python3 tools/build_ground.py --bed` (full build: `python3 tools/build_ground.py`).
`public/packs/crater-lake/terrain/splatmap.png` is generated from the heightmap by
`python3 tools/generate_splatmap.py` (R = sand, G = pine needles, B = dirt, remainder = rock)
and can be painted by hand afterwards; re-running the script overwrites edits.

Tree and shrub sprites in `public/packs/crater-lake/models/trees/impostors/` are renders of the models
above, baked by opening the dev server with `?bakeImpostors`. Each has two: `_0.ktx2` and friends are
the albedo, and the `_0_n.ktx2` files are the surface normals of the same captures, so a distant tree
shades like the tree it was made from rather than like a flat card. Both come from the same bake and
are regenerated together. Hand edits survive neither — re-baking overwrites them.

## Easy mode

The held tools, logs, stumps, campfire stones and bobber are simple shapes built in code, and
the play sounds (axe, falling tree, sparks, crackle, cast, splash, eating) are synthesised with
the Web Audio API at runtime: no third-party models, and no recordings but the fishing plop, reel and
fish and the fire in the rain, which are listed under Sounds. The flame and
smoke particles reuse `public/textures/flare.png`.

## Sounds

Recordings in `public/packs/crater-lake/audio/`, sourced by the project lead.

| File | Source | Author | Licence |
|---|---|---|---|
| `walking_on_sand_and_gravel.mp3` | "Walking on sand and gravel", Pixabay sound 95920 | freesound_community | Pixabay Content License |
| `underwater.mp3` | "Underwater", Pixabay sound 6236 | freesound_community | Pixabay Content License |
| `thunder.ogg`, `footstep_wood_1.ogg` to `footstep_wood_4.ogg` | "100 CC0 SFX #2" (https://opengameart.org/content/100-cc0-sfx-2): `sfx100v2_thunder_01`, `sfx100v2_footstep_wood_01` to `_04` | rubberduck | CC0 |
| `campfire_in_rain.ogg` | "Campfire sound ambience" (https://commons.wikimedia.org/wiki/File:Campfire_sound_ambience.ogg), from Freesound | Glaneur de sons | CC BY 3.0 |
| `fishing_plop.ogg`, `fishing_reel.ogg`, `fishing_fish.ogg` | Freesound: "FieldRecording_FishingHook_1" (https://freesound.org/people/omiranda14/sounds/789549/, the plop alone, cut to 1.2 s), "FieldRecording_FishingReelMechanism_3" (.../789553/, end silence cut), "FieldRecording_CatchedFishSimulated_1" (.../789546/); re-encoded from WAV to Ogg Vorbis | Omiranda14 | CC BY 4.0 |
| `quiet_surf_on_the_lake.mp3` | Freesound: "quiet surf on the lake" (https://freesound.org/people/savvah/sounds/345120/), unaltered | savvah | CC BY 4.0 |
| `ships_bell.ogg` | Freesound: "Nautical SFX Short with Fade Out" (https://freesound.org/s/727234/), re-encoded from WAV to Ogg Vorbis | OctillionVG | CC0 |
| `birds_and_water.ogg`, `outside.ogg`, `night_rain.ogg` | "Nature Sounds Pack" (https://opengameart.org/content/nature-sounds-pack): `AmbientNatureBirdsWater01`, `AmbientNatureOutside`, `AmbientNatureNightRainy`, re-encoded from WAV to Ogg Vorbis | Antoinemax | CC BY 4.0 |

## Night sky

- Stars: Yale Bright Star Catalogue, 5th revised ed. (Hoffleit & Warren, 1991), public domain, via CDS VizieR V/50.
- Milky Way: "Deep Star Maps 2020", NASA/Goddard Space Flight Center Scientific Visualization Studio (https://svs.gsfc.nasa.gov/4851). Free to use with credit.
- Moon: "CGI Moon Kit", NASA/Goddard Space Flight Center Scientific Visualization Studio (https://svs.gsfc.nasa.gov/4720), from Lunar Reconnaissance Orbiter data. Public domain.

## Boat tour route

`public/packs/crater-lake/route/boat_tour.json` (built by `tools/build_route.py`) is guided by the
"Wizard Island Tour" ferry route in [OpenStreetMap](https://www.openstreetmap.org/copyright)
(way 429536581): © OpenStreetMap contributors, Open Database License. Only its points over deep
water are used, as waypoints; the path between them is found over the USGS lake bed.

The sights the ship stops at (Pumice Castle, Phantom Ship, Devils Backbone, Llao Rock) are named and
placed from the U.S. Geological Survey's Geographic Names Information System
(https://www.usgs.gov/tools/geographic-names-information-system-gnis), US Government work in the
public domain.

## Tour guide's voice

`public/packs/crater-lake/audio/tour/` (built by `tools/build_narration.py` from our own script in
`tools/narration/crater-lake.json`) is spoken by [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)
(hexgrad, Apache-2.0), voice `af_heart`. The build runs it through
[kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) (MIT), which uses eSpeak NG (GPL-3.0) to turn
text into sounds; neither ships with the game, only the recordings do.

## Live voice and narrator (run in the player's browser)

Offered at the sound check as downloads the player chooses to try (`src/narrator/`); none of the
models is in the game's own files, each is fetched from Hugging Face when asked for.

- [Transformers.js](https://github.com/huggingface/transformers.js) (Hugging Face, Apache-2.0), which
  bundles [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (Microsoft, MIT), runs the models.
- Live voice: [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) (hexgrad,
  Apache-2.0), voice `af_heart`. `src/vendor/kokoro/phonemize.ts` is from
  [kokoro.js](https://github.com/hexgrad/kokoro) (Apache-2.0) and uses
  [phonemizer](https://github.com/xenova/phonemizer.js) (labelled Apache-2.0), which bundles eSpeak NG
  compiled to WebAssembly (GPL-3.0); this one does ship in the game's script bundle.
- Narrator model: [LFM2.5-1.2B-Instruct](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-ONNX)
  (Liquid AI; licence listed on Hugging Face as `lfm1.0`, in the model's `LICENSE` file).

## Procedural wood authoring

`public/packs/crater-lake/play/wood_albedo.ktx2` and `wood_normal.ktx2` are original
Sojourney wood maps authored offline from `tools/materials/wood` with full mip chains.
`tools/materials/wood/source.json` is original Sojourney material authoring, built with
Babylon.js native Node Material noise, PBR and height-to-normal blocks. The A/B inspection
pilot uses the original CC0 Poly Haven Fir Tree 01 geometry; its procedural appearance
was selected as wood by the project lead, not accepted as finished tree bark.

`public/packs/crater-lake/play/bark_scales_normal.ktx2` reuses the fine relief of
[Dark Rock 02](https://polyhaven.com/a/dark_rock_02), Poly Haven, CC0, also used on Phantom Ship.
It is resized and renormalized offline for fingernail-scale bark plates, with full mip chains.

## Babylon.js asset library

`public/textures/environment.env`, used for lighting in the developer source-asset inspector,
is inherited from the [Babylon.js Assets library](https://github.com/BabylonJS/Assets),
by the Babylon.js contributors, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
It is used unchanged.

The inspector loads the unchanged 4k glTF of [Fir Tree 01](https://polyhaven.com/a/fir_tree_01)
from the local source cache (Poly Haven, CC0), selecting the artist's variant C at LOD0.
These cached source files are not included in the production game build.

No longer ships ground textures: the rock layer is Poly Haven's Dark Rock 02 (row above),
replacing the library's "rockyGround". (Copies of `rockyGround_basecolor.png` and
`rockyGround_normal.png` remain in `assets/crater-lake/models/rocks/` for reference.)

## Software shipped with the game

`public/ktx2/` (fetched by `python3 tools/vendor_ktx2.py`) decodes KTX2 textures offline:
Babylon.js's KTX2 decoder and transcoders (Apache-2.0, Microsoft and Babylon.js contributors),
built on Binomial's [Basis Universal](https://github.com/BinomialLLC/basis_universal) (Apache-2.0)
and Meta's [Zstandard](https://github.com/facebook/zstd) decoder (BSD).

The optional AgX comparison shader in `src/engine/environment/agxToneMapping.ts` is adapted from
[three.js r180](https://github.com/mrdoob/three.js/blob/r180/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js),
Copyright © 2010–2025 three.js authors, MIT. The complete licence ships in
`public/licenses/three-agx.txt`. Babylon retains exposure, white balance, gamma conversion and dithering.
