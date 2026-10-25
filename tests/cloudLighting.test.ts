import { describe, expect, test } from "bun:test";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { updateCloudColors } from "../src/engine/environment/cloudLighting";

describe("updateCloudColors", () => {
  test("writes cloud colours into reusable outputs without changing scene or light colours", () => {
    const sceneAmbient = new Color3(0.1, 0.2, 0.3);
    const sun = new Color3(1, 0.8, 0.6);
    const moon = new Color3(0.2, 0.3, 0.5);
    const lit = new Color3();
    const shade = new Color3();
    const ambient = new Color3();
    const contribution = new Color3();

    updateCloudColors(sceneAmbient, sun, 2, moon, 0.5, 0.4, 0.25, 1.5, 0.2, 0.35, 0.3, 0.55,
      lit, shade, ambient, contribution);

    expect(lit.r).toBeCloseTo(0.86265, 12);
    expect(lit.g).toBeCloseTo(0.8678, 12);
    expect(lit.b).toBeCloseTo(0.89045, 12);
    expect(shade.r).toBeCloseTo(0.119025, 12);
    expect(shade.g).toBeCloseTo(0.23805, 12);
    expect(shade.b).toBeCloseTo(0.357075, 12);
    expect(sceneAmbient.asArray()).toEqual([0.1, 0.2, 0.3]);
    expect(sun.asArray()).toEqual([1, 0.8, 0.6]);
    expect(moon.asArray()).toEqual([0.2, 0.3, 0.5]);
  });
});
