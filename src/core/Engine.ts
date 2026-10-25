import { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";

export async function createEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
  const options = { stencil: false, antialias: true, powerPreference: "high-performance" as const };
  let engine: AbstractEngine | null = null;
  if (await WebGPUEngine.IsSupportedAsync) {
    try {
      engine = await WebGPUEngine.CreateAsync(canvas, { ...options, enableAllFeatures: true, setMaximumLimits: true });
    } catch (e) {
      console.warn("WebGPU unavailable, using WebGL 2:", e);
    }
  }
  engine ??= new Engine(canvas, false, options);
  window.addEventListener("resize", () => engine.resize());
  // When the graphics card is reset under the game (a hang, a driver crash), its picture goes blank and
  // does not come back, though the sound carries on. Babylon's WebGPU engine does not report this, so
  // the device itself is watched, and the page is loaded afresh.
  if (engine instanceof WebGPUEngine) void engine._device.lost.then(info => { if (info.reason !== "destroyed") reloadAfterGraphicsLoss(); });
  else canvas.addEventListener("webglcontextlost", reloadAfterGraphicsLoss);
  return engine;
}

// Not twice within this long, so a card that is lost again at once does not reload the page for ever.
const RELOAD_GAP_MS = 30000;
const RELOADED_KEY = "sojourney.reloadedAfterGraphicsLoss";

function reloadAfterGraphicsLoss() {
  const last = Number(sessionStorage.getItem(RELOADED_KEY) ?? 0);
  if (Date.now() - last < RELOAD_GAP_MS) return;
  sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
  location.reload();
}

export function describeBackend(engine: AbstractEngine): { gpu: string; backend: string } {
  if (engine instanceof WebGPUEngine) {
    const info = engine.getInfo();
    return { gpu: `${info.vendor} ${info.renderer} ${info.version}`, backend: "WebGPU" };
  }
  const gl = engine as Engine;
  return { gpu: gl.getGlInfo().renderer, backend: `WebGL ${gl.webGLVersion}` };
}
