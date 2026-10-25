import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";
import { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine";
import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import type { Ground } from "../../core/groundMotion";

export const GROUND_MASK = 1;
export const OBSTACLE_MASK = 2;
export const PLAYER_MASK = 4;
export const NO_GROUND = -1000;

const TOP = 1000;
const BOTTOM = -1000;

export interface PhysicsGround extends Ground {
  // The first surface of the mask under (x, z), looking down from fromY (from far above by default).
  hit(x: number, z: number, mask: number, fromY?: number): PhysicsRaycastResult | null;
  getHeight(x: number, z: number, fromY?: number): number;
  // The prop (a pier, the ship) whose deck is the ground at (x, z), or null on the terrain.
  propAt(x: number, z: number): Node | null;
  prepare(x: number, z: number): Promise<void>;
}

export function createGround(scene: Scene): PhysicsGround {
  const result = new PhysicsRaycastResult();
  const from = new Vector3();
  const to = new Vector3();

  function hit(x: number, z: number, mask: number, fromY = TOP): PhysicsRaycastResult | null {
    const engine = scene.getPhysicsEngine();
    if (!(engine instanceof PhysicsEngine)) return null;
    from.set(x, fromY, z);
    to.set(x, BOTTOM, z);
    engine.raycastToRef(from, to, result, { collideWith: mask });
    return result.hasHit ? result : null;
  }

  return {
    hit,
    prepare: async () => {},
    getHeight(x, z, fromY) {
      return hit(x, z, GROUND_MASK, fromY)?.hitPointWorld.y ?? NO_GROUND;
    },
    // A prop's collision boxes hang from its root node; the terrain's bodies have no parent.
    propAt(x, z) {
      return hit(x, z, GROUND_MASK)?.body?.transformNode.parent ?? null;
    },
    onProp(x, z) {
      return hit(x, z, GROUND_MASK)?.body?.transformNode.parent != null;
    },
    getSlope(x, z) {
      const r = hit(x, z, GROUND_MASK);
      if (!r) return 0;
      const ny = r.hitNormalWorld.y;
      return ny <= 0 ? Infinity : Math.sqrt(1 - ny * ny) / ny;
    },
    inBounds() {
      return true;
    },
    blocked(x, z) {
      return hit(x, z, OBSTACLE_MASK) !== null;
    },
  };
}
