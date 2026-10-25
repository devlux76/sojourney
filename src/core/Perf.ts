import type { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

export async function startPerf(scene: Scene, engine: AbstractEngine): Promise<void> {
  const [{ SceneInstrumentation }, { EngineInstrumentation }] = await Promise.all([
    import("@babylonjs/core/Instrumentation/sceneInstrumentation"),
    import("@babylonjs/core/Instrumentation/engineInstrumentation"),
    import("@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery").catch(() => {}),
    import("@babylonjs/core/Engines/Extensions/engine.query").catch(() => {}),
    import("@babylonjs/core/Engines/WebGPU/Extensions/engine.query").catch(() => {}),
  ]);

  const si = new SceneInstrumentation(scene);
  si.captureActiveMeshesEvaluationTime = true;
  si.captureRenderTargetsRenderTime = true;
  si.captureParticlesRenderTime = true;
  si.captureAnimationsTime = true;
  si.captureRenderTime = true;
  si.captureFrameTime = true;
  si.captureInterFrameTime = true;

  const ei = new EngineInstrumentation(engine);
  let gpuTiming = true;
  try {
    ei.captureGPUFrameTime = true;
  } catch {
    gpuTiming = false;
  }
  ei.captureShaderCompilationTime = true;

  const pc = (get: () => { current: number; average: number; max: number }) => {
    try {
      const p = get();
      return { ms: +p.current.toFixed(2), avgMs: +p.average.toFixed(2), maxMs: +p.max.toFixed(2) };
    } catch {
      return null;
    }
  };

  Object.assign(window, {
    __perf: () => ({
      fps: +engine.getFps().toFixed(1),
      gpuTiming,
      activeMeshesEvaluation: pc(() => si.activeMeshesEvaluationTimeCounter),
      renderTargets: pc(() => si.renderTargetsRenderTimeCounter),
      particles: pc(() => si.particlesRenderTimeCounter),
      animations: pc(() => si.animationsTimeCounter),
      render: pc(() => si.renderTimeCounter),
      frame: pc(() => si.frameTimeCounter),
      interFrame: pc(() => si.interFrameTimeCounter),
      drawCalls: pc(() => si.drawCallsCounter),
      gpuFrame: gpuTiming ? pc(() => ei.gpuFrameTimeCounter) : null,
      shaderCompilation: pc(() => ei.shaderCompilationTimeCounter),
    }),
  });
}
