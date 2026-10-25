export type Pose = "standing" | "sitting" | "lying";

export interface PoseSpec {
  eyeAboveGround: number;
  minPitch: number;
  maxPitch: number;
  startPitch: number | null;
}

const LOOK_LIMIT = Math.PI / 2.5;
const deg = (d: number) => (d * Math.PI) / 180;

export const POSES: Record<Pose, PoseSpec> = {
  standing: { eyeAboveGround: 1.7, minPitch: -LOOK_LIMIT, maxPitch: LOOK_LIMIT, startPitch: null },
  sitting: { eyeAboveGround: 0.8, minPitch: -LOOK_LIMIT, maxPitch: LOOK_LIMIT, startPitch: null },
  lying: { eyeAboveGround: 0.3, minPitch: deg(-89), maxPitch: deg(-15), startPitch: deg(-70) },
};

const MOVE_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyT"];
const MAX_RECLINE = deg(60);

export function eyeHeight(pose: Pose, seat = 0): number {
  return POSES[pose].eyeAboveGround + (pose === "sitting" ? seat : 0);
}

export function clampPitch(pose: Pose, pitch: number, tilt = 0): number {
  const { minPitch, maxPitch } = POSES[pose];
  const max = pose === "lying" ? maxPitch + tilt : maxPitch;
  return Math.max(minPitch, Math.min(max, pitch));
}

export function reclineTilt(heightBehind: number, heightAhead: number, span: number): number {
  const tilt = Math.atan2(heightBehind - heightAhead, 2 * span);
  return Math.max(-MAX_RECLINE, Math.min(MAX_RECLINE, tilt));
}

export function lieStartPitch(tilt: number): number {
  return clampPitch("lying", POSES.lying.startPitch! + tilt, tilt);
}

export function standsUp(pose: Pose, code: string): boolean {
  if (pose === "standing") return false;
  if (MOVE_KEYS.includes(code)) return true;
  return pose === "sitting" ? code === "Enter" || code === "NumpadEnter" || code === "KeyK" : code === "KeyL";
}

export function canLieDown(grounded: boolean, inWater: boolean): boolean {
  return grounded && !inWater;
}

export function easeTowards(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}
