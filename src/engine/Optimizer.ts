import type { Scene } from "@babylonjs/core/scene";
import {
  SceneOptimizer, SceneOptimizerOptions, SceneOptimization, HardwareScalingOptimization, CustomOptimization,
  ShadowsOptimization, ParticlesOptimization, RenderTargetsOptimization,
} from "@babylonjs/core/Misc/sceneOptimizer";
import { settings } from "../core/Settings";

// The frame rate is sampled this often into a sliding window, and SceneOptimizer waits this long between
// measuring and stepping.
const CHECK_MS = 5000;
// Decisions use the average fps over the last minute, so a passing stutter or a quiet moment changes nothing.
const WINDOW_SAMPLES = 60000 / CHECK_MS;
// Hysteresis band around the target fps: detail is only lowered below 80% of the target and only raised
// above 120%, so swings inside the band leave the scene alone.
const DOWNGRADE_BELOW = 0.8;
const UPGRADE_ABOVE = 1.2;
const RETRY_MS = [30000, 600000];

// The post-process step: bloom and sharpening go, tone mapping and the player's MSAA choice stay. Babylon's stock
// PostProcessesOptimization switches every post-process off, tone mapping included, and the sky is drawn
// in linear light: without tone mapping it blows out to white while the ground stays the same.
function pipelineEffects(setEnabled: (enabled: boolean) => void): SceneOptimization {
  const step = new CustomOptimization();
  step.onGetDescription = () => "Turning bloom and sharpening on/off";
  step.onApply = (_scene, optimizer) => {
    const on = optimizer.isInImprovementMode;
    setEnabled(on);
    return true;
  };
  return step;
}

// A downgrade steps only if the fps is still below the band; an upgrade (improvement mode) only while it is
// still above it. SceneOptimizer re-checks that before applying its step.
function options(improve: boolean, setEffectsEnabled: (enabled: boolean) => void): SceneOptimizerOptions {
  const steps: SceneOptimization[][] = [
    [new HardwareScalingOptimization(0, improve ? 1 : 2)],
    [pipelineEffects(setEffectsEnabled)],
    [new ShadowsOptimization()],
    [new ParticlesOptimization(), new RenderTargetsOptimization()],
  ];
  if (improve) steps.reverse();
  const result = new SceneOptimizerOptions(settings.targetFps * (improve ? UPGRADE_ABOVE : DOWNGRADE_BELOW), CHECK_MS);
  steps.forEach((step, priority) => step.forEach(optimization => {
    optimization.priority = priority;
    result.addOptimization(optimization);
  }));
  return result;
}

// Samples the fps into a one-minute window. When the window's average leaves the band, SceneOptimizer applies
// one step (down, or back up in improvement mode) and the window starts over, so every further step is
// justified by a fresh minute measured with the new settings. Returns a function that restarts the cycle.
export function startOptimizer(scene: Scene, setEffectsEnabled: (enabled: boolean) => void): () => void {
  const engine = scene.getEngine();
  const samples: number[] = [];
  let running = false, retryMs = RETRY_MS[0], improveAt = 0;
  let effectsEnabled = true;

  const setEffects = (enabled: boolean) => { effectsEnabled = enabled; setEffectsEnabled(enabled); };
  const degraded = () => engine.getHardwareScalingLevel() > 1 || !effectsEnabled || !scene.shadowsEnabled
    || !scene.particlesEnabled || !scene.renderTargetsEnabled;

  const run = (improve: boolean) => {
    running = true;
    let stepped = false;
    const optimizer = new SceneOptimizer(scene, options(improve, setEffects), false, improve);
    const done = (restored: boolean) => {
      if (!running) return;
      running = false;
      samples.length = 0;
      optimizer.stop();
      queueMicrotask(() => optimizer.dispose());
      if (improve) retryMs = restored ? RETRY_MS[0] : Math.min(retryMs * 2, RETRY_MS[1]);
      improveAt = performance.now() + retryMs;
    };
    // One step per decision: stop once the first priority level has been applied.
    optimizer.onNewOptimizationAppliedObservable.add(() => {
      stepped = true;
      queueMicrotask(() => done(false));
    });
    optimizer.onSuccessObservable.add(() => done(false));
    optimizer.onFailureObservable.add(() => done(!stepped));
    optimizer.start();
  };

  scene.executeWhenReady(() => setInterval(() => {
    if (document.hidden) { samples.length = 0; return; }
    if (running) return;
    samples.push(engine.getFps());
    if (samples.length > WINDOW_SAMPLES) samples.shift();
    if (samples.length < WINDOW_SAMPLES) return;
    const average = samples.reduce((sum, fps) => sum + fps, 0) / samples.length;
    if (average < settings.targetFps * DOWNGRADE_BELOW) run(false);
    else if (average > settings.targetFps * UPGRADE_ABOVE && degraded() && performance.now() >= improveAt) run(true);
  }, CHECK_MS));

  return () => {
    samples.length = 0;
    retryMs = RETRY_MS[0];
    improveAt = 0;
  };
}
