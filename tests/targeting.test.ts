import { describe, expect, test } from "bun:test";
import { rayGround, rayNear, rayWater } from "../src/play/targeting";

describe("targeting ray calculations", () => {
  test("rayNear returns the along-ray distance only when the closest point is in range", () => {
    const origin = { x: 0, y: 2, z: 0 }, direction = { x: 0, y: 0, z: 1 };
    expect(rayNear(origin, direction, { x: 0.5, y: 2, z: 4 }, 0.5, 10)).toBe(4);
    expect(rayNear(origin, direction, { x: 0.5001, y: 2, z: 4 }, 0.5, 10)).toBeNull();
    expect(rayNear(origin, direction, { x: 0, y: 2, z: -1 }, 1, 10)).toBeNull();
  });

  test("rayWater returns the surface crossing when it is within the horizontal reach", () => {
    expect(rayWater({ x: 1, y: 4, z: 2 }, { x: 0, y: -1, z: 0 }, 1, 0))
      .toEqual({ point: { x: 1, y: 1, z: 2 }, distance: 3 });
    expect(rayWater({ x: 1, y: 4, z: 2 }, { x: 0, y: -1, z: 0 }, 1, -1)).toBeNull();
  });

  test("rayGround keeps its fixed march and binary-refined hit distance", () => {
    expect(rayGround({ x: 0, y: 2, z: 0 }, { x: 0, y: -1, z: 0 }, () => 0, 3))
      .toEqual({ point: { x: 0, y: 0, z: 0 }, distance: 2 });
    expect(rayGround({ x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: 0 }, () => 0, 3)).toBeNull();
  });
});
