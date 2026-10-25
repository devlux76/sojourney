import { SceneInstrumentation, type Scene } from "@babylonjs/core";
import type { Flora } from "../src/engine/flora";
import type { Environment } from "../src/engine/environment";

// Compare the production instance lists with/without depth culling at a fixed
// submerged view. Only the diagnostic override bypasses the water-radius input.
export async function verifyUnderwaterFlora(scene: Scene, flora: Flora, environment: Environment) {
  if (!scene.getMeshByName("waterVolume")?.isEnabled()) throw new Error("Enter water first");
  const engine = scene.getEngine();
  const state = flora as any;
  const radius = flora.waterRadius;
  if (!Number.isFinite(radius)) throw new Error("Water radius was not forwarded");
  const notify = scene.onBeforeRenderObservable.notifyObservers;
  const stream = state.stream;
  const dithering = environment.pipeline.imageProcessing.ditheringEnabled;
  const instrumentation = new SceneInstrumentation(scene);
  scene.onBeforeRenderObservable.notifyObservers = () => true;
  state.stream = () => {};
  environment.pipeline.imageProcessing.ditheringEnabled = false;
  const render = () => { engine.beginFrame(); scene.render(); engine.endFrame(); };
  const select = (value: number) => {
    flora.waterRadius = value;
    state.farAt = state.midAt = state.sortedAt = null;
    state.update();
  };
  const summary = () => ({
    instances: state.batches.filter(Boolean).reduce((n: number, batch: any) =>
      n + batch.far.count + batch.beyond.count + (batch.mid?.count ?? 0) +
      batch.levels.reduce((sum: number, draw: any) => sum + draw.count, 0), 0),
    drawCalls: instrumentation.drawCallsCounter.current,
    activeFlora: scene.getActiveMeshes().data.slice(0, scene.getActiveMeshes().length)
      .filter(mesh => state.batches.some((batch: any) => batch &&
        [batch.far, batch.beyond, batch.mid, ...batch.levels].some(draw => draw?.mesh === mesh)))
      .map(mesh => mesh.name),
  });
  const pixels = async () => {
    const buffer = await engine.readPixels(0, 0, engine.getRenderWidth(), engine.getRenderHeight());
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).slice();
  };
  try {
    // The boundary must be conservative on both sides, including cells that
    // cross the volume and the camera-travel margin. Zoom cannot change it.
    const eye = scene.activeCamera!.globalPosition;
    const top = eye.y + radius + 25, bottom = eye.y - radius - 25;
    const checks: Record<string, boolean> = {
      above: state.waterHides({ minY: top + 1, maxY: top + 2 }, eye),
      below: state.waterHides({ minY: bottom - 2, maxY: bottom - 1 }, eye),
      touching: !state.waterHides({ minY: top, maxY: top + 2 }, eye),
      intersecting: !state.waterHides({ minY: eye.y - 1, maxY: top + 2 }, eye),
      travelMargin: !state.waterHides({ minY: eye.y + radius + 1, maxY: top }, eye),
    };
    if (Object.values(checks).some(value => !value)) throw new Error("Water-height boundary failed");
    select(Infinity);
    for (let i = 0; i < 12; i++) { await new Promise(requestAnimationFrame); render(); }
    const before = await pixels(), baseline = summary();
    select(radius);
    for (let i = 0; i < 12; i++) { await new Promise(requestAnimationFrame); render(); }
    const after = await pixels(), culled = summary();
    let changedChannels = 0, maximumDifference = 0;
    for (let i = 0; i < before.length; i++) {
      const difference = Math.abs(before[i] - after[i]);
      if (difference) changedChannels++;
      maximumDifference = Math.max(maximumDifference, difference);
    }
    if (maximumDifference) throw new Error(`Depth culling changed pixels: ${maximumDifference} (${changedChannels} channels)`);
    // Infinite radius must rebuild both bands at rest, even without camera motion.
    select(Infinity); render();
    const restored = summary();
    if (restored.instances !== baseline.instances) throw new Error("Instance lists did not restore");
    return { eye: scene.activeCamera!.globalPosition.asArray(), radius, checks,
      changedChannels, maximumDifference, baseline, culled, restored };
  } finally {
    select(radius);
    state.stream = stream;
    scene.onBeforeRenderObservable.notifyObservers = notify;
    environment.pipeline.imageProcessing.ditheringEnabled = dithering;
    instrumentation.dispose();
  }
}
