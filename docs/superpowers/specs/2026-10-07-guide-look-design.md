# Guide look cutscene design (2026-10-07)

While the tour guide's voice line plays and the player is aboard, input locks and
the camera swings to face the talked-about feature in full 3D, then releases.
Cutscene feel per playtester request. No escape hatch in v1.

## 1. Look-target data & GPS research — approved

One authored world-space aim point per stop (`lookAt: [x, y, z]`, lake y=0),
owned by the pipeline: `tools/build_route.py` gains the research table, the
`boat_tour.json` sights + docks gain `lookAt`, game reads it from the route
manifest. No boat-relative offsets.

| Stop | Start point | Aim (mid-feature) |
|---|---|---|
| Llao Rock | GNIS 1145305 (-122.13338, 42.97208) | mid grey face, ~250–300 m up |
| Devils Backbone | GNIS 1140934 (-122.15816, 42.96094) | mid-spine of the dike |
| Phantom Ship | GNIS 1147629 (-122.09254, 42.91097) | island mid-height (~25 m up) |
| Pumice Castle | GNIS 1134046 (-122.05754, 42.92902) | orange castle band ~400 m up the east wall, offset off the rim point onto the face; verified vs `places/pumice-castle/` photos |
| Wizard Island | cone summit (research summit lat/lon, +213 m cone) | upper cone / crater rim |
| Cleetwood Cove | cove head / trail foot (research) | shoreline where the trail meets water |

lat/lon → UTM EPSG:26910 minus `ORIGIN_UTM` (as `build_route.py` does);
elevation from lidar heightfield, nudged to the visible band. Validation:
boat at each stop distance in the world harness, eye→lookAt within ~5° of
frame center at default FOV.

Arrive lines aim at the current stop. Depart lines ("Next stop: X") aim at the
**next** stop's lookAt — the sentence's subject, normally ahead of the bow.

## 2. Audio end signal

`AmbientAudio.guide()` is fire-and-forget today (3 s `GUIDE_DELAY` timer, then
play, no end event). It gains an end promise: streaming recordings resolve via
the sound's ended observable; `AudioBuffer` (Kokoro live voice) the same;
browser `speechSynthesis` via `utterance.onend`. `Narrator.say()` returns that
promise (browser path included). Safety timeouts (45 s arrive / 20 s depart)
release a stuck lock; audio failure or `tourGuide: off` means no lock at all.
A turn counter (like `Narrator.speaking`) supersedes a stale lock when a new
line starts. Lock starts at speech start (after the bell gap), not at the
`onArrive`/`onDepart` moment.

## 3. Camera lock

`PlayerController` gains `guided`, mirroring `travelling`: keydown/stick/
mouse-look/arrow keys, `startZoom`, T-travel and `held()`/`stickKey()` all read
it as locked. Pose, head-bob and FOV are untouched; eye is `camera.globalPosition`
so sitting works. Each frame while guided, yaw/pitch ease toward the live
eye→lookAt (`easeTowards`, rate for ~1.2 s settle, short-way-round yaw) — one
mechanism giving both the smooth swing and depart-while-moving tracking.
`ride()` still carries body position with the boat; its `yawStep` addition is
skipped while guided (re-aim covers heading change).

## 4. Release, edge cases, testing

Release on: line end + 0.75 s beat; player leaves the boat (`aboard` false:
steps ashore at a dock, jumps/falls overboard); settings/soundcheck panel
opens; new line supersedes. Overlay announcements unchanged. Depart re-aim
uses the live boat eye each frame so the fixed world target stays framed as
the ship gets under way.

Regression anchor `harness/guideLook.ts`: per stop, eye→lookAt centers the
photo-matched feature ≤5°; inputs blocked while guided; release on end/timeout/
ashore/panel; no lock when ashore or guide off; depart target stays within
frame over 10 s of sailing. In-game: full-tour ride screenshots at each arrive.
