import { expect, test } from "bun:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";

// The KTX2 loader's browser registration reads document.baseURI at module load time.
Object.defineProperty(globalThis, "document", {
  value: { baseURI: "http://localhost/", addEventListener() {}, removeEventListener() {} }, configurable: true,
});
const { createFlatGroundMaterial } = await import("../src/engine/ground");

test("bare terrain material has a flat colour and no textures", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const material = createFlatGroundMaterial(scene);

  expect(material.getActiveTextures()).toHaveLength(0);
  expect(material.albedoColor.asArray()).toEqual([0.36, 0.38, 0.4]);

  scene.dispose();
  engine.dispose();
});
