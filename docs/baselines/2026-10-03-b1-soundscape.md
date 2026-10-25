# B1 soundscape arrival log — 2026-10-03

What is in the game for the Crater Lake soundscape (B1 in `ISSUES.md`, taken by the project lead
who is sourcing the sound pack). Files in `public/packs/crater-lake/audio/`, played by
`src/engine/AmbientAudio.ts`; conditions named by `src/biomes/crater-lake/index.ts`.

## In and working

- Footsteps on the ground, and wooden steps on the ship and piers.
- Thunder after each lightning strike, quieter and lower the farther off.
- Ambient loops that each play only in the conditions the biome names for them (day, night, dry,
  rain, storm, underwater, surface) and cross-fade with the weather and the light; "aboard" and
  "ashore" are conditions too.
- Crater Lake is a quiet place (no streams, walls that keep the wind off the water; gentle lapping
  on rock, wind in the hemlocks on the rim, Steller's jays and Clark's nutcrackers), but it is
  never silent: a quiet bed plays wherever it is dry, and birds and water go with the boat ride.
- Short recordings are not looped whole: two decks take turns with random snippets of the
  recording, each fading over a tenth of its length (the project lead's method), so no loop point
  is heard.
- A recording of a fire with a hiss in it loops near a campfire while it rains (`Crackle` in
  `src/play/sounds.ts`).
- Fishing recordings: the bait's plop, and the reel with the splashing fish looping together
  while reeling in (`fishingSounds`).
- The quiet surf of a lake within earshot of the water's edge and out on the lake (a "shore"
  condition; a 13-minute recording, streamed).

## Caveats

- Which loop goes with which condition was picked by file name, not by ear, and the loops are 10
  to 14 s long: for the project lead to set in `src/biomes/crater-lake/index.ts`.

## Still missing

Wind in the trees on the rim, jay and nutcracker calls, and daytime rain as recordings. (Dry
fire crackle needs no recording: `Crackle` in `src/play/sounds.ts` still synthesises pops every
frame a fire burns, wired in `src/play/Campfire.ts` — only the rain hiss is a recording.)
