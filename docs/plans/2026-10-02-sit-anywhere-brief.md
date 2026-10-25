# Brief: sit on rocks, boulders and the ground

Do this work yourself, in this session. Repo: `/home/mirai/projects/sojourney`. Work in place on `main`.
Do not commit. Do not create branches. Do not start, stop, restart or install anything (no servers, no
dev server, no ollama). Do not ask the user anything: if unsure, pick the obvious default and note it in
the report. Other work is in progress in this repo: do not touch, revert or "tidy" any file not listed
below, even if `git status` shows it modified.

Runtime is Bun only (`bun run typecheck`); never `npm`, `npx` or `node`.

## Today

The player can sit only on a tree stump: `src/play/Chopping.ts` `find()` returns a target of kind
`"stump"`, `src/play/actions.ts` turns that into the `"sit"` action, and `Play.sit(seat)` calls
`PlayerController.sit(seat)` (`src/engine/player/PlayerController.ts`), which sits the player at any
point it is given. `L` lies down where the player stands (`tryLieDown`).

## Goal

1. Looking at a rock or boulder within reach offers "sit" (the reticle and the touch button appear by
   themselves once the target exists), and doing it sits the player on top of that rock.
2. Pressing `K` sits the player on the ground where they stand; `K` again, Enter or a move key stands
   up. Touch gets a "Sit" row in the sheet.

## You may edit only

`src/engine/flora.ts`, `src/play/Sitting.ts` (new), `src/play/actions.ts`, `src/play/Chopping.ts`,
`src/play/Play.ts`, `src/engine/world.ts`, `src/engine/player/PlayerController.ts`, `src/core/pose.ts`,
`src/core/Hud.ts`, `src/core/touchSheetRows.ts`, `src/ui/TouchSheet.ts`.

Match the surrounding code's style (two-space indent, double quotes, terse). Comment what you add: what
it does and why, in plain sentences. No feature flags, no settings, nothing beyond the steps below.

## Steps

### 1. `src/play/actions.ts` and `src/play/Chopping.ts`: a seat is not only a stump

Rename the target kind `"stump"` to `"seat"` in the `Target` union and in `handsFreeAction`
(`case "seat": return "sit";`), and in `Chopping.find()` (`target: { kind: "seat" }`). Nothing else in
those two files changes.

### 2. `src/engine/flora.ts`: where the rocks are

Add, exported, above the `Flora` class:

```ts
// The top of a rock the player could sit on: the centre of its top in world metres and the radius of its footprint.
export interface RockSeat { x: number; y: number; z: number; radius: number }
```

In `Flora`, keep the seats in a grid of 4 m cells (a `Map<string, RockSeat[]>` keyed `"cx,cz"`; follow
`src/play/TrunkGrid.ts` for the pattern, but do not edit that file) and add a method:

```ts
seatsNear(x: number, z: number, radius: number): RockSeat[]
```

returning every seat whose centre is within `radius` of (x, z) horizontally.

Fill the grid in `add()`, after `this.batches.push(batch)`, when `species.kind === "rock"`. For the
species take the local bounding box once: `levels[0].getBoundingInfo().boundingBox`, fields `minimum` and
`maximum`. For every instance `i` in `[first, end)` read its matrix from `this.placements` at offset
`i * 16`:

- `scale` = length of the vector `(m[0], m[1], m[2])` (the placements are uniformly scaled);
- `x = m[12]`, `z = m[14]`;
- `y = m[13] + maximum.y * scale` (the top; ignore the rock's tilt);
- `radius = 0.5 * Math.max(maximum.x - minimum.x, maximum.z - minimum.z) * scale`.

Keep the seat only if `radius` is between 0.3 and 2.0 m: smaller is a pebble, larger is a scatter patch
of many small rocks, not one rock. Put the two limits in named constants at the top of the file.

### 3. `src/play/Sitting.ts` (new): rocks as seats

A new `Activity` (the interface is in `src/play/Play.ts`; `Chopping` is the model to follow) taking
`(play: Play, flora: Flora)`:

- `find(ray)`: for each seat from `flora.seatsNear(origin.x, origin.z, REACH + 2)`, let
  `rise = seat.y - this.play.ground.getHeight(seat.x, seat.z)`. Skip it unless `rise` is between 0.25 and
  1.4 m (named constants): lower is not worth sitting on, higher cannot be climbed onto. Test the view
  ray with `rayNear(origin, dir, { x: seat.x, y: seat.y - rise / 2, z: seat.z }, seat.radius, REACH)`
  (from `./targeting`). Return the nearest hit as
  `{ target: { kind: "seat" }, distance, perform: () => this.play.sit(new Vector3(seat.x, seat.y, seat.z)) }`,
  or `null`.
- `update()` does nothing.

Register it in `src/engine/world.ts` next to the other activities: `play.add(new Sitting(play, flora));`.

### 4. Sitting on the ground: `K`

`src/core/pose.ts`, `standsUp`: a sitting player also stands on `KeyK`:
`pose === "sitting" ? code === "Enter" || code === "NumpadEnter" || code === "KeyK" : code === "KeyL"`.

`src/engine/player/PlayerController.ts`:

- Add `trySit()` next to `tryLieDown()`: return unless `this.currentPose === "standing"`; take
  `{ x, z }` from `this.body.getPosition()`; if
  `canLieDown(this.grounded, this.ground.getHeight(x, z) < WATER_Y && inLake(x, z))` call
  `this.sit(new Vector3(x, this.ground.getHeight(x, z), z))`.
- In **both** key handlers (the `keydown` listener and `setVirtualKey`), treat `KeyK` exactly as `KeyL`
  is treated: add `|| e.code === "KeyK"` (resp. `code === "KeyK"`) to the early `return` after
  `this.stand()`, and add `if (e.code === "KeyK") this.trySit();` (resp. `code`) beside the `KeyL` line.
- In `stand()`, the step back off the seat (`STEP_OFF_STUMP`) must happen only when the seat is raised:
  wrap that block so it runs only if `this.seat.y - this.ground.getHeight(this.seat.x, this.seat.z) > 0.05`.
  A player sitting on the ground stands up where they are.

`src/play/Play.ts`: add `trySit(): void` to the `poseControl` type, and a public method beside the
existing `lieDown()`, written the same way, that calls `this.poseControl?.trySit()`. Name it `sitDown()`.

`src/core/touchSheetRows.ts`: add a row kind `"sit"` with the label `"Sit"`, placed just before
`"lie down"` in `SheetRow`, `LABELS` and `SHEET_ROWS`. `src/ui/TouchSheet.ts`: handle it beside the
`"lie down"` case with `play.sitDown()`.

`src/core/Hud.ts`: in `KEYS`, insert `K sit   ` just before `L lie down`.

## Check

`bun run typecheck` must pass with no errors. There are no test files in this repo; do not add any.

## Report

List each file changed with one sentence on what changed, paste the output of `bun run typecheck`, and
state any default you chose or anything you could not do.
