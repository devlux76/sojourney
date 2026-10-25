import { expect, test } from "bun:test";
import { NullEngine, PBRMaterial, Scene, Texture } from "@babylonjs/core";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
import "@babylonjs/core/Shaders/pbr.fragment";
import "@babylonjs/core/ShadersWGSL/pbr.fragment";
import { LakeSurfaceMaterialPlugin, rippleStrength } from "../src/engine/LakeSurfaceMaterial";

function withPlugin(run: (plugin: LakeSurfaceMaterialPlugin) => void) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    run(new LakeSurfaceMaterialPlugin(new PBRMaterial("water", scene), new Texture(null, scene)));
  } finally {
    scene.dispose();
    engine.dispose();
  }
}

// The footprint roughness reaches Babylon's reflectivity block through a regex hook. A Babylon
// upgrade that renames the call would silently drop it, so check it against the installed source.
for (const [language, store] of [[ShaderLanguage.GLSL, ShaderStore.ShadersStore], [ShaderLanguage.WGSL, ShaderStore.ShadersStoreWGSL]] as const) {
  test(`lake surface hooks: language ${language}`, () => withPlugin(plugin => {
    const hooks = plugin.getCustomCode("fragment", language)!;
    const regexKeys = Object.keys(hooks).filter(key => key.startsWith("!"));
    expect(regexKeys).toHaveLength(1);
    const source = store["pbrPixelShader"];
    expect(source).toBeDefined();
    expect(source.match(new RegExp(regexKeys[0].slice(1), "g"))).toHaveLength(1);
    expect(hooks[regexKeys[0]]).toContain("lakeReflectivity");

    const normals = hooks.CUSTOM_FRAGMENT_BEFORE_LIGHTS;
    expect(normals).toContain("normalW =");
    expect(normals).toContain("lakeReflectivity");
    for (const hook of [hooks.CUSTOM_FRAGMENT_DEFINITIONS, normals]) {
      let depth = 0;
      for (const brace of hook.match(/[{}]/g) ?? []) {
        depth += brace === "{" ? 1 : -1;
        expect(depth).toBeGreaterThanOrEqual(0);
      }
      expect(depth).toBe(0);
    }
  }));
}

for (const language of [ShaderLanguage.GLSL, ShaderLanguage.WGSL]) {
  test(`shallows hook only with a depth texture: language ${language}`, () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const without = new LakeSurfaceMaterialPlugin(new PBRMaterial("a", scene), new Texture(null, scene));
      expect(without.getCustomCode("fragment", language)!.CUSTOM_FRAGMENT_UPDATE_ALPHA).toBe("");
      const depth = { texture: new Texture(null, scene), rect: [-10, -10, 10, 10] as [number, number, number, number], unitMetres: 0.25 };
      const withDepth = new LakeSurfaceMaterialPlugin(new PBRMaterial("b", scene), new Texture(null, scene), { depth });
      const hooks = withDepth.getCustomCode("fragment", language)!;
      expect(hooks.CUSTOM_FRAGMENT_UPDATE_ALPHA).toContain("alpha *=");
      expect(hooks.CUSTOM_FRAGMENT_DEFINITIONS).toContain("lakeDepth");
      const samplers: string[] = [];
      withDepth.getSamplers(samplers);
      expect(samplers).toEqual(["lakeRipples", "lakeDepth"]);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
}

test("calm water keeps today's ripple and wind roughens it", () => {
  expect(rippleStrength(0)).toBeCloseTo(0.37, 2);
  expect(rippleStrength(1)).toBeGreaterThan(4 * rippleStrength(0));
  expect(rippleStrength(-1)).toBe(rippleStrength(0));
  expect(rippleStrength(2)).toBe(rippleStrength(1));
});

test("ripple layers drift and stay in a small range", () => withPlugin(plugin => {
  const before = plugin.offsets.slice();
  for (let i = 0; i < 10000; i++) plugin.advance(0.5, 1);
  expect(plugin.offsets).not.toEqual(before);
  for (const value of plugin.offsets) expect(Math.abs(value)).toBeLessThanOrEqual(1);
}));
