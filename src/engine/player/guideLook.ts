import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

// The guide's cutscene look, as pure angles: yaw and pitch turn the eye to a world target under
// this game's camera convention (forward is (sin yaw, 0, cos yaw); rotation.x is positive looking
// down, so a higher target takes a negative pitch). Kept free of the scene so the aims stay
// unit-testable against the researched look targets in the route manifest.
export function guideAngles(eye: Vector3, target: Vector3): { yaw: number; pitch: number } {
  const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
  return { yaw: Math.atan2(dx, dz), pitch: -Math.atan2(dy, Math.hypot(dx, dz)) };
}

// One eased step of the head from its current angles toward an aim: the short way round the yaw,
// the same share for both axes so the swing reads as one turn of the head.
export function easeGuideAngles(yaw: number, pitch: number, aim: { yaw: number; pitch: number }, rate: number, dt: number): { yaw: number; pitch: number } {
  let diff = aim.yaw - yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const share = Math.min(1, rate * dt);
  return { yaw: yaw + diff * share, pitch: pitch + (aim.pitch - pitch) * share };
}
