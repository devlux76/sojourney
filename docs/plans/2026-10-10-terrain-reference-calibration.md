# Terrain reference calibration

Goal: bring the terrain's material distribution and appearance closer to the
local reference photographs and USGS SIM 2832, retaining the accepted rock detail.
Codex executes this work directly, in small verified batches on main.

1. Correct the scaly exposed-rock source, repeat scale and cliff tiling.
   Completed in `4fd2657`; preserve the lead's shoreline-ring preference.
2. Register the original USGS ArcInfo geological coverage against surveyed sites.
   The cached GeoPackage is displaced north; do not use its coordinates.
   Verify Wizard Island cinder and Phantom Ship andesite before authoring any map.
3. Pack mapped substrate classes into the existing splat map's alpha channel.
   Tune only mapped weathered lava, cinder, pyroclastic and pumice deposits;
   compare Cleetwood, Wizard Island, Llao Rock and Pumice Castle in clear midday
   light. Keep needle litter and distant forest coloration independent.
4. Verify load, travel and input, inspect shader diagnostics, run tests, typecheck
   and build, then commit accepted changes. Preserve a playable scoped baseline
   outside the repository and revert only the current batch if necessary.

Use photographs for surface character, not as unlicensed textures. USGS geology
is public domain; credit derived pack data. Material tuning cannot establish a
geometry error: compare camera position and the 1882.25 m lake datum first.
Source: https://pubs.usgs.gov/sim/2832/ and its original `crater-lake.zip` coverage.

First substrate batch: original coverage registration, mapped-alpha authoring and
shader palette completed and verified on WebGL2. Photo poses and geometry are
not yet matched. Unsafe camera captures were rejected and normal controls restored.
Further comparison must use collision-prepared player spawns.
