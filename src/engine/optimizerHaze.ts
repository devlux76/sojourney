// The optimizer's first visible degradation: synthetic haze. Each downgrade rung adds this
// much rain-equivalent fog (clear -> drizzle -> rain -> storm), so distant draws hide in real
// fog and the existing rainReach culling skips them, exactly as a storm does. Oregon expects
// haze; improvement mode walks the rungs back down to clear.
// Ten small rungs from clear to storm rain-equivalent, one per optimizer decision, so the fog
// thickens a tenth at a time and the existing rainReach culling follows it down the same way.
export const HAZE_RAIN = Array.from({ length: 11 }, (_, i) => Math.round((i * 1.4) / 10 * 100) / 100);
export const MAX_HAZE = HAZE_RAIN.length - 1;

let level = 0;
// The rung actually drawn, eased toward the target so the fog rolls in instead of jumping:
// decisions stay coarse (one rung per optimizer step) while the picture interpolates smoothly.
let shown = 0;
// Travel vs beauty, read from the camera: a still camera wants the full picture (restore),
// a fast one wants the frame rate (degrade sooner). Teleports snap to beauty, not travel.
export const STILL_MS = 0.5;
export const TRAVEL_MS = 2.0;
// Standing still means immersion, not a performance problem: frame rate does not matter while
// the player sits with the scene. After this many seconds without camera travel the optimizer
// shuts off and restores full beauty at once instead of trading it for frame rate.
export const STILL_SHUTOFF_SECONDS = 5;
export function stillIdle(nowMs: number, lastMoveMs: number): boolean {
  return nowMs - lastMoveMs >= STILL_SHUTOFF_SECONDS * 1000;
}
// Binoculars count as standing still for the view: the player is studying the scene, so the
// optimizer stays off while zoomed. Travel's own fov animation never touches zoomFactor
// (PlayerController.travel), so this is binoculars only.
export function isZoomedBeauty(zoomFactor: number): boolean {
  return zoomFactor > 1;
}
export const MOTION_TAU_SECONDS = 1;
// Below 80% of target the optimizer always steps down; a fast camera steps down from 90% of
// it, blended linearly between. Full target proved a hair trigger on the boat: ordinary dips
// hazed the ride while the picture was fine.
export function downgradeFloor(targetFps: number, speedMs: number): number {
  const heat = Math.min(1, Math.max(0, speedMs / TRAVEL_MS));
  return targetFps * (0.8 + 0.1 * heat);
}
// Tracks the 10 s decision cadence: smooth rolling without lagging rungs behind.
export const HAZE_EASE_SECONDS = 10;

export function shownHazeRain(): number {
  return shown;
}

// Snap the drawn haze to its rung at once: a stopped boat restores beauty now, not over
// the ease-out. Fog elsewhere always rolls.
export function snapHaze(): void {
  shown = HAZE_RAIN[level];
}

// Move the drawn haze toward the target rung; dt<=0 (paused) snaps to it.
export function updateHaze(dt: number): void {
  const target = HAZE_RAIN[level];
  if (!(dt > 0)) {
    shown = target;
    return;
  }
  shown += (target - shown) * (1 - Math.exp(-dt / HAZE_EASE_SECONDS));
}

export function getHazeLevel(): number {
  return level;
}

export function setHazeLevel(n: number): void {
  level = Math.max(0, Math.min(MAX_HAZE, Math.round(n)));
}

// The current rung as rain-equivalent strength; Fog turns it into density with its own constants.
export function hazeRain(): number {
  return HAZE_RAIN[level];
}
