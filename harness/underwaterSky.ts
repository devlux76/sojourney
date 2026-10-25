import { SceneInstrumentation, type Scene } from "@babylonjs/core";
import type { Environment } from "../src/engine/environment";
import { distantSkyLayers } from "../src/engine/environment/sky";

// Run in the world harness after stopping its render loop and entering water.
// Freeze before-render simulation during matched draws, so waves, caustics,
// weather and camera movement cannot masquerade as a visibility difference.
export async function verifyUnderwaterSky(scene: Scene, environment: Environment) {
  if (!scene.getMeshByName("waterVolume")?.isEnabled()) throw new Error("Enter water first");
  const engine = scene.getEngine();
  const notify = scene.onBeforeRenderObservable.notifyObservers;
  const dithering = environment.pipeline.imageProcessing.ditheringEnabled;
  const instrumentation = new SceneInstrumentation(scene);
  // startPerf already owns GPU capture in the world harness. Reuse its engine
  // counter rather than disabling that shared capture when this probe finishes.
  const gpu = engine.getGPUFrameTimeCounter();
  scene.onBeforeRenderObservable.notifyObservers = () => true;
  environment.pipeline.imageProcessing.ditheringEnabled = false;
  const render = () => { engine.beginFrame(); scene.render(); engine.endFrame(); };
  const pixels = async () => {
    const view = await engine.readPixels(0, 0, engine.getRenderWidth(), engine.getRenderHeight());
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
  };
  const activeSky = () => scene.getActiveMeshes().data.slice(0, scene.getActiveMeshes().length)
    .filter(mesh => distantSkyLayers.has(mesh)).map(mesh => mesh.name);
  const measure = async (visible: boolean) => {
    environment.setSkyVisible(visible);
    // Warm shaders and drain delayed GPU query results before sampling.
    for (let i = 0; i < 12; i++) {
      await new Promise(requestAnimationFrame); render();
    }
    const times: number[] = [], draws: number[] = [];
    let count = gpu.count;
    for (let i = 0; i < 36; i++) {
      await new Promise(requestAnimationFrame); render();
      draws.push(instrumentation.drawCallsCounter.current);
      if (gpu.count > count) {
        times.push(gpu.current / 1e6);
        count = gpu.count;
      }
    }
    const median = (values: number[]) => values.length ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;
    return { visible, gpuMedianMs: median(times), gpuSamples: times.length,
      drawCalls: median(draws), activeSky: activeSky() };
  };
  try {
    environment.setSkyVisible(true);
    // A fresh harness may still be compiling the nondithered image-processing
    // effect. Yield while warming it before comparing framebuffer contents.
    for (let i = 0; i < 12; i++) {
      await new Promise(requestAnimationFrame); render();
    }
    const before = await pixels(), baselineSky = activeSky();
    environment.setSkyVisible(false); render();
    const after = await pixels();
    let changedChannels = 0, maximumDifference = 0;
    for (let i = 0; i < before.length; i++) {
      const difference = Math.abs(before[i] - after[i]);
      if (difference) changedChannels++;
      maximumDifference = Math.max(maximumDifference, difference);
    }
    if (maximumDifference) throw new Error(`Hidden sky changed pixels: ${maximumDifference}`);
    if (activeSky().length) throw new Error("Distant sky still submitted underwater");
    // Alternate the order twice so a warmed or drifting GPU is visible in the evidence.
    const measurements = [];
    for (const visible of [true, false, false, true]) measurements.push(await measure(visible));
    return { changedChannels, maximumDifference, baselineSky, measurements };
  } finally {
    environment.setSkyVisible(false);
    scene.onBeforeRenderObservable.notifyObservers = notify;
    environment.pipeline.imageProcessing.ditheringEnabled = dithering;
    instrumentation.dispose();
  }
}
