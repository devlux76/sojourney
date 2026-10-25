# Babylon v9 adoption audit

Sojourney began against a v5-era idea of Babylon, and that shows: in several places we have
reimplemented something the engine already ships, or reached into its internals. Internals are
the tell — they mean the public API was not understood, or is not sufficient.

This is a survey of what v9.28.0 actually offers, checked against the installed type
definitions rather than remembered. The governing rule and its citations are in
[the engine usage spec](../specs/2026-09-30-babylon-engine-usage.md); this document is the
evidence behind it.

These were not weighed decisions to bypass the engine. They were the result of not looking,
and the tell was an underscore: reaching into `camera.inputs.attached.keyboard._keys`, and
`checkCollisions = false` with a comment explaining why collisions are not needed rather than
whether they exist.

## Findings

### 1. The thumbstick is a camera input, and Babylon has two

`src/ui/TouchStick.ts` (138 lines) hand-builds a pad, a knob, a dynamic origin, a dead zone, a
run threshold and a document-level touch listener with per-identifier ownership.

Babylon ships both halves as `ICameraInput`:

- `Cameras/Inputs/freeCameraVirtualJoystickInput.pure.d.ts` — `FreeCameraVirtualJoystickInput`,
  with `getLeftJoystick()` / `getRightJoystick()` returning a `VirtualJoystick`
- `Misc/virtualJoystick.d.ts` — `VirtualJoystick`, with `deltaPosition`, `pressed`,
  `setPosition`, `clearPosition`, `puckSize` / `containerSize` / `alwaysVisible` /
  `limitToContainer`, and its own canvas

`VirtualJoystick` is the dynamic-origin pad we wrote, already implemented and already handling
multi-touch identity. It is a canvas element, where ours is two divs plus CSS.

The right shape is a `FreeCameraVirtualJoystickInput` on the camera, registered alongside the
keyboard input, rather than a document listener that competes with the camera's own. That also
removes the reason we removed mouse input by string type name.

Our pad is DOM/CSS and takes our theme; `VirtualJoystick` is a canvas and takes `puckImage` /
`containerImage`. If the visual design is worth keeping, the pad is wrapped in our own
`ICameraInput` — which still removes the document listener, the private key writes, and the
ad-hoc mouse-input removal by string type name.

### 2. Aiming and moving should not go through the keyboard's key codes

`src/core/touchControl.ts:moveKey()` maps a stick vector to the string `"KeyW"` or `"KeyS"`, and
`PlayerController` pushes that keycode into `camera.inputs.attached.keyboard._keys` — a private
field, guarded by a `warnedNoKeyboard` flag whose only purpose is to survive a Babylon upgrade.

`PlayerController.held()` then merges the two worlds back together, and the merge is already
inconsistent: the swim block reads `activeKeys["Space"]` and `activeKeys["KeyC"]` directly but
`!this.held("KeyW")` for the same decision.

v9's answer is a camera input that takes a direction. `ICameraInput<FreeCamera>` needs
`checkInputs()`, `attachControl()`, `detachControl()` and nothing else; movement is whatever the
input writes. `ArcRotateCameraKeyboardMoveInput` is the readable example of an input that turns
key state into direction.

So: define movement and look as *intents* (`{move: {x, y}, look: {dx, dy}}`), let the keyboard
input and a touch input each produce an intent, and mask by UI mode. Actions are already
defined as actions — `decide()` and `decideAll()` take a target and a pack view and return
`Action` — so only the movement layer needs this.

Consequences, both of which need saying out loud:

- `WALK_SPEED` / `RUN_SPEED` are documented as *metres per frame, not a velocity*, because
  Babylon's camera speed is a step. Owning the integration makes them velocities and they get
  dt-scaled. `tests/touchWalk.test.ts` pins metres-per-frame against Babylon's camera and will
  be rewritten. The ten-times-too-slow bug that produced that test comes from exactly this
  mistake — Babylon applies its own dt scale and inertia on top of a naive `speed`.
- We lose Babylon's camera inertia unless we reimplement the glide deliberately.

### 3. Screenshots are hand-rolled; `Misc/screenshotTools` has them

`src/core/Screenshot.ts` captures the canvas by hand — `onEndFrameObservable.addOnce`,
`drawImage`, `toBlob` — and then *additionally* redraws five DOM overlays into the 2D context
(`drawHud`), reimplementing rounded rects, fonts, opacity, padding and line-box centring from
`getComputedStyle`.

`Misc/screenshotTools.pure.d.ts` exports `CreateScreenshot`, `CreateScreenshotAsync` and
`CreateScreenshotUsingRenderTarget`.

**The catch, and it is a real one:** the HUD is DOM, not in the canvas, so no Babylon screenshot
function can capture it — that is the entire reason `drawHud` exists. If the HUD moved to
Babylon GUI (`AdvancedDynamicTexture`), the problem disappears and `CreateScreenshot` becomes the
whole implementation. So this finding is really a finding about the HUD being DOM at all.

### 4. The HUD is DOM while the engine has a GUI

`Overlay`, `SettingsPanel`, `Hud`, the touch sheet and the cluster are all HTML elements created
with `document.createElement` and styled by the `<style>` block in `index.html`.

`@babylonjs/gui` provides `AdvancedDynamicTexture` (a full 2D UI tree rendered into a texture,
so it *is* in the frame, and so it is in every screenshot and every `pickWithRay`).

DOM gives real text rendering, CSS transitions and accessibility nodes for free, and those
are worth weighing. They are not decisive, because they are bought with a screenshot path that
reimplements layout measurement in canvas — finding 3 — and an interface that is absent from
the frame the engine renders, which is not what a screenshot is supposed to mean. The GUI also
carries its own accessibility story, so this is a comparison to make rather than a certainty.

### 5. Picking is reimplemented

`src/play/targeting.ts` hand-rolls a ray march against the terrain height function
(`rayGround`), and `Play` casts its own view ray each frame. Babylon ships `Culling/ray.d.ts`
with `Ray.intersectsMesh`, `intersectsBox`, `intersectsSphere`, `intersectsPlane`,
`intersectsTriangle`, and `scene.pickWithRay` / `pickWith`.

The terrain is a chunked heightfield, so a mesh pick may be slower or may not work across chunk
seams at all. That is a real constraint to measure, not to assume — but the outcome of the
measurement decides *how* to pick, not *whether* to pick with the engine.

### 6. Collisions and gravity are hand-rolled and deliberately off

`PlayerController` does its own gravity (`FALL_ACCELERATION`), its own ground clamp, its own
`allowMove` slope check, and sets `camera.checkCollisions = false` with the comment "No mesh
collisions: follow() handles terrain". `groundMotion.ts` keeps the camera out of tree trunks.

`AbstractMesh` has `checkCollisions`, `applyGravity`, `ellipsoid` and `moveWithCollisions`.

The comment — "No mesh collisions: follow() handles terrain" — answers *why not*, and never
*whether*. That is the shape of a bypass that was never examined. It is the largest body of
hand-rolled physics in the project, and `moveWithCollisions` is the obvious first thing to
re-examine once poses (sitting, lying, swimming) are modelled as Babylon state.

### 7. Audio is split

`src/play/sounds.ts` (142 lines) synthesises every play sound with raw Web Audio — buffers,
biquad filters, gain envelopes — with the comment "no recordings to license or load".

`src/world/AmbientAudio.ts` uses Babylon's `CreateSoundAsync` / `StaticSound`.

So the engine handles ambience and play sounds bypass it. The licence argument for
synthesising rather than recording is sound and stays; what does not survive is carrying two
audio systems. One context, one volume model, one lifecycle.

### 8. Particles: already Babylon

Worth recording as a **positive** finding: `gpuParticleSystem` and `computeShaderParticleSystem`
are both imported, and `particleSystem` appears three times. Rain and fire are already the
engine's. The project is not uniformly guilty, which is what makes the rest worth fixing.

## Outside input

Two more, found while checking the above, both of which the owner had already run into:

### Scene optimization is switched off, and the reason is a symptom

`SceneOptimizer` is imported in `src/core/startGame.ts` and its call is commented out. The
trees render black until you walk up to them, and rain turns the sky black. That is the
signature of a frozen material bound to a variant compiled without the state the code later
put the object into — several optimizer stages freeze materials and world matrices, and the
runtime still writes shader bindings and material defines. It is a stage-selection problem with
a known failure mode, not a reason to leave the engine out of the frame budget.

### The weather test failures are not a weather bug

`tests/Weather.test.ts` fails on 365 of 365 days. Every day has rain in the daylight window,
but every spell is the same length, below the minimum the module's own `RAIN_HOURS` declares.
The cause is in `src/sky/Weather.ts`: an ease-out clamp computes `maxHours` below
`RAIN_HOURS[0]`, so `min(maxHours, lerp(RAIN_HOURS[0], RAIN_HOURS[1], rand()))` is always the
clamp. The intended spread is unreachable and the clamp silently governs cadence. The failing
tests were the canary for this, and were treated as unrelated.

## Order of work

1. **Interface + screenshots (3, 4)** — one decision, then two small rewrites or one large one.
2. **Camera inputs (1, 2)** — the big one. Custom `ICameraInput`, intents, mode masking. Costs a
   test rewrite and the speed-constant semantics.
3. **Scene optimization** — stage selection, justified against what the runtime still writes.
4. **Picking (5)** — needs a measurement first.
5. **Collisions (6), audio (7)** — re-examine.

This document is not a work plan. No task breakdown, no test scaffolding, no ordering within an
item. Those go in `docs/plans/` once the choices above are made.