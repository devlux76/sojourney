import { expect, test } from "bun:test";
import { NullEngine, PBRMaterial, Scene } from "@babylonjs/core";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { TerrainMaterialPlugin, type TerrainLook } from "../src/engine/TerrainMaterial";

// Check the emitted hooks, rather than TypeScript source: GPU compilation in the
// terrain harness remains the final check for both shader languages.
for (const language of [ShaderLanguage.GLSL, ShaderLanguage.WGSL]) {
  for (const cinder of [undefined, { arrayLayer: 5, tileMetres: 2 }]) {
    test(`terrain hook scope: language ${language}, cinder ${!!cinder}`, () => {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      try {
        const look: TerrainLook = {
          sizeMetres: 10000, waterLevel: 0, rockTileMetres: 4,
          bedTiles: [2, 2, 2, 2, 2], daylightDepthMetres: 20, cinder,
          groundLayers: ["gravelTex", "needlesTex", "soilTex"].map(sampler => ({
            sampler, normalUrl: "normal.ktx2", tileMetres: 2, tint: 1,
          })),
        };
        const plugin = new TerrainMaterialPlugin(new PBRMaterial("ground", scene), look, {});
        const hooks = plugin.getCustomCode("fragment", language)!;
        const colour = hooks.CUSTOM_FRAGMENT_UPDATE_ALPHA;
        const normals = hooks.CUSTOM_FRAGMENT_BEFORE_LIGHTS;
        // Normal variables belong after Babylon's colour hook. Putting the
        // cinder branch in colour caused undeclared variables and broken scope.
        expect(colour).not.toMatch(/\b(?:landN|bedN)\b/);
        for (const hook of [colour, normals]) {
          let depth = 0;
          for (const brace of hook.match(/[{}]/g) ?? []) {
            depth += brace === "{" ? 1 : -1;
            expect(depth).toBeGreaterThanOrEqual(0);
          }
          expect(depth).toBe(0);
        }
        if (cinder) {
          expect(normals).toContain("triplanarNormalArray(bedNormal,");
          expect(normals).toContain("substrate > 0.5 && substrate < 1.5");
        }
      } finally {
        scene.dispose();
        engine.dispose();
      }
    });
  }
}
