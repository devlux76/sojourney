import "../src/core/startGame";
import {
  Engine, Scene, FreeCamera, Vector3, Color3, Color4, MeshBuilder, PBRMaterial,
  DirectionalLight, HemisphericLight, PointLight, RawTexture, RenderTargetTexture,
  Texture, Constants,
} from "@babylonjs/core";
import { createEngine, describeBackend } from "../src/core/Engine";
import { lightSubmergedObjects } from "../src/engine/WaterDepthMaterial";

// A development-only, real-GPU pixel test isolates light paths from fog/exposure.
// Gameplay uses the same plugin and an actual lake mask with all effects enabled.
const canvas = document.querySelector<HTMLCanvasElement>("#renderCanvas")!;
const engine = new URLSearchParams(location.search).get("backend") === "webgl"
  ? new Engine(canvas, false) : await createEngine(canvas);
const scene = new Scene(engine);
scene.clearColor = new Color4(0, 0, 0, 1);
scene.imageProcessingConfiguration.isEnabled = false;
const camera = new FreeCamera("camera", new Vector3(0, 0, -4), scene);
const maskBytes = new Uint8Array([255]);
const mask = RawTexture.CreateRTexture(maskBytes, 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
const water = new PBRMaterial("excludedWater", scene);
lightSubmergedObjects(scene, mask, 1000, water);
const material = new PBRMaterial("sample", scene);
material.albedoColor = Color3.White();
material.metallic = 0;
material.roughness = 1;
material.allowShaderHotSwapping = false;
const sphere = MeshBuilder.CreateBox("sample", { size: 2 }, scene);
sphere.material = material;
const directional = new DirectionalLight("sun", new Vector3(0, -0.3, 1), scene);
const hemisphere = new HemisphericLight("sky", Vector3.Up(), scene);
const lamp = new PointLight("lamp", new Vector3(0, 0, -2), scene);
lamp.intensity = 0.5;
const target = new RenderTargetTexture("measurement", 64, scene, false);
target.activeCamera = camera;
target.renderList = [sphere];
scene.customRenderTargets.push(target);
engine.runRenderLoop(() => scene.render());

async function pixel(depth: number, inLake: boolean, light: "sun" | "sky" | "lamp" | "emission", straddle = false) {
  maskBytes[0] = inLake ? 255 : 0;
  mask.update(maskBytes);
  sphere.position.y = straddle ? -30 : -depth;
  // One shared material can cross the surface: sample different world heights
  // without changing its origin or introducing per-object attenuation uniforms.
  sphere.scaling.y = straddle ? 80 : 1;
  camera.position.set(0, -depth, -4);
  camera.setTarget(new Vector3(0, -depth, 0));
  sphere.computeWorldMatrix(true);
  camera.getViewMatrix(true);
  lamp.position.set(0, -depth, -2);
  directional.setEnabled(light === "sun");
  hemisphere.setEnabled(light === "sky");
  lamp.setEnabled(light === "lamp");
  material.emissiveColor = light === "emission" ? new Color3(0.25, 0.25, 0.25) : Color3.Black();
  await material.forceCompilationAsync(sphere);
  for (let i = 0; i < 3; i++) await new Promise<void>(resolve => scene.onAfterRenderObservable.addOnce(() => resolve()));
  const pixels = await target.readPixels();
  if (!pixels) throw new Error("Render-target readback unavailable");
  const data = pixels as Uint8Array;
  const index = (32 * 64 + 32) * 4;
  return Array.from(data.slice(index, index + 3));
}

async function check() {
  const results = [];
  for (const light of ["sun", "sky", "lamp", "emission"] as const) {
    const above = await pixel(-2, true, light);
    const shallow = await pixel(30, true, light);
    const deep = await pixel(140, true, light);
    const dry = await pixel(140, false, light);
    const dims = light === "sun" || light === "sky";
    if (above[0] < 10 || (dims ? !(deep[0] < shallow[0] && shallow[0] < above[0]) : Math.abs(deep[0] - above[0]) > 2)
      || Math.abs(dry[0] - above[0]) > 2) throw new Error(`${light} lighting contract failed: ${JSON.stringify({ above, shallow, deep, dry })}`);
    results.push({ light, above, shallow, deep, dry });
  }
  const clone = material.clone("clonedSample");
  // Scene.addMaterial delivers its native material notification asynchronously.
  await new Promise<void>(resolve => scene.onAfterRenderObservable.addOnce(() => resolve()));
  if (!clone?.pluginManager?.getPlugin("WaterDepth")) throw new Error("Cloned PBR material lost depth lighting");
  clone.dispose();
  const straddleAbove = await pixel(-2, true, "sun", true);
  const straddleBelow = await pixel(100, true, "sun", true);
  if (!(straddleBelow[0] < straddleAbove[0] / 2)) throw new Error(`Depth-straddling material failed: ${JSON.stringify({ straddleAbove, straddleBelow })}`);
  return { backend: describeBackend(engine).backend, results, straddleAbove, straddleBelow, clone: true, waterExcluded: !water.pluginManager?.getPlugin("WaterDepth") };
}

Object.assign(window, { waterDepthHarness: { check, scene, engine } });
document.querySelector("#status")!.textContent = `${describeBackend(engine).backend} — ready`;
