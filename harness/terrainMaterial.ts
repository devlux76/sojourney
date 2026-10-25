import * as B from "@babylonjs/core";
import "@babylonjs/loaders";
import "@babylonjs/addons";
import "@babylonjs/materials";
import { groundMaterial } from "../src/engine/ground";
import { loadLakeMask } from "../src/engine/lake";
import type { GroundManifest } from "../src/engine/pack";
import { createEnvironment } from "../src/engine/environment";
import biome from "../src/biomes/crater-lake";
import { settings } from "../src/core/Settings";

B.RegisterMathVector();
B.RegisterMathColor();
const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const status = document.querySelector<HTMLElement>("#status")!;
window.addEventListener("unhandledrejection", event => {
  status.textContent = `Authoring check failed: ${String(event.reason)}`;
});
// Backend selection and material A/B exist only in this authoring harness. The
// game's material reads the pack's authored data and has no relief quality switch.
const gpu = new URLSearchParams(location.search).get("backend") === "webgpu";
const engine = gpu ? new B.WebGPUEngine(canvas, { enableAllFeatures: true, setMaximumLimits: true })
  : new B.Engine(canvas, true, { preserveDrawingBuffer: true });
if (engine instanceof B.WebGPUEngine) await engine.initAsync();
const scene = new B.Scene(engine);
const boatStop = biome.places.find(place => place.name === "Llao Rock")!;
const camera = new B.FreeCamera("Llao Rock boat comparison", B.Vector3.FromArray(boatStop.position), scene);
camera.setTarget(new B.Vector3(935, 310, 3800));
camera.minZ = 0.1;
camera.attachControl(canvas, true);
settings.weatherOverride = 0;
const environment = createEnvironment(scene, camera, biome);
Object.assign(window, { terrainLoad: { scene, engine, environment } });
environment.clock.hours = 11.5;
environment.isPaused = () => true;
const manifest: GroundManifest = await (await fetch("packs/crater-lake/ground/ground.json")).json();
const mask = await loadLakeMask(scene, manifest);
status.textContent = "Loading terrain textures…";
const current = await groundMaterial(scene, manifest, mask);
// Construct the pre-relief material from the same pack, lights and textures. A/B
// swaps only material references, so geometry and camera stay identical.
const baselineManifest = structuredClone(manifest);
delete baselineManifest.material.relief;
const baseline = await groundMaterial(scene, baselineManifest, mask);
status.textContent = "Loading terrain geometry…";
const containers = await Promise.all(manifest.far.map(url => B.LoadAssetContainerAsync(url, scene)));
const meshes: B.AbstractMesh[] = [];
for (const container of containers) {
  container.addAllToScene();
  for (const mesh of container.meshes) {
    if (mesh instanceof B.Mesh && mesh.getTotalVertices()) {
      mesh.material = current.material;
      // Same fixed LOD for both comparisons; streaming is covered in the game.
      mesh.setEnabled(mesh.name.endsWith("LOD2"));
      meshes.push(mesh);
    }
  }
}
environment.onSky.add(s => {
  current.surface.wetness = baseline.surface.wetness = s.weather.wetness;
});
function compare(relief: boolean) {
  for (const mesh of meshes) mesh.material = relief ? current.material : baseline.material;
  status.textContent = `${gpu ? "WebGPU" : "WebGL"}: ${relief ? "NME relief" : "baseline"} at Llao Rock, 11:30`;
}
compare(true);
Object.assign(window, { terrainCompare: { engine, scene, camera, current, baseline, meshes, compare } });
engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());
