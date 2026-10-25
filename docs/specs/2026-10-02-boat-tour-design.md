# Crater Lake boat tour, piers and fire pit — design

Date: 2026-10-02. Status: approved in conversation; the boat model is a stand-in.

## Purpose

The real boat tours are closed for 2026 and 2027 while Cleetwood Cove is rebuilt. Sojourney offers the
same trip: the player starts on the dock at Cleetwood Cove, boards the tour boat, can walk the deck while
it follows the real route around the lake, and steps off at Wizard Island. Exploration is the only goal;
nothing forces the player aboard.

## Real-world facts used

- Shore dock: Cleetwood Cove, 42.97635 N, 122.08823 W (OpenStreetMap piers, ways 148388049/148388050).
- Island dock: Wizard Island tour pier, 42.93425 N, 122.15040 W (way 1035287180), where the mapped ferry
  line ends. Two smaller piers lie about 100 m east in Governors Bay (ways 148388048/148388051).
- Route: OpenStreetMap way 429536581 "Wizard Island Tour", a closed loop of 65 points, 24.66 km.
  From Cleetwood Cove it runs west along the north shore under Llao Rock, south down the west side to
  Wizard Island (9.07 km), then along the south shore past Phantom Ship and north up the east shore
  back to Cleetwood Cove (15.59 km).
- The standard tour takes two hours. The real boats are 41 ft and carry 49 passengers.

## Behaviour

- **Route.** The boat follows the mapped loop in that direction, smoothed into a curve, converted from
  latitude/longitude to world coordinates by the pipeline.
- **Speed.** The loop's time under way scales with the day-length setting
  (`settings.dayLengthMinutes`, 5–120, default 30): real time under way = day length ÷ 4. The release
  build will fix the day at 120 minutes, giving a 30-minute tour; shorter days exist so play testing
  stays tractable, and the boat is simply fast at those settings, including while the player fishes.

  | Day length | Loop under way | Cleetwood Cove → Wizard Island | Boat speed |
  |---|---|---|---|
  | 30 min (default) | 7.5 min | 2 min 46 s | 55 m/s |
  | 60 min | 15 min | 5 min 31 s | 27 m/s |
  | 120 min (release) | 30 min | 11 min 2 s | 13.7 m/s (27 knots) |

  The boat eases in and out at each dock. Changing the setting mid-trip changes the speed from that
  moment; the boat's place on the route is kept.
- **Stops.** It waits 5 minutes of real time at each dock, whatever the day length, so there is always
  time to walk aboard. At game start it is docked at Cleetwood Cove with the full wait ahead of it. It
  runs the loop forever.
- **Boarding.** Pier deck and boat deck meet at the same height with a gangplank; the player walks on
  and off. No prompt, no cutscene.
- **On board.** The player walks the deck freely while the boat moves and turns.
- **Fishing from the boat.** Fishing works from the deck, under way and at the docks, with the usual
  depth rule. Today a cast lands at a fixed point on the water (`castTo` in `src/play/Fishing.ts`);
  while the player stands on the boat the cast point, bobber and ripple travel with the boat so the
  line does not stretch away behind it. The hull and rails never block a cast.
- **No fires on the boat.** A fire cannot be laid while the player is standing on the boat, and the
  deck is never a valid place for one; the action is simply not offered.
- **Overboard.** The player swims as normal; the boat carries on. H is the way back.
- **Spawns.** The game starts on the Cleetwood Cove pier. H cycles: Cleetwood Cove pier, Wizard Island
  pier, the island spawn, the rim viewpoint.

## Engine

Stock Babylon only.

- The boat is a transform node with an `ANIMATED` Havok body carrying a deck/hull collision shape,
  moved each frame with `setTargetTransform` along the route curve (`Curve3` / `Path3D`).
- `PhysicsCharacterController.checkSupport` already reports `averageSurfaceVelocity`, and
  `PlayerController.step` already feeds it to `calculateMovement`, so the player is carried by the deck.
  The camera yaw gains the deck's yaw rate while the player is supported by the boat
  (`averageAngularSurfaceVelocity`).
- Piers are static meshes with static collision shapes.
- `Biome` gains a list of named spawn places in place of `spawn` + `viewpoint`, and a `boat` entry
  naming the model, route file, speed and dwell.
- The boat, piers and fire pit join the shadow casters and the lake mirror's render list.

## Assets and pipeline

All Poly Haven, CC0, credited in `CREDITS.md`, built by a props tool in `tools/` to the same rules as
the flora: authored LOD levels, KTX2 textures with full mip chains, meshopt compression.

| Prop | Asset | Notes |
|---|---|---|
| Fire pit | `stone_fire_pit` (1.45 m across, 3,887 triangles) | Replaces the nine-sphere stone ring in `src/play/Campfire.ts`. The log teepee, flames, smoke and fire rules are unchanged. |
| Pier | `modular_wooden_pier` (kit, modules about 19 m long, 84,780 triangles in all) | A straight run assembled per dock; poles sunk so the deck sits at boarding height above the lake. |
| Boat | `dutch_ship_medium` (24 m, 69,162 triangles) | Stand-in until a model closer to the real launches is chosen; swapping it is a change to the biome's `boat` entry and one pipeline row. |

Pier positions and headings are stored as real coordinates; the pipeline samples the heightfield to set
each pier on the shoreline, so they follow the terrain when it is rebuilt. The route is written to the
pack as world-space points, with any point closer than a safe draught to the lake bed pushed offshore.

## Order of work

1. Fire pit (independent of terrain).
2. Terrain rebuild from USGS Data Series 716. Cleetwood Cove lies on the current 10 m data, so its
   shoreline will move.
3. Piers on the rebuilt shoreline; spawn list.
4. Boat: route, motion, collision, boarding, mirror and shadow lists.

Scope of the first session (2026-10-02): steps 1–3, plus the boat placed as a static, moored model at
Cleetwood Cove. Step 4's motion, boarding while under way, and fishing from the deck wait for a later
session.

## Verification

- Fire pit: light a fire, cook, and let it burn out, on the island; screenshot by day and by night.
- Piers: the player can walk from shore to the end of each pier; H reaches all four places.
- Boat: ride a full loop at accelerated dwell/speed in a dev harness and at real speed for one leg;
  the player stays on deck through turns, can walk every part of the deck, can board and leave at both
  docks, and swims after jumping overboard. Cast, hook and land a fish from the deck while the boat is
  moving and while it is docked; confirm no fire can be laid from the deck. Frame rate at the Cleetwood Cove pier and on deck is
  recorded against the rim-viewpoint baseline.

## Out of scope

Narration, other passengers, tickets, the Cleetwood Cove trail, the Governors Bay piers, and boats the
player can steer.
