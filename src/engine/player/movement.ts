import { Vector3 } from "@babylonjs/core/Maths/math.vector";

// Walking uses zero pitch; swimming follows the view's pitch so forward input
// can dive or climb. Strafing remains across the view, with no diagonal speed bonus.
export function setMovementVectors(yaw: number, fwd: number, side: number, speed: number,
  forward: Vector3, right: Vector3, wish: Vector3, pitch = 0): void {
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const horizontal = Math.cos(pitch);
  forward.set(sin * horizontal, -Math.sin(pitch), cos * horizontal);
  right.set(cos, 0, -sin);
  wish.set(forward.x * fwd + right.x * side, forward.y * fwd || 0, forward.z * fwd + right.z * side);
  const lengthSquared = wish.lengthSquared();
  if (lengthSquared > 0) wish.scaleInPlace(speed / Math.sqrt(lengthSquared));
}

// Gameplay water resistance for Babylon's kinematic character: its native
// controller resolves collisions but has no fluid/damping setting. Solve linear
// drag toward the requested stroke plus gravity exactly over the step, avoiding
// unstable Euler damping or a fixed-speed automatic ascent. At rest the authored
// resistance gives a slow downward terminal speed (9.81/16, about 0.61 m/s).
const WATER_DRAG_PER_SECOND = 16;
export function swimVelocityToRef(current: Vector3, stroke: Vector3, gravity: number,
  dt: number, velocity: Vector3): void {
  const blend = 1 - Math.exp(-WATER_DRAG_PER_SECOND * dt);
  Vector3.LerpToRef(current, stroke, blend, velocity);
  velocity.y -= gravity * blend / WATER_DRAG_PER_SECOND;
}
