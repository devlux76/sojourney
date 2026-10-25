# Sojourney v1 — issues blocking release

Every item here blocks shipping Sojourney v1 (project lead, 2026-10-02). Work that needs a substantial
rewrite is not here; it is a target for the v2 game in `sojourney2.md`.

Found in the playtest of 2026-10-02: Babylon.js 9.29, WebGPU, 1276×591, SceneOptimizer held off
(`targetFps: 1`), everything on. Screenshots, videos and logs are in `tools/.cache/shots/playtest/` (not
committed); every shot's camera position is in `tools/.cache/shots/playtest/coords.md`.

Issues are grouped into passes: items that share a cause, a file or a test, to be fixed and rechecked
together. From 2026-10-03 they are worked from the top of this file down, which is the reverse of their numbers
(project lead): the code efficiency review first, since it lifts the frame rate under everything
else, then water, the play objects and the ship. The flora rebuild (P1, still the highest-priority
defect) runs alongside with a delegate, and the sky and light pass is done but for what it lists as open.

The letter of each ID is the layer where the root cause sits: **E** engine (`src/`), **P** pipeline
(`tools/`, what builds the pack), **B** biome (the destination's own data and choices in `src/biomes/`
and the pack), **S** shipping (licences, credits and the download), **Q** a quality check. **U** means
the cause is not established, even if there is a guess. "Missing" marks something never built, as
opposed to built wrong.

## Quality checks

Reviews to run, not defects found in the playtest.

- **Q1. Code efficiency review** (project lead, 2026-10-02). Go over the engine (`src/`) and the
  pipeline (`tools/`) for wasted work that can be refactored out, and for faster code paths. Examples:
  buffers copied where a view or a transfer would do (typed-array views, transferable `ArrayBuffer`s
  between workers, pack data handed to the GPU without an intermediate copy); nested loops and repeated
  scans; work done every frame that could be done once or only on change; allocations in per-frame code
  that feed the garbage collector. Measure before and after, and keep only changes that show a gain. This
  must not change what is drawn (rule 3: the target frame rate is the only trade of quality for speed) and
  must not replace a Babylon feature with our own (rule 1).
- **Q4. Shader and rendering review** (project lead, 2026-10-03). A complete review of all shader and
  rendering code to make sure it is optimal: that it uses the best techniques and practices to
  drive the hardware correctly and gets all the performance there is out of the available compute
  and video memory. Covers the material plugins and their GLSL and WGSL (`TerrainMaterial.ts`, the
  sky, fog, clouds and water), the shadow cascades, the lake mirror and other render targets, the
  post-processing pipeline, texture formats, sizes and counts per material, and how instances and
  levels are submitted. Not started.

  **Measured 2026-10-03** (WebGPU, 1276×591, optimizer off, clear 11:00; rim viewpoint 82, 286, −2956
  facing north unless noted):
  - Of a 107 ms frame, 35 to 55 ms was the game's JavaScript: about 24 ms issuing draw commands, 7.6 ms
    choosing what is in view (4,313 meshes in the scene), 5.6 ms on the mirror and shadow passes. All of
    our own per-frame callbacks together took about 3 ms, so they are not where the time goes.
  - The ground was 27 ms of it: 484 leaves in view, each its own draw command at about 56 µs, against
    6 ms for the ship, trees, rocks and everything else. Freezing the ground material changed nothing.
  - **Done: the far ground is drawn in blocks.** `tools/build_ground.py` also writes the leaves of each
    1 km square joined into one mesh at levels 3 and 4 (`blocks.glb`, 150 blocks covering 1,158 of the
    1,311 leaves, 5 MB), and `src/engine/groundStream.ts` draws a block in place of its leaves once
    all of them have reached that level. Ground draw commands at the rim fell from 484 to 148 and their
    time from 27 ms to under 11 ms; the view is the same (`tools/.cache/shots/light-pass/10-ground-blocks-summit.jpeg`).
  - The frame rate at full resolution did not change (8.9 fps before and after): there the graphics
    card is the limit. With the pixels cut to a sixteenth it rose from 14.7 to 16.6 fps, so the card is
    also limited by something other than pixels, most likely the three million tree instances.
  - Not done, and where the rest of the script time is: replaying recorded draw commands with no
    per-mesh JavaScript (WebGPU snapshot rendering, a v2 item in `sojourney2.md`); 230 leaves are still
    enabled near the camera and a block of two leaves saves little.
  - **GPU time, measured directly** (project lead's method: Babylon's `EngineInstrumentation` with
    `captureGPUFrameTime`). On WebGPU Chromium hides the timings unless started with
    `--enable-dawn-features=allow_unsafe_apis` (now in `start-game.sh`); these figures are from the
    game's WebGL 2 path, where the timer works without it. At the rim the card takes 108 ms of a 113 ms
    frame. What each part costs, by switching it off: all trees 57 ms; shadows 40 (of which casters 23
    and receiving them 17); half the resolution 40; the 92 near tree models 31; far tree cards 19; the
    ground 17; anti-aliasing 10; mid tree cards 5; bloom 3; sharpening under 1. The parts overlap.
  - **Done: far instances past the shadows' reach cast none.** Each species' far mesh is split in two
    at the shadow distance (600 m) and the part beyond it is left out of the shadow pass
    (`src/engine/flora.ts`, `beyond`). At the rim that is 11,836 of 21,655 far instances, and the card's
    time fell from 108 to 105.7 ms. The piers and the ship in the shadow list kilometres away cost
    under 1 ms (Babylon already draws their coarsest level), so they are left in.
  - **Measured, not built: drawing only the instances in view.** About four fifths of the far and mid
    instances at the rim are behind the camera, since a species is one mesh and Babylon does not cull
    instances one by one. Cut into four quadrants around the camera so that Babylon culls whole
    quadrants, the card would save 4.7 ms there (measured by filtering the buffers by hand), for about
    20 more draw commands in view and about 60 more in the lake's mirror, which draws its whole list.
  - **Done: the splat map is KTX2.** It was the one ground texture still shipped as a PNG, which the
    graphics card holds unpacked: 4096 x 4096 RGBA, 64 MB before mip levels, against 16 MB as BC7.
    Compared in one session by swapping the two on the live material: no difference in GPU time
    (143.9 ms both ways), and the picture differs by a third of one level in 255 on average. The
    download is 13.4 MB instead of 15.8 MB. So it saves video memory, not frame time.
  - `tools/build_ground.py --meshes` rebuilds only the leaf, block and collision files (6 minutes). The
    build now fetches the mesh compressor once before its parallel jobs: started together on an empty
    cache they failed on each other's files.


## Pass 7: under the lake

Found 2026-10-03 on the first dive to the deepest point: (4950, 1705) in the east basin, 593 m down,
now the place "Deepest point of the lake" on T (a swimmer who lets go floats up; hold C to stay). Shots
are in `tools/.cache/shots/deep-floor/`.

- **E12. Fixed (2026-10-03): the floor of the lake was as bright as the shallows.** At 593 m the bed
  was sunlit, the water around the diver was bright blue, and the flashlight added nothing. The ground
  shader now dims the sun, the moon and the sky's light by the depth of water over each point of the
  bed (`daylightLeft` in `src/engine/TerrainMaterial.ts`), and the water's own glow by the diver's
  depth (`src/engine/underwater.ts`). Daylight falls to 1/e every 40 m (`DAYLIGHT_DEPTH_METRES`,
  `src/engine/lake.ts`): half is left at 28 m, 3% at 140 m where the moss ends, none on the deep
  floor. The real lake's figure is nearer 22 m; it is stretched because an eye adapts and the camera
  does not. Spot and point lights (the flashlight) are not dimmed, and caustics fade out over the top
  few metres. The ground plugin now runs after Babylon's atmosphere plugin, which sets the sun's colour
  at the same per-light hook and had overwritten the dimming. Not done: trees, rocks, water plants and
  props under water are not dimmed (the water plants reach 30 m down, where half the light is left).
- **B4. Missing: the lake bed is shore sand all the way down** (project lead's research, 2026-09-27;
  seen 2026-10-03). The whole bed is one rippled-sand texture (Poly Haven `aerial_beach_01`). Wanted,
  going down: bright sand and gravel at the shore; moss beds on the slopes from 26 to 140 m; a dim
  plain of fine sediment; and in the deep basins dark fractured basalt with rust-gold bacterial mats
  around the vents. Chosen from Poly Haven (all CC0): `forest_leaves_02` (hummocky green-brown moss)
  for the moss beds, `brown_mud` for the sediment, `dark_rock_02` for the basalt and
  `red_dirt_mud_01` for the mats. The pipeline has to bring them in and the bed shader blend them by
  depth; the ground material already binds 19 textures, so they should go in as layers of one texture
  array, not as eight more textures.
  **Built 2026-10-03, to be judged by the project lead.** `tools/build_ground.py --bed` packs the five
  bands at 1k into two KTX2 texture arrays (albedo and normals), and the bed shader blends them by
  depth: sand to about 25 m, moss to about 140 m, sediment to about 260 m, basalt below, with mats in
  noise-shaped patches over the basalt that grow commoner towards the deepest basins. The boundaries
  are roughened by noise, and steep walls show basalt whatever the depth. Seen in a night descent
  with the flashlight (`tools/.cache/shots/deep-floor/27-night-descent-27m-to-294m.webm`) and at the
  deepest point (shot 25): the sediment reads as grey rippled mud and the deep floor as fractured dark
  rock under a rust-gold gravelly mat. Open: the moss band reads as yellow straw under the lamp, not
  green moss, so `forest_leaves_02` may be the wrong pick; and only the WGSL half has ever run.
- **Q3. In pitch dark on the lake floor the game runs at 22 to 30 fps** (project lead, 2026-10-03:
  "pitch black dark under the water should be a whole lot higher FPS than 30"). Under water the fog
  closes the view to 40 m, yet from the floor at 593 m the game still draws 164 ground meshes, 7,700
  tree and rock instances, 1.5 million indices, and the sun's shadows with 73 casters. Q2 skips what
  the rain fog hides; the water hides far more and nothing is skipped for it. Wanted: under water,
  draw only what the water lets through, and nothing above the surface once it is out of sight.
  **Fixed 2026-10-03.** The water fogs as the rain does, so it has a reach of its own (61 m at the
  default 40 m visibility; `Underwater.reach`), and the ground and the forest skip what lies past
  it exactly as they do in rain. Props (the ship, the piers) are now skipped the same way, in rain
  too, which Q2 had left undone; their collision stays. From below, the lake's top face and its
  mirror are not drawn, nor the underside of the surface once the diver is deeper than the reach;
  and the sun's shadow maps are not redrawn where less than a thousandth of the daylight is left on
  anything in view (deeper than about 340 m). Measured at the deepest point: 22 fps becomes 48,
  the meshes drawn go from hundreds to 6 (two ground leaves, the water and the sky). A dive to 30 m
  off Cleetwood Cove runs at 31 fps where the pier above it runs at 10. Not done: the sky layers
  are still drawn under water (about 3 ms), and trees or props hidden only by depth of water, not
  distance, are still drawn.

- **E15. Fixed (2026-10-03): a swimmer looked like someone walking on the water** (project lead:
  "this character can walk and run on water", "and fish on water", "gravity should be pulling them
  down if nothing else"). The game did count it as swimming, but nothing showed it: the swimmer
  floated with the eye a steady 0.25 m above the surface, glided at walking pace (and at a run on
  the touch stick), and could cast a line or use any tool. Now a swimmer moves at a stroke's pace
  (1.2 m/s, `STROKE_SPEED`, whatever the keys or the stick ask for), the head rides the water with
  a slow swell at rest and a dip with each stroke, and going into the water puts away whatever is
  held: only the flashlight can be taken out and used until the swimmer is out again. Left as it
  was: a swimmer who does nothing still floats (E7) and does not sink; with E14's breathing bar
  that is the project lead's call.

- **U14. A line already out when the ship casts off was never tested** (project lead, watching a
  test on 2026-10-03: "Boat started moving in the middle of fishing ... We never tested 'is already
  fishing when the boat takes off'"). In that run the line was cast from the deck at the dock and a
  3.5 s hold of Enter did not bring it in; the ship then sailed with the line out, the state stayed
  "waiting", and a tap of Enter under way reeled it in. What the line, the bobber and a hooked fish
  should do when the ship leaves, and what they do now, is not established. Casting and reeling
  from the deck were checked the same day and work both docked and under way.

- **E16. Fixed (2026-10-03): H teleported when the player only wanted the HUD gone** (a playtester,
  through the project lead: "player complains about teleport each time they want to just see the
  world without the hud"). H now hides and shows the HUD, the reticle and the play panels; T does
  the travel between places that H did.

- **E17. Fixed (2026-10-03): under water at night the screen was white with a blue band along the
  bottom** (project lead: "just a white screen with a thin blue line near the bottom"). Looking up
  from below, the underside of the lake surface was a white sheet: its ripple texture is an emissive
  texture, which Babylon adds to the colour at full strength whatever the colour is, and the night
  exposure is thirty times the day's. The ripples now dim with the daylight and the depth like the
  rest of the water (`src/engine/underwater.ts`): dark at night, the same light blue as before by day.
- **E18. Fixed (2026-10-03): level cross-fades showed as dither in the flashlight's pool** (project
  lead: "Dithering should be turned off underwater. It's extremely noticeable"). Under water the
  ground and the plants now switch levels at once, with no dithered cross-fade (`fades` on the
  ground stream and the flora, set from `world.ts`); above water the timed fade of U13 is unchanged.
  Also: a lit flashlight no longer shows its icon in the middle of what it lights (`Play.ts`).

- **E14. Missing: breath under water** (project lead, 2026-10-03). A swimmer under water should have
  a breathing bar; when it runs out the player drowns and comes back at the nearest dock. With scuba
  gear in the rucksack they can stay under for up to 30 minutes a day before the bar starts. Why: it
  is very easy to get completely lost under water, and the places on T (then on H) are a debugging aid, not part
  of the game, so the player needs a way back that is. Not started.


## Pass 6: water and shoreline

All at the lake surface. E3 and U4 show in the same shots (13, 33).

- **E3. Blocky, pale lake reflection near the shore.** The lake mirror is 512×512 (`MIRROR_SIZE`,
  `src/engine/ground.ts:103`), so reflected trees are squares (shots 13, 33). Whether it also causes the
  pale tint is unknown.
- **U4. A hard pale line along the shoreline** where the walls meet the water (shots 13, 33).
- **U5. A blue sea runs to the horizon past the map edge** at all four corners (shots 22, 24, 26, 28).
  Not identified; there is no backdrop terrain beyond 9 km.
- **E11. The low sun's glint on the lake is a round ball, and it stays when the sun is behind the rim**
  (project lead, 2026-10-03: "something's very wrong with that reflection"; shot
  `tools/.cache/shots/light-pass/07-low-sun-and-reflection.jpeg`, summit of the cone, 19:36). The ball is
  the sun light's own highlight on the water (it goes with the lake material's `specularIntensity` at 0),
  spread by bloom to the size of the sun's glare, where real water shows a glitter path. At 20:03, with
  the sun behind the rim, the glint is still on the far shore: sun shadows reach only 600 m, so the
  water 2 km off is never in the rim's shadow. The wider bloom of pass 1 made the ball bigger. The
  mirror's own picture of the sun's disc is not the cause; it is drawn at a twelfth of the disc's
  brightness (`SunDisc.dimIn`).
- **E7. Fixed (2026-10-03): a swimmer could not surface.** The swimmer floated with the eye 0.3 m under
  the water and Space could rise no higher, so the underwater view never lifted. The float level is
  now 0.25 m above the surface (`FLOAT_HEIGHT`, `src/engine/player/PlayerController.ts`): a swimmer's
  head is out of the water and sees the lake. C dives, Space or letting go comes back up. Tested at
  (300, 900): steady at 0.25 m, the underwater view off there and on when dived, 3.5 s back to the
  surface from 3.4 m down.

## Pass 5: hand-built play objects

All in `src/play/`: shapes made in code with `StandardMaterial`. The `PBRMaterial` swap in E8 is the
base the rest builds on.

- **E8. Objects built in code use `StandardMaterial`, which the world's lighting does not reach.**
  The held tools (`src/play/HeldItem.ts:27`), chopped stumps and logs (`src/play/Chopping.ts:37`),
  campfire logs and cooked fish (`src/play/Campfire.ts:180`, `:273`) and the bobber (`src/play/Fishing.ts:44`).
  Everything else is `PBRMaterial`, which the Atmosphere addon lights with sun transmittance, sky
  irradiance and aerial perspective. A `StandardMaterial` gets only the raw sun (intensity 3.84) and a
  near-black `scene.ambientColor` (about 0.05), so the axe blade blows out white with a bloom halo in
  sun, turns solid black facing away from it, and glows saturated red at sunset (sun colour 0.456,
  0.15, 0.027). The stumps and logs look flat orange with a black side for the same reason. None of these
  cast or receive shadows. Tested by swapping the axe's materials to `PBRMaterial` at runtime: at sunset the
  blade is dark steel and the handle shaded wood (shot 41); at noon facing away from the sun it is shaded
  grey and wood (shot 43) where `StandardMaterial` draws it solid black (shot 44, same view). Fix:
  build these with `PBRMaterial` (a later step could replace them with real models). The axe's
  bad looks in earlier shots (16, 18, 29, 32, 40) are this, not the scene's lighting.
  Rerun with every one of these swapped to `PBRMaterial` at runtime (2026-10-02): the held tools
  (sheet 50), stump and logs (53, as shipped vs PBR) all read as shaded wood and steel. **The campfire needs
  more than the swap** (night matters most for it, per the project lead): swapped as is, its logs blow out to a
  white cone at night (57), worse than the shipped orange (56), because the fire's glow (`emissiveColor`,
  set every frame in `src/play/Campfire.ts:258`) is in linear light and the night exposure is 30. With the
  glow divided by the exposure (`emissiveIntensity = 1 / exposure`) and the fire's own `PointLight` kept off
  its logs (`excludedMeshes`; the light sits 0.7 m above the base of the logs, so with physical falloff the
  log tops blow out, 62), the logs read as wood with embers at the base (61; three-way comparison 63).
  Fire at (−2.0, 24.68, 538.41) on Wizard Island, camera (−1.1, 26.11, 541.21).
- **E4 (play part). Placeholder shapes.** Stumps and logs are plain cylinders made in
  `src/play/Chopping.ts`, and the logs are pole-thin next to the stump (`LOG_DIAMETER`).
- **E9. Cooking a fish looks wrong** (`cook()` in `src/play/Campfire.ts`, around line 262). The fish is a
  sphere squashed to 38 × 5 × 8 cm, hung flat over the fire instead of skewered on the stick, which passes
  it at a different angle (69, close-up). The stick shares the burning logs' material
  (`stick.material = fire.logMaterial`) and glows with them (66); that is fine as it is (project lead: a
  roasting stick gets hot), so keep it in any rework. The project lead: skewering the
  fish on the stick and turning them slowly over the fire, like a rotisserie, "would up the realism 100%". The fish also
  renders black under both materials (unknown, U11).
- **U11. The cooking fish renders black** under both `StandardMaterial` and `PBRMaterial`, lit by the
  fire right below it (69). Possibly its normals, from a sphere scaled 0.38 × 0.05 × 0.08; not checked.
- **E10. The fishing mini-game is hard to read** (recorded runs, 2026-10-02: video and a 100 ms state
  log, as shipped and with `PBRMaterial`; contact sheets 70 and 71, videos `fish-standard.webm`,
  `fish-pbr.webm`; standing at (61.5, 2.2, 648.39) on Wizard Island's shore, yaw 30°, 11:00). Both runs
  play through: a 1 s wind-up casts 33 to 34 m; the bite comes 35 to 41 s later; the fight takes 16 to 22 s
  reeling from 34 m to 2 m with tension held between 0.45 and 0.84; trout of 29 and 41 cm landed. What
  the player sees:
  - The bobber (`src/play/Fishing.ts:43`, an 8 cm sphere) cannot be seen at casting range. As shipped it
    is invisible; with PBR it is a dark speck. For the 10 to 40 s wait the only sign of the bait is the
    line.
  - The bite is only text ("Fish on! Hold Enter to reel", with a ten-box tension bar). The ripple ring
    shows only once the fish is near (about 10 m).
  - The rod does not visibly bend under tension, and the reel glows white as shipped (E8).
  - Landing shows no fish and no splash: the catch is only the 4 s card ("Rainbow trout 29 cm").

- **E13. Missing: the stones of a campfire come from nowhere** (a playtester asked where the rocks
  come from; project lead, 2026-10-03). Stones should be gathered with bare hands, no tool, and
  carried in the rucksack, and laying a fire should take 6 stones and 3 logs. Medium priority; not
  started, by the project lead's instruction.

## Pass 4: the ship

`tools/build_props.py` and `src/engine/boat.ts`, checked by one walk around the ship.

**P2. The ship's deck collision: rebuilt, with a few things left to walk** (2026-10-03). `ship_meta`
in `tools/build_props.py` now measures the decks from the hull's own up-facing surfaces and writes a walk
box for every run of deck, a rail just outboard of each box where it is the ship's side, a step at each
break and an end rail where a deck stops (32 walk boxes and 55 blockers, was 13 and 29).
`python3 tools/check_ship_deck.py` holds `props.json` to the hull and passes: 59.7 m² of deck, none
without floor, no rail inside a deck, the bow closed. Tested in the game, docked at Cleetwood (ship's
own frame, z forward):
- The three holes hold: dropping at z 6.9, z −4.5 and z −6.0 lands on deck; the quarterdeck (3.05),
  poop (4.16) and forecastle (3.05) hold at their own heights.
- Walking to starboard across the waist at z −1 stops with the body's centre at x 2.14, 0.16 m from the
  visible rail (it stopped at 1.5); the port side is the same.
- Walking forward off the head platform stops at z 7.2, and aft off the poop at z −8.95, still aboard.

Still to walk by hand: the ladders (run and jump at each step), boarding over the gangway from each
pier, and the ship under way. Left as they are, for the project lead to judge:
- A deck must be 1.0 m wide to get floor (`DECK_WIDTH`), so the forecastle's 0.2 to 0.5 m side ledges
  have none.
- The quarterdeck and poop are reached only by jumping the break ledges; the model has no ladder there.
- The poop's port rail has a 0.1 m gap at z −7.30 to −7.20.
- `mainDeckHeight` is now 1.84 (was 1.65); nothing in `src/` reads it.
- While docked the gangway is open on both sides by design (`src/engine/boat.ts`, `openRail`).

**E4 (ship part). Placeholder shapes.** The ship's inner steps are untextured boxes made in code
(`src/engine/boat.ts:89`).

## Pass 3: one-line sweep

Done on 2026-10-03.

- **E5. Fixed: touch prompts said "Enter".** The cast and fight hints name the key only on a keyboard
  (`src/play/Play.ts`); on touch they read "Let go", "Hold", "Hold to reel".
- **E6. Fixed: release day length.** `dayLengthMinutes` is 120 (`src/core/Settings.ts`); the clock and
  the boat run at that pace (checked: 0.0168 game hours in 5 s).
- **B3. Fixed: leftover fields.** The biome's `terrain` is only `worldSizeMetres` and its `water` only
  `colour`: the old URLs, `water.level` and the lake-seed and lake-bed fields are gone from the biome and
  from the `Biome` type. Still carried and read by nothing, left because they may be plans rather than
  leftovers: `flora`, `groundCover` (with forage), `fauna`, `ingredients`, `recipes`, `lighting`, and
  all of `climate` but `weatherSeed`.

## Pass 2: flora rebuild

Everything that comes out of `tools/flora_models.py` and the engine's choice of level. Recheck U7 and
U6 on the rebuilt models, and judge the cards at low sun (symptoms 3 and 4) under the light from pass 1.
S2 comes last, because the rebuild changes what ships.

**P1, Sojourney v1 defect 1, highest priority: the trees** (project lead: all tree problems are one
defect, and fixing the pipeline is the remedy). The engine draws the ship with the same glTF loader and
PBR material, and the ship looks right, because `tools/build_props.py` keeps its original mesh and its own
2048 textures on their original UVs. `tools/flora_models.py` does not.

Symptoms:
1. Close-up trunks look painted, not like bark: near-black, flat-faceted, smeared, no relief. Confirmed
   in game as `fir_b_LOD0` (24,884 triangles, the most detailed level, not an impostor) at (8965.75,
   −113.75, −8968.24), from (8970, −110.5, −8970) facing yaw −45° at 4.6 m, and from 2 m at 17:00 (shots
   25, 29; the streaky trunk in shot 24). The canopy of the same tree, seen from 2 m and 7 m below (shots
   30, 31), looks right (project lead).
2. Sprigs float in the air: slivers in the open sky above the rim's tree line (shot 20, camera 82, 286,
   −2956) and dark triangles between trees above Cleetwood Cove (shot 32, camera 4700.3, 56.5, 4300.1). The
   previews (`tools/.cache/previews/sheet_pine_*.png`) show the pines' `LOD1` (4,000 triangles) and `LOD2`
   (450) are mostly sprigs and twigs with no branch to grow from, plus solid black triangles; `LOD0` has
   some black triangles too. The firs are mostly sound. Placement is not at fault: none of 6.3 million
   forest records is above the lidar ground.
3. Cards facing the sun glow orange at low sun instead of standing dark against it (shot 05), and at
   sunset the whole wall below the Watchman is speckled with orange cards (shot 39).
4. Trees on the caldera walls read as near-black dots (shots 03, 04).

Causes (all in `tools/flora_models.py`):
- The best level starts from Poly Haven's LOD1 mesh (CREDITS.md), and the whole tree, foliage included,
  is cut to `TREE_TOTAL` (30,000 / 4,000 / 450), so the trunk has few sides.
- Foliage is cut to the budget sprig by sprig, so lower levels keep sprigs whose branch was removed.
- Bark is packed into one `ATLAS_CELL` (1024 px) cell of a 2048 atlas, with the bark's whole UV range
  sampled into it (`sample_region(..., lo, hi, ATLAS_CELL)`, around line 170), leaving a few dozen
  pixels per bark repeat (likely; the UV range is not yet measured). The bark normal and
  occlusion/roughness maps exist; their resolution is the problem.
- Crater Lake's trees are drawn at their lidar heights, up to about 2× the model (this fir is 1.94×), and
  the pipeline supplies no extra bark texture for trunks that tall.
- Symptoms 3 and 4 are cards; their cause is **not confirmed**. The card bake (baked normals,
  `CARD_DARKEN`) is the suspect, and they go with the tree rebuild by the project lead's call.

Remedy: build the near tree levels as props are built: the original full-detail trunk mesh (the
`.blend` originals, as in the hi-res trees idea) with its own repeating bark material at 2k or 4k and a
strong normal map; branch-aware thinning for the middle levels; re-bake and check the cards. Check close up
under low sun, and from the rim for slivers.

- **P3. Rock patches stand off curved ground** (project lead, 2026-10-03: "the dead body looking thing").
  `rock_patch_0` is a flat slab of small rocks, 10 × 0.8 × 11.5 m as modelled. On the cone's rounded
  shoulder the one at (7.4, 230.4, −25.8), scale 0.71, does not follow the slope: its far end hangs in
  the air and, seen edge-on from the summit (20, 234.1, −40, yaw −48°, pitch 12°), it is a dark jagged
  strip with a boulder at one end. The forest build (`tools/build_forest.py`) places it by one point. Fix
  in the pipeline: place patches only where the ground under the whole patch is near enough flat, or
  use smaller patches, or tilt each to the slope.
  **Fixed in the pipeline 2026-10-03, still to look at in the game.** Each patch is laid on a plane
  fitted to the ground under its whole footprint and tilted to it, and dropped where the ground bends
  away from that plane by more than 0.25 m (`fit_patch_ground` in `tools/build_forest.py`).
  `tools/check_rock_patches.py` measures every patch's corners against the lidar ground: before, 8,517
  of 177,114 stood more than 0.25 m up (worst 43 m, on a cliff edge); after, none of 134,050 stands
  above the ground at all. 24% of patches were dropped, so check that no slope looks bare. Sections
  before and after are in `tools/.cache/shots/rock-patches/`.
- **U12. The near ground flickered along ridge tops while the view moved. Fixed 2026-10-03**, to be
  confirmed by the project lead on the boat ride (their video, from the dock looking left, showed a pale
  streaked wedge under the ridge's highest point changing shape from frame to frame). It was a ground
  skirt showing through the slope in front of it: seen alone, the far block there is a wall of pale
  vertical streaks (its edge skirt, 25 m deep at the median), 2.7 m behind the nearer leaf's surface and
  1,270 m from the eye, and the depth buffer could not keep the two in order. Depth is far coarser here
  than the usual figure: positions are worked out in 32-bit floats from world coordinates thousands of
  metres from the origin with the near plane at 0.1 m, which is worth about a hundredth of the distance.
  The merged far-ground blocks (`58c53b4`) were not the cause (it flickers with them off) but added more
  such edges. Now the pack marks skirt vertices (u = 1, their own vertices top and bottom,
  `tools/ground_mesh.py`) and the ground material draws them a metre plus a twentieth of their distance
  farther back in depth (`skirtBack` in `src/engine/TerrainMaterial.ts`), so anything in front of a skirt
  covers it and a real crack is still filled. Checked: twelve consecutive frames at that spot are
  steady; no holes from the ship, the rim or the cone; the WebGL 2 shader compiles.
  Not done, and why: Babylon's reverse depth buffer would give the precision outright, but the
  Atmosphere addon draws the sky at a fixed far depth and the sky came out black with it on. The same
  coarse depth can still make other close pairs flicker far off (tree cards against the ground behind
  them); a floating origin or a nearer far plane would be the general cure.
- **U13. Levels pop when they change** (project lead, 2026-10-03: trees, rocks and terrain; "more
  noticeable than the fact that some far models look crappy up close"). Wanted: a dithered cross-fade
  between levels over a short band of distance. **Built 2026-10-03, to be judged in motion by the
  project lead.** Babylon 9.29 ships the cross-fade as `DitheredTileFadeMaterialPlugin`: each mesh or
  thin instance is drawn in its own interval of a screen-fixed 8×8 Bayer pattern, so two levels given
  complementary intervals show exactly one of them at every pixel. A fade runs over the last quarter of
  each switch distance (`FADE_BAND`). Ground: `groundStream.ts` now chooses the levels itself (Babylon's
  `addLODLevel` draws one level only), and the 1 km blocks fade in over their leaves the same way.
  Trees, rocks and shrubs: `sortNear` in `flora.ts` puts a record in both levels inside the band, and
  runs every 0.25 m of travel (0.2 ms a sort at the dock). Not done: the shadow pass still switches
  (both levels cast inside the band); props (the ship, the piers) still switch; and the forest still
  changes all at once at 600 m, where a leaf's full file takes over from its middle-band cards.
  **Reworked 2026-10-03: the fade runs on time, not distance.** A switch at its distance starts a
  cross-fade that plays over half a second of wall-clock time (`FADE_MS`) and finishes; at rest every
  ground leaf, block, tree, rock and shrub draws at exactly one level, with no dither anywhere. The
  switch outward happens at the switch distance and back inward 5% below it (`FADE_GAP`), so hovering
  on a boundary fades once instead of back and forth. Ground leaves, blocks (`groundStream.ts`) and
  flora records (`sortNear`) each keep their shown level and fade on the wall clock; a fade once
  begun plays out before the distance is asked again, and a jump past several levels fades straight across. The flora sort keeps running every
  frame while any fade plays and rests otherwise. Switch distances unchanged; the shadow pass, props
  and the 600 m handover are as before.
- **Q2. Nothing is drawn that the player cannot see** (project lead, 2026-10-03). In rain the fog closes
  the view to 150 m and everything behind it is still drawn; skip what the fog fully hides. This is not
  the same as cutting the view distance, which stays as far as the far rim. **Fixed 2026-10-03** for the
  ground and the forest. A thing is skipped only when the rain leaves under a thousandth of its colour
  (228 m in full rain) and the sky veil behind it is as thick (`rainHides` in `Fog.ts`: ground that
  stands more than 300 m above the eye is kept longer); mist hides nothing, since it does not veil the
  sky. Measured aboard the ship at the dock in full rain: 439 ground meshes become 5, 86,000 tree and
  rock instances become 2,500, and 12.5 fps becomes 24; the fogged sky and horizon are the same in
  both (`tools/.cache/shots/q2-fog-cull/`). Not done: props, the water and the sky layers are still
  drawn, and the lake mirror still draws its ground proxy.
- **U7. A pine 3 m away was drawn at `LOD1`, not `LOD0`** (shot 32). Possibly the engine's level sort lags
  the camera after a teleport.
- **U6. Shrubs look pinkish** (shot 23).
- **S2. `CREDITS.md` does not match what ships.** It credits the old paths (`models/trees/…`,
  `models/rocks/…`, `terrain/…`) and the old impostor bake, and has no rows for what loads now:
  `flora/fir.glb`, `pine.glb`, `shrub.glb`, `seaweed.glb`, the rock GLBs in `flora/`, and the ground
  textures in `ground/*_albedo|normal|ao.ktx2`.

## Pass 1: sky, weather and light

All in the atmosphere, fog, weather and tone-mapping chain. Worked through on 2026-10-03; after-shots are in
`tools/.cache/shots/light-pass/` (summit of the cone, 20, 234.1, −40, facing the Watchman unless noted).

Still open:

- **U2 (part). In rain, looking straight up shows no drops and no clouds.** Explained, not changed. Each
  drop is a billboard stretched along its fall (`BILLBOARDMODE_STRETCHED`, `src/engine/environment/Rain.ts`),
  1 to 1.5 cm wide, so seen end-on it is a dot smaller than a pixel. The sky overhead is the rain veil
  (`Fog.ts`), which is opaque at 150 m visibility by design. For the project lead to decide whether
  drops should be seen coming at the camera.
- **Missing: sun shafts.** Tried on 2026-10-03 with Babylon's `VolumetricLightScatteringPostProcess` on
  the sun's disc and taken out again: it ran, but no rays showed from the cone's summit, the Witches
  Cauldron or Wizard Island's shore at its default settings, and it cost about 1 fps of 12. It needs
  tuning in a view with the sun behind near trees. What it needs: `{ postProcessRatio: 1, passRatio: 0.5 }`
  (a bare ratio halves the whole frame), `useCustomMeshPosition` with the sun's position each frame
  (the disc is placed by its shader), and the sky layers and `skyProxy` in `excludedMeshes`.
- **Storms, for the project lead to judge.** A "storm" weather is a downpour (rain 1.4) with lightning,
  one day's main rain spell in five (`src/sky/Weather.ts`, `src/engine/environment/Lightning.ts`). Each
  strike is a jagged, forked bolt 400 m to 6 km off in a random direction, drawn with Babylon's
  GreasedLine over the rain's veil and glowing through bloom, and a flash added to the sky light, so
  the sky, the rain and the ground light up with it (shot 09 at night). Thunder follows after the
  sound's travel time. To judge: how bright the flash is, most of all at night (`LIGHTNING_SKYLIGHT`,
  `LIGHTNING_NIGHT_POWER`), how often it strikes (`STRIKE_GAP`), and the bolt's width and reach.

Fixed, for the project lead to judge:

- **E1. Mist was too thin to see.** `MIST_VISIBILITY` is 6000 (was 15000): at 06:30 the wall 2 km away is
  veiled blue-grey and the far shore is mostly hidden (shot 04). This thickens the evening mist too. A
  clear day now has a little haze from the atmosphere itself (`aerialPerspectiveIntensity: 1.4`,
  shot 05); it tints the dark tree cards on the walls blue.
- **E2, U3. "Overcast" was half clear and lit like full sun.** Overcast, drizzle and rain now have cloud
  cover 1, the only value at which the cloud layer closes. The sun is dimmed by the square of the cover,
  to a tenth under a closed sky, and the cloud deck gives grey light back through the atmosphere's
  additional sky irradiance, so the ground is evenly and more dimly lit (shot 02).
- **U2 (part). Rain was a flat blue-violet veil.** The veil and the rain fog take the sky light, which
  under rain is now the clouds' grey (shot 03).
- **U1. The midday sun was a small, dim grey disc with no glare.** The disc was drawn only 40 times
  brighter than a sunlit white surface, too little for the pipeline's bloom to spread. It is now 480
  times, with a bloom kernel of 128 (shot 01); at a low sun the glare is warm, as the light is. The
  clear sky is not the same blue down to the horizon: it lightens toward it (shots 01, 05), and its deep
  blue overhead is what the atmosphere gives at this height with the documented setup.
- **U9. With post-processing off, the sky blew out to pale cyan-white.** Cause confirmed: the sky is
  drawn in linear light and only the pipeline tone-maps it. The optimizer's second step now switches
  off bloom, sharpening and anti-aliasing and keeps tone mapping (`src/engine/Optimizer.ts`).

## Content

New content, not fixes: it needs assets sourced, licensed and credited. Fauna (was B2) is deferred to
v2; see `sojourney2.md`.

- **B1. Missing: soundscape.** Crater Lake's `ambientAudio` is empty (`src/biomes/crater-lake/index.ts`):
  no waves, birdsong or footsteps. Rain and fire are synthesised, not recordings.
  **Taken by the project lead** (2026-10-02), who is sourcing the sound pack; not for anyone else to
  pick up. Wiring the sounds in follows once the pack arrives.
  In so far (2026-10-03), in `public/packs/crater-lake/audio/` and played by `src/engine/AmbientAudio.ts`:
  footsteps on the ground and wooden steps on the ship and piers; thunder after each lightning strike,
  quieter and lower the farther off; and ambient loops that each play only in the conditions the biome
  names for them (day, night, dry, rain, storm, underwater, surface) and cross-fade with the weather and
  the light; "aboard" and "ashore" are conditions too. Crater Lake is a quiet place (no streams, walls
  that keep the wind off the water; gentle lapping on rock, wind in the hemlocks on the rim, Steller's
  jays and Clark's nutcrackers), but it is never silent: a quiet bed plays wherever it is dry, and
  birds and water go with the boat ride. Short recordings are not looped whole: two decks take turns
  with random snippets of the recording, each fading over a tenth of its length (the project lead's
  method), so no loop point is heard. Which loop goes with which condition was picked by file name, not by ear, and the loops are 10
  to 14 s long: for the project lead to set in `src/biomes/crater-lake/index.ts`. A recording of a fire with a hiss in it loops
  near a campfire while it rains (`Crackle` in `src/play/sounds.ts`). Fishing has recordings for the
  bait's plop, and for the reel and the splashing fish, which loop together while reeling in
  (`fishingSounds`). The quiet surf of a lake plays within earshot of the water's edge and out on the
  lake (a "shore" condition; a 13-minute recording, streamed). Still missing: wind in the trees on the
  rim, jay and nutcracker calls, a dry fire's crackle and daytime rain as recordings.

## Checked and working

No swimming on dry land below lake level (west flank, 228 m below the lake); the night sky (moon, halo,
stars, Milky Way, moon path); H to the moving ship; fishing from the moving deck; no fire offered on deck;
chopping on Wizard Island, the west flank, the rim and above Cleetwood Cove; laying and lighting a fire;
the Cleetwood pier is well lit at 13:00; no precision shimmer at the map corners.

Evening mist (shots 39, 40, 20:24, sun 2.1°): the walls stand dark against the sunset and the far
east shore fades into the evening haze; the far wall no longer reads clearly lighter than the sky
behind it (project lead to judge).

## Not yet checked

Nothing on the original list. Underwater (beyond the swimmer's eye in E7) and night rain were not
covered.

- **Firefox has never been tried** (project lead, 2026-10-03). Every playtest so far ran in Chromium
  on WebGPU. The game uses WebGPU where the browser offers it and WebGL 2 otherwise
  (`src/core/Engine.ts`), so in a Firefox without WebGPU it would run the GLSL halves of the shaders,
  which no playtest has exercised: the depth lighting, the timed level fade and the lake-bed zones
  added on 2026-10-03 were only ever seen through their WGSL halves. To check: that it starts in
  Firefox (156 is installed here), which of the two it runs on, and that the picture matches
  Chromium's. Safari is in the same position. Not to be picked up until the project lead says so: there is no
  browser tooling for Firefox here beyond scripting it by hand.
