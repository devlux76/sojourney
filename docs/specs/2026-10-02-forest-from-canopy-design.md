# Forest from the lidar canopy grid — design

Date: 2026-10-02. Status: **built** the same day (`tools/build_forest.py`, `src/engine/flora.ts`; the
layout is in `src/engine/pack.ts`). The project lead left the open questions to the engineer; the
decisions are at the end, and what was built differently is listed after them. The sections before
the decisions describe the engine as it was before.

## What the data says

The NPS canopy-height grid (0.91 m cells, the 2010 lidar survey; see `CREDITS.md` and
`LICENSING-TODO.md`) gives every crown's position and height. Counting crown tops taller than 5 m in
1 km squares:

| Place (world x, z) | Trees per km² | Ground under crowns | Height, median / 90th pct / tallest |
|---|---|---|---|
| Wizard Island (0, 0) | 5,400 | 23% | 21 / 33 / 56 m |
| South caldera wall (80, −2700) | 3,000 | 22% | 21 / 31 / 52 m |
| Rim Village side (−3000, −3700) | 11,800 | 62% | 24 / 33 / 52 m |
| Outer flank, north (0, 7000) | 17,000 | 47% | 18 / 22 / 34 m |
| Outer flank, south-west (−6000, −6000) | 16,000 | 57% | 23 / 28 / 51 m |

Over the 270 km² of land on the map that is about **3 million trees**; Wizard Island alone has about
7,000. Heights were read as tenths of a foot; the unit is not confirmed from the metadata.

## What the engine does today

- 2,784 trees, all inside a 1.2 km square on the island, scattered by seeded noise
  (`tools/flora_place.py`, zones in `src/biomes/crater-lake/index.ts`).
- One `placements.bin` holds every placement and is loaded whole at start. Each species has four
  detail levels (about 30,000 / 10,000 / 1,200 triangles, then a 6-triangle card from 150 m) and is
  dropped beyond 2.5 km (`tools/build_flora.py`).
- The rim view already runs at 12–14 fps with everything on, on this machine.

## Why it cannot simply be scaled up

Within the 2.5 km cull distance of the rim viewpoint there are roughly 100,000–230,000 real trees.
As cards alone that is 0.6–1.4 million triangles on top of today's 900,000, every placement would
need 64 bytes (192 MB for the whole map), and the far wall — 8 km away — would still be bare.

## Proposal: three bands

1. **Near, real trees (to about 600 m).** Placements come from the canopy grid: real positions, each
   tree scaled to its measured height. Placement files are cut into the same quadtree leaves as the
   ground and streamed with them (`src/engine/groundStream.ts`), so only the trees around the player
   are in memory. Models to 150 m, cards beyond, as now.
2. **Middle, thinned cards (600 m to about 2.5 km).** The same placements thinned to the tallest tree
   in each 12–16 m cell, drawn as cards, so a forest edge still has a silhouette against the sky.
3. **Far, painted (beyond 2.5 km).** Forest is in the ground itself: a whole-map colour map darkens
   and greens the ground where the canopy grid has crowns. This is the same colour map that would
   carry the geology tint (handoff step 2). It is what makes the far wall and the island cone read as
   forested from the rim.

Species come from the vegetation map unit at each tree (fir model for red/subalpine fir units, pine
model for lodgepole, ponderosa and whitebark; mountain hemlock has no model yet and would use fir).

## Decisions (2026-10-02)

1. **Three bands, all of them.** Real trees near the player, thinned cards in the middle distance,
   forest painted into the ground beyond. The middle band stays: without it forest edges inside 2.5 km
   have no silhouette against the sky or the lake.
2. **Lighter middle levels.** The trees' second and third levels drop from about 10,000 and 1,200
   triangles to about 4,000 and 450. The closest level and the card are unchanged.
3. **The whole map is forested**, outer flanks included. Placements are streamed with the ground
   leaves, so trees far from the player cost nothing.
4. **A felled tree stays felled.** The felled list is kept per ground leaf and applied again whenever
   the leaf's placements are loaded.
5. **Nothing vanishes while it can be seen.** The fixed cull distances in `tools/build_flora.py`
   (rocks 250 m, shrubs 300 m, trees 2.5 km) go. An object is drawn at its lowest level until it is
   smaller than about two pixels on a 1080-line screen (roughly 700 times its size away), and trees
   never stop: models, then cards, then thinned cards, then the painted ground. Rocks and shrubs are
   placed over the whole map by the same rules as today and streamed with the leaves, so the shore at
   Cleetwood Cove is no longer bare.

## As built

- 3,014,135 trees, 825,581 rocks, 1,203,512 shrubs and 64,240 water plants in 1,223 leaf files, and
  1,168,193 middle-band trees in 958; 88 MB; the whole map builds in about 30 seconds.
- The canopy grid's heights are tenths of an international foot: the survey was delivered in Oregon
  Lambert feet (the grid's `metadata.xml`), and the heights only make sense as feet.
- Models are drawn only when the player is almost touching them (trees inside 30 m, shrubs inside
  15 m); beyond that everything is its card. The project lead asked for this on 2026-10-02.
- The full files are drawn within 600 m of a leaf and the middle band out to 2.5 km. Rocks and shrubs
  are in the full files only, so they stop at the edge of the near band even when larger than two
  pixels there; inside it each is drawn until it is under two pixels.
- The far band uses the splat map's needle-litter weight (laid under crowns from the same canopy grid)
  rather than a separate mask, and fades in between 600 m and 2.5 km, so the ground between the
  thinned cards darkens too.
- Mountain hemlock units use the fir model with a few pines mixed in; pine units are 85% pine.

## The pack, as the engine will read it

- Per ground leaf (the ids in `ground/ground.json`), one placement file for everything that stands in
  the leaf, in compact records (position, yaw, scale, species) rather than 64-byte matrices; the
  engine builds the matrices when it loads a leaf.
- Per ground leaf, the thinned middle-band trees (the tallest tree in each 12–16 m cell) in the same
  record form.
- A whole-map forest mask for the ground material (crown cover, already staged as
  `assets/crater-lake/ground/structure/canopy.png`), used to darken and green the far ground.
- `flora.json` lists the species (model, level distances, collider, size for the two-pixel rule) and
  which leaves have files. The exact layout is written down in `src/engine/pack.ts` by whoever builds
  the pipeline half.
