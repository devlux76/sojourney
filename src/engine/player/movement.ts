import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

// Fill the player's horizontal basis and normalized wish velocity into vectors reused each frame.
export function setMovementVectors(yaw: number, fwd: number, side: number, speed: number,
  forward: Vector3, right: Vector3, wish: Vector3): void {
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  forward.set(sin, 0, cos);
  right.set(cos, 0, -sin);
  wish.set(sin * fwd + cos * side, 0, cos * fwd - sin * side);
  const lengthSquared = wish.lengthSquared();
  if (lengthSquared > 0) wish.scaleInPlace(speed / Math.sqrt(lengthSquared));
}
