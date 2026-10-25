import { easeTowards } from "./pose";

export const STEP_METRES = 0.75;
export const WALK_SPEED = 2.5;
export const RUN_SPEED = 6;
const WALK_AMPLITUDE = 0.035;
const RUN_AMPLITUDE = 0.055;
const FADE_RATE = 8;
const SWAY = 0.4;

export interface BobState { distance: number; amplitude: number }

export function stepBob(state: BobState, walked: number, speed: number, dt: number): BobState {
  const pace = Math.max(0, Math.min(1, (speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));
  const target = walked === 0 ? 0
    : speed < WALK_SPEED ? WALK_AMPLITUDE * (speed / WALK_SPEED)
    : WALK_AMPLITUDE + (RUN_AMPLITUDE - WALK_AMPLITUDE) * pace;
  return { distance: state.distance + walked, amplitude: easeTowards(state.amplitude, target, FADE_RATE, dt) };
}

export function bobOffset(state: BobState, intensity: number): { up: number; side: number } {
  const a = state.amplitude * intensity, phase = (Math.PI * state.distance) / STEP_METRES;
  return { up: -a * Math.abs(Math.sin(phase)), side: SWAY * a * Math.sin(phase) };
}
