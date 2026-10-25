import { describe, expect, test } from "bun:test";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { setMovementVectors } from "../src/engine/player/movement";

describe("setMovementVectors", () => {
  test("fills reusable forward, right, and diagonal movement vectors", () => {
    const forward = new Vector3(), right = new Vector3(), wish = new Vector3();
    setMovementVectors(Math.PI / 2, 1, 1, 4, forward, right, wish);
    expect(forward.x).toBeCloseTo(1, 12);
    expect(forward.z).toBeCloseTo(0, 12);
    expect(right.x).toBeCloseTo(0, 12);
    expect(right.z).toBeCloseTo(-1, 12);
    expect(wish.x).toBeCloseTo(4 / Math.sqrt(2), 12);
    expect(wish.z).toBeCloseTo(-4 / Math.sqrt(2), 12);
  });

  test("zeros wish when neither axis is requested", () => {
    const forward = new Vector3(), right = new Vector3(), wish = new Vector3(1, 1, 1);
    setMovementVectors(0, 0, 0, 4, forward, right, wish);
    expect(wish.asArray()).toEqual([0, 0, 0]);
  });
});
