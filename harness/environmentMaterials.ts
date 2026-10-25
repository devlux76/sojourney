import { Engine, WebGPUEngine, Scene, FreeCamera, Vector3, Color4, DirectionalLight,
  Observable, DefaultRenderingPipeline, ImageProcessingConfiguration, EngineInstrumentation, type AbstractEngine } from "@babylonjs/core";
import { Clouds } from "../src/engine/environment/Clouds";
import { configureAgXComparison } from "../src/engine/environment/agxToneMapping";
import { WATER_Y } from "../src/engine/pack";
import type { SkyState } from "../src/engine/environment/sky";

// Asset-free shader/lighting probe. This does not stand in for full-game visual acceptance.
// Import this module in DevTools to call setFrame/setToneMapping on the frozen camera.
const canvas = document.querySelector("canvas")!;
const status = document.querySelector("pre")!;
window.addEventListener("unhandledrejection", event => { status.textContent = String(event.reason); });
const webGPU = new URLSearchParams(location.search).get("backend") !== "webgl";
export const engine: AbstractEngine = webGPU
  ? await WebGPUEngine.CreateAsync(canvas, { antialias: true, enableAllFeatures: true, setMaximumLimits: true })
  : new Engine(canvas, false, { antialias: true });
export const scene = new Scene(engine);
const camera = new FreeCamera("fixedEye", new Vector3(0, WATER_Y + 2, -300), scene);
camera.minZ = 0.1;
camera.maxZ = 20000;
camera.setTarget(new Vector3(0, WATER_Y + 800, 4000));
const sun = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
const moon = new DirectionalLight("moon", new Vector3(0, 1, 0), scene);
const onSky = new Observable<SkyState>();
const clouds = new Clouds(scene, camera, onSky, sun, moon);
export const pipeline = new DefaultRenderingPipeline("environmentProbe", true, scene, [camera]);
pipeline.imageProcessing.toneMappingEnabled = true;
pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
pipeline.imageProcessing.ditheringEnabled = true;

export function setToneMapping(agx: boolean, temperature = 6500): void {
  configureAgXComparison(agx, engine.isWebGPU);
  pipeline.imageProcessing.whiteBalanceEnabled = temperature !== 6500;
  pipeline.imageProcessing.temperature = temperature;
  // Rebuild with the configuration's complete defines, including exposure and dithering.
  pipeline.imageProcessing.toneMappingEnabled = false;
  pipeline.imageProcessing.toneMappingEnabled = true;
}

export function setFrame(period: "noon" | "lowSun" | "night", cover = 0.5, rain = 0): void {
  const altitude = period === "noon" ? 60 : period === "lowSun" ? 6 : -20;
  const angle = altitude * Math.PI / 180;
  const sunDir = new Vector3(0, Math.sin(angle), Math.cos(angle));
  const daylight = period === "night" ? 0 : 1;
  const exposure = period === "night" ? 30 : 1.5;
  sun.direction.copyFrom(sunDir).scaleInPlace(-1);
  sun.diffuse.set(1, period === "lowSun" ? 0.55 : 0.95, period === "lowSun" ? 0.22 : 0.85);
  sun.intensity = 4 * (1 - 0.5 * cover * cover) * daylight;
  moon.intensity = period === "night" ? 0.02 : 0;
  moon.diffuse.set(0.65, 0.78, 1);
  scene.ambientColor.set(daylight ? 0.12 : 0.0013, daylight ? 0.18 : 0.0016, daylight ? 0.28 : 0.002);
  scene.clearColor = daylight ? new Color4(0.08, 0.2, 0.5, 1) : new Color4(0.0005, 0.001, 0.002, 1);
  pipeline.imageProcessing.exposure = exposure;
  onSky.notifyObservers({
    date: new Date("2026-07-01T12:00:00Z"), sun: { alt: altitude, az: 0 },
    moon: { alt: -altitude, az: 180 }, sunDir, moonDir: sunDir.negate(), moonFraction: 1,
    celestial: new Float32Array(9), weather: { cloudCover: cover, rain, wind: 0, wetness: rain, storm: 0 },
    daylight, darkness: 1 - daylight, exposure, dt: 0,
  });
}

const render = async () => {
  await pipeline.imageProcessing.getEffect().whenCompiledAsync();
  await scene.whenReadyAsync();
  scene.render();
  await new Promise(requestAnimationFrame);
  scene.render();
};

// Timing is opt-in so opening the harness does not start a long benchmark.
export async function measureCloudCost(frames = 120): Promise<{ meanGpuMs: number | null; samples: number; width: number; height: number }> {
  const timing = new EngineInstrumentation(engine);
  timing.captureGPUFrameTime = true;
  const samples: number[] = [];
  let previousCount = timing.gpuFrameTimeCounter.count;
  for (let i = 0; i < frames + 20; i++) {
    await new Promise(requestAnimationFrame);
    const counter = timing.gpuFrameTimeCounter;
    if (i >= 20 && counter.count > previousCount && counter.current > 0) samples.push(counter.current / 1e6);
    previousCount = counter.count;
  }
  timing.captureGPUFrameTime = false;
  timing.dispose();
  return { meanGpuMs: samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null,
    samples: samples.length, width: engine.getRenderWidth(), height: engine.getRenderHeight() };
}

export const results: string[] = [];
export async function verify(): Promise<void> {
  // Real HDR framebuffer reads catch a broken hook, shader compilation and output corruption.
  // Neutral black/grey/white and saturated HDR probes exercise AgX log bounds and gamut mapping.
  clouds.mesh.setEnabled(false);
  pipeline.imageProcessing.exposure = 1;
  const pixels: number[][][] = [];
  for (const agx of [false, true]) {
    setToneMapping(agx);
    const mapped: number[][] = [];
    for (const rgb of [[0, 0, 0], [0.18, 0.18, 0.18], [1, 1, 1], [16, 2, 0.1], [0.02, 0.1, 4]]) {
      scene.clearColor = new Color4(rgb[0], rgb[1], rgb[2], 1);
      await render();
      const pixel = await engine.readPixels(Math.floor(engine.getRenderWidth() / 2), Math.floor(engine.getRenderHeight() / 2), 1, 1);
      const bytes = [...new Uint8Array(pixel.buffer, pixel.byteOffset, pixel.byteLength)].slice(0, 3);
      if (bytes.length !== 3 || bytes.some(value => !Number.isFinite(value))) throw new Error("Invalid framebuffer read");
      mapped.push(bytes);
    }
    if (mapped[0].some(value => value > 3) || mapped[1].some((value, i) => value <= mapped[0][i] || value >= mapped[2][i])) {
      throw new Error(`${agx ? "AgX" : "ACES"}: black/grey/white ordering failed: ${JSON.stringify(mapped)}`);
    }
    pixels.push(mapped);
    results.push(`${agx ? "AgX" : "ACES"} HDR probes: ${JSON.stringify(mapped)}`);
  }
  if (JSON.stringify(pixels[0]) === JSON.stringify(pixels[1])) throw new Error("AgX toggle did not change HDR output");
  for (const period of ["noon", "lowSun", "night"] as const) {
    for (const cover of [0.5, 1]) {
      setFrame(period, cover);
      for (const agx of [false, true]) {
        setToneMapping(agx, 6300);
        await render();
        if (!clouds.mesh.material!.isReady(clouds.mesh)) throw new Error("Cloud shader not ready");
      }
    }
  }
  results.push("Production clouds compile at noon/low sun/night, half/full cover, ACES/AgX, 6300 K white balance; dither enabled.");
  setFrame("lowSun");
  setToneMapping(false);
  status.textContent = `${engine.isWebGPU ? "WebGPU" : "WebGL2"}\n${results.join("\n")}`;
  engine.runRenderLoop(() => scene.render());
}
setFrame("noon");
await verify();
