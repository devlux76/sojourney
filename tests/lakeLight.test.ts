import { expect, test } from "bun:test";
import { NullEngine, PBRMaterial, PointLight, Scene, Texture, Vector3 } from "@babylonjs/core";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { elevationAndBearing, fillVisibility, type LakeHorizon } from "../src/engine/LakeLight";
import { LakeSurfaceMaterialPlugin } from "../src/engine/LakeSurfaceMaterial";

test("a light's elevation and compass bearing come from the way it travels", () => {
  // Overhead, and a sun on the eastern horizon shining west (+x is east, +z north).
  expect(elevationAndBearing({ x: 0, y: -1, z: 0 })[0]).toBeCloseTo(90);
  const [elevation, bearing] = elevationAndBearing({ x: -1, y: 0, z: 0 });
  expect(elevation).toBeCloseTo(0);
  expect(bearing).toBeCloseTo(90);
  expect(elevationAndBearing({ x: 0, y: -0.5, z: 1 })[1]).toBeCloseTo(180);
});

test("a light is seen above the rim, hidden below it, and half seen across the disc", () => {
  // Two cells, four bearings; the rim stands 10 degrees high at every bearing.
  const cells = 2, azimuths = 4;
  const horizon: LakeHorizon = { layers: new Uint8Array(cells * azimuths).fill(40), cols: 2, rows: 1, azimuths, unitDegrees: 0.25, rect: [0, 0, 1, 1] };
  const data = new Uint8Array(cells * 2);
  fillVisibility(horizon, 20, 45, data, 0);
  expect(data[0]).toBe(255);
  fillVisibility(horizon, 0, 45, data, 0);
  expect(data[0]).toBe(0);
  fillVisibility(horizon, 10, 45, data, 1);
  expect(data[1]).toBeGreaterThan(120);
  expect(data[1]).toBeLessThan(135);
  // Channel 0 is left as it was.
  expect(data[0]).toBe(0);
});

for (const language of [ShaderLanguage.GLSL, ShaderLanguage.WGSL]) {
  test(`light share hooks only with a light texture: language ${language}`, () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const without = new LakeSurfaceMaterialPlugin(new PBRMaterial("a", scene), new Texture(null, scene));
      expect(without.getCustomCode("fragment", language)!.CUSTOM_LIGHT0_COLOR).toBe("");
      const sun = new PointLight("sun", Vector3.Zero(), scene);
      const moon = new PointLight("moon", Vector3.Zero(), scene);
      const light = { texture: new Texture(null, scene), rect: [0, 0, 1, 1] as [number, number, number, number], sun, moon };
      const withLight = new LakeSurfaceMaterialPlugin(new PBRMaterial("b", scene), new Texture(null, scene), { light });
      const hooks = withLight.getCustomCode("fragment", language)!;
      expect(hooks.CUSTOM_LIGHT0_COLOR).toContain("lakeLit");
      expect(hooks.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toContain("lakeLit");
      expect(hooks.CUSTOM_FRAGMENT_DEFINITIONS).toContain("lakeLight");
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
}
