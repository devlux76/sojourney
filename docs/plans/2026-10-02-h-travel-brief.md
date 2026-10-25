# Brief: H travels to the next place instead of teleporting at once

Do this work yourself, in this session. Repo: `/home/mirai/projects/sojourney`. Work in place on `main`.
Do not commit. Do not create branches. Do not start, stop, restart or install anything (no servers, no
dev server, no ollama). Do not run any tool under `tools/` and do not change anything under `public/`.
Do not ask the user anything: if unsure, pick the obvious default and note it in the report. Do not
touch, revert or "tidy" any file not listed below, even if `git status` shows it modified.

Runtime is Bun only (`bun run typecheck`); never `npm`, `npx` or `node`.

## Today

`src/engine/player/PlayerController.ts`: pressing `H` calls `this.spawn((this.spawnIndex + 1) % this.spawns.length)`,
which stands the player up, awaits `this.ground.prepare(x, z)` (loads the ground and its collision around
the place), then `teleport`s and sets the camera heading. The player is moved at once.

## Goal

Pressing `H` turns the camera toward the place the player will land, zooms in on that spot, then puts the
player there. Everything else that calls `spawn` stays instant: the first spawn in
`src/core/startGame.ts`, `Play.home()`, and the fall-out-of-the-world respawn in `update()`.

## You may edit only

`src/engine/player/PlayerController.ts`.

Match the file's style (two-space indent, double quotes, terse). Comment what you add: what it does and
why, in plain sentences. No settings, no feature flags, nothing beyond the steps below. Use Babylon as it
ships; the calls named here were checked against `node_modules/@babylonjs/core` (9.x):

- `Animation.CreateAndStartAnimation(name, target, targetProperty, framePerSecond, totalFrame, from, to, loopMode, easingFunction, onAnimationEnd, scene)`
  returns `Nullable<Animatable>`; `Animatable.waitAsync()` resolves when it ends. Import `Animation` from
  `@babylonjs/core/Animations/animation`.
- `CubicEase` and `EasingFunction` from `@babylonjs/core/Animations/easing`;
  `ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT)`.
- `Animation.ANIMATIONLOOPMODE_CONSTANT` is the loop mode for a one-shot animation.

## Steps

### 1. Constants (next to the others at the top)

```ts
const TRAVEL_TURN_SECONDS = 1.2;
const TRAVEL_ZOOM_SECONDS = 0.8;
const TRAVEL_ZOOM_FOV = 0.2;
const TRAVEL_MIN_METRES = 5;
const TRAVEL_FPS = 60;
```

### 2. A `travelling` flag

Add `private travelling = false;`. While it is true the player neither moves nor looks:

- `held(code)` returns `false`, and `stickKey()` returns `null`, so `step()` gets no walking, running,
  swimming up/down or sideways input. In `step()` also clear `this.jumpRequested` when travelling so a
  Space pressed during the move does not jump on arrival.
- In `update()`, when travelling: skip the pitch trim line, the stick/arrow-key rotation block and the
  pitch easing/clamping block (the animation owns the camera's rotation), and call
  `camera.cameraRotation.setAll(0)` so mouse or touch look does not build up. The out-of-world check at
  the end of `update()` still runs.
- In the two places that handle a key going down (the `keydown` listener and `setVirtualKey`), do
  nothing but record the key in `activeKeys`/`virtualKeys` when travelling: no standing up, lying,
  sitting, jumping, and a second `H` is ignored.

### 3. `async travel(index: number)` (public, next to `spawn`)

```
if travelling: return
place = this.spawns[index]; camera = this.camera; scene = camera.getScene()
if the horizontal distance from camera.position to place.position < TRAVEL_MIN_METRES:
  return this.spawn(index)                       // already there: nothing to look at
travelling = true
fov = camera.fov
try:
  this.stand()
  await this.ground.prepare(place.position.x, place.position.z)   // collision there, so its height is known
  groundY = this.ground.getHeight(place.position.x, place.position.z)
  targetY = groundY > NO_GROUND ? Math.max(place.position.y, groundY) : place.position.y
  dx, dy, dz = (place.x, targetY, place.z) - camera.position
  yaw   = Math.atan2(dx, dz)
  pitch = -Math.atan2(dy, Math.hypot(dx, dz))    // rotation.x is positive looking down
  // Turn the short way round: bring yaw to within half a turn of the current rotation.y.
  yaw = camera.rotation.y + the difference (yaw - camera.rotation.y) wrapped into [-PI, PI]
  ease = new CubicEase(), mode EASINGMODE_EASEINOUT
  await Animation.CreateAndStartAnimation("travelTurn", camera, "rotation", TRAVEL_FPS, TRAVEL_FPS * TRAVEL_TURN_SECONDS,
    camera.rotation.clone(), new Vector3(pitch, yaw, 0), Animation.ANIMATIONLOOPMODE_CONSTANT, ease, undefined, scene)!.waitAsync()
  await Animation.CreateAndStartAnimation("travelZoom", camera, "fov", TRAVEL_FPS, TRAVEL_FPS * TRAVEL_ZOOM_SECONDS,
    fov, TRAVEL_ZOOM_FOV, Animation.ANIMATIONLOOPMODE_CONSTANT, ease, undefined, scene)!.waitAsync()
  await this.spawn(index)                        // prepare again (the first one is only held for 3 s), teleport, set heading
finally:
  camera.fov = fov
  travelling = false
```

The place may be kilometres away or hidden behind terrain; the camera still aims at its ground point.
`spawn` already calls `stand()`, `prepare`, `teleport` and sets the heading; do not change `spawn` or
`teleport`.

### 4. The H key

In the `keydown` listener, `H` calls `this.travel((this.spawnIndex + 1) % this.spawns.length)` instead
of `this.spawn(...)`.

## Check

`bun run typecheck` must pass with no errors. There are no test files in this repo; do not add any.

## Report

One sentence on each change, the output of `bun run typecheck`, and any default you chose or anything
you could not do.
