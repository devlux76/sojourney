import * as B from "@babylonjs/core";
import { TerrainMaterialPlugin } from "../src/engine/TerrainMaterial";

// Production material-plugin fixture: two meshes share one cached PBR material.
// Different regional maps must stay independent in every draw on both backends.
const canvas = document.querySelector("canvas")!;
const status = document.querySelector("#status")!;
const gpu = new URLSearchParams(location.search).get("backend") === "webgpu";
const engine = gpu ? new B.WebGPUEngine(canvas, { enableAllFeatures: true, setMaximumLimits: true })
  : new B.Engine(canvas, false, { preserveDrawingBuffer: true });
if (engine instanceof B.WebGPUEngine) await engine.initAsync();
const scene = new B.Scene(engine);
const camera = new B.FreeCamera("overhead", new B.Vector3(0, 10, 0), scene);
camera.setTarget(B.Vector3.Zero());
camera.mode = B.Camera.ORTHOGRAPHIC_CAMERA;
camera.orthoLeft = -2; camera.orthoRight = 2;
camera.orthoTop = 1; camera.orthoBottom = -1;
const sun = new B.DirectionalLight("sun", new B.Vector3(0.8, -1, 0.1), scene);
sun.intensity = 2;
new B.HemisphericLight("fill", B.Vector3.Up(), scene).intensity = 0.2;
const texture = (rgb: number[], width = 1) => {
  const result = B.RawTexture.CreateRGBTexture(new Uint8Array(rgb), width, 1, scene, false, false, B.Texture.NEAREST_SAMPLINGMODE);
  result.wrapU = result.wrapV = B.Texture.CLAMP_ADDRESSMODE;
  return result;
};
const white = texture([220, 220, 220]), micro = texture([128, 128, 255]);
const fallback = texture([128, 128, 255]);
const first = texture([190, 128, 255, 128, 190, 255], 2), second = texture([128, 190, 255]);
const layers = ["gravel", "needles", "soil"];
const arrays = new B.RawTexture2DArray(new Uint8Array(5 * 4).fill(128), 1, 1, 5,
  B.Constants.TEXTUREFORMAT_RGBA, scene, false, false, B.Texture.NEAREST_SAMPLINGMODE);
const textures: Record<string, B.BaseTexture> = { rockAlbedo: white, rockNormal: micro,
  splatMap: texture([255, 0, 0]), lakeMask: texture([0, 0, 0]), normalAo: fallback,
  bedAlbedo: arrays, bedNormal: arrays };
for (const name of layers) { textures[`${name}Tex`] = white; textures[`${name}TexNormal`] = micro; }
const material = new B.PBRMaterial("shared terrain", scene);
material.roughness = 1; material.metallic = 0;
const surface = new TerrainMaterialPlugin(material, { sizeMetres: 18000, waterLevel: 0,
  rockTileMetres: 8, bedTiles: [12, 8, 8, 10, 7], daylightDepthMetres: 40,
  groundLayers: layers.map(name => ({ sampler: `${name}Tex`, normalUrl: "fixture", tileMetres: 3, tint: 0.9 })) }, textures);
const meshes = [-1, 1].map((x, i) => {
  const mesh = B.MeshBuilder.CreateGround(`leaf ${i}`, { width: 2, height: 2 }, scene);
  // Fixture grounds have no authored skirts: avoid interpreting their UVs as skirt markers.
  mesh.removeVerticesData(B.VertexBuffer.UVKind);
  mesh.position.set(x, 1, 0); mesh.material = material;
  return mesh;
});
const target = new B.RenderTargetTexture("binding pixels", { width: 256, height: 128 }, scene, false,
  true, B.Constants.TEXTURETYPE_UNSIGNED_BYTE);
target.activeCamera = camera; target.renderList = meshes;
engine.runRenderLoop(() => scene.render());
await scene.whenReadyAsync();
const device = engine instanceof B.WebGPUEngine ? engine._device : null;
device?.pushErrorScope("validation");
async function pixels() {
  target.render();
  const bytes = await target.readPixels() as Uint8Array;
  // The overhead camera reverses screen X relative to world X. Locate each
  // mesh through Babylon's projection instead of guessing left/right pixels.
  return meshes.map(mesh => {
    const pixel = B.Vector3.Project(mesh.position, B.Matrix.Identity(), scene.getTransformMatrix(),
      new B.Viewport(0, 0, 256, 128));
    const offset = (64 * 256 + Math.floor(pixel.x)) * 4;
    return Array.from(bytes.slice(offset, offset + 3));
  });
}
const baseline = await pixels();
surface.setNormalMap(meshes[0], first, [-3, -1, 3, 2]);
const one = await pixels();
surface.setNormalMap(meshes[1], second, [0, -1, 2, 2]);
const two = await pixels();
// Move only the registered texture rectangle: the mesh must sample the other
// authored normal texel, while the other mesh keeps its own rectangle and map.
surface.setNormalMap(meshes[0], first, [-2, -1, 4, 2]);
const registered = await pixels();
surface.setNormalMap(meshes[0], null);
const released = await pixels();
const difference = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const checks = { leftChanges: difference(one[0], baseline[0]) > 3,
  rightKeepsFallback: difference(one[1], baseline[1]) <= 1,
  rightChanges: difference(two[1], baseline[1]) > 3,
  leftKeepsRegion: difference(two[0], one[0]) <= 1,
  registrationChangesSample: difference(registered[0], two[0]) > 3,
  registrationKeepsOtherMesh: difference(registered[1], two[1]) <= 1,
  leftRestoresFallback: difference(released[0], baseline[0]) <= 1,
  rightKeepsRegion: difference(released[1], two[1]) <= 1 };
const validationError = device ? await device.popErrorScope() : null;
const glError = engine instanceof B.Engine ? engine._gl?.getError() : null;
const result = { backend: gpu ? "WebGPU" : "WebGL2", checks, baseline, one, two, registered, released,
  validationError: validationError?.message ?? null, glError,
  pass: Object.values(checks).every(Boolean) && !validationError && !glError };
Object.assign(window, { terrainNormalBinding: { result, scene, engine, surface, meshes } });
status.textContent = JSON.stringify(result, null, 2);
