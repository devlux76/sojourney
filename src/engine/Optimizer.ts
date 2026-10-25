import type { Scene } from "@babylonjs/core/scene";
import type { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import {
  SceneOptimizer, SceneOptimizerOptions, SceneOptimization, HardwareScalingOptimization, CustomOptimization,
  ShadowsOptimization, ParticlesOptimization, RenderTargetsOptimization,
} from "@babylonjs/core/Misc/sceneOptimizer";
import { settings } from "../core/Settings";
import { PIPELINE_SAMPLES } from "./environment";
import { MAX_HAZE, MOTION_TAU_SECONDS, STILL_MS, downgradeFloor, getHazeLevel, setHazeLevel, snapHaze, stillIdle } from "./optimizerHaze";

// The frame rate is sampled this often into a sliding window, and SceneOptimizer waits this long between
// measuring and stepping.
const CHECK_MS = 5000;
// Decisions use the average fps over the last ten seconds, so they follow the game quickly.
// The hysteresis band below still guards against flapping on a transient dip.
const WINDOW_SAMPLES = 10000 / CHECK_MS;
// Hysteresis band around the target fps: detail is only lowered below 80% of the target and only raised
// above 120%, so swings inside the band leave the scene alone.
const DOWNGRADE_BELOW = 0.8;
const UPGRADE_ABOVE = 1.2;
const RETRY_MS = [30000, 600000];

// The post-process step: bloom, sharpening and anti-aliasing go, tone mapping stays. Babylon's stock
// PostProcessesOptimization switches every post-process off, tone mapping included, and the sky is drawn
// in linear light: without tone mapping it blows out to white while the ground stays the same.
function pipelineEffects(pipeline: DefaultRenderingPipeline): SceneOptimization {
  const step = new CustomOptimization();
  step.onGetDescription = () => "Turning bloom, sharpening and anti-aliasing on/off";
  step.onApply = (_scene, optimizer) => {
    const on = optimizer.isInImprovementMode;
    pipeline.bloomEnabled = on;
    pipeline.sharpenEnabled = on;
    pipeline.samples = on ? PIPELINE_SAMPLES : 1;
    return true;
  };
  return step;
}

// The first lever: synthetic haze toward storm visibility, one rung per downgrade, so distant
// draws hide in real fog before anything else gives. It reports done only at clear (restored)
// or at storm levels (fully degraded); a maxed-out rung that changes nothing lets the run
// fall through to the next priority instead of stopping on the no-op.
const hazeStep = new CustomOptimization();
hazeStep.onGetDescription = () => "Thickening haze toward storm visibility";
hazeStep.onApply = (_scene, optimizer) => {
  const level = getHazeLevel();
  if (optimizer.isInImprovementMode) {
    if (level <= 0) return true;
    setHazeLevel(level - 1);
    return level - 1 === 0;
  }
  if (level >= MAX_HAZE) return true;
  setHazeLevel(level + 1);
  return level + 1 >= MAX_HAZE;
};

// A downgrade steps only if the fps is still below the band; an upgrade (improvement mode) only while it is
// still above it. SceneOptimizer re-checks that before applying its step. A still camera restoring
// beauty bypasses that headroom check (STILL_RESTORE_TARGET below): standing still wants the picture
// back even when the degraded settings are merely holding the target, where headroom never appears.
function options(improve: boolean, pipeline: DefaultRenderingPipeline, targetFps = settings.targetFps * (improve ? UPGRADE_ABOVE : DOWNGRADE_BELOW)): SceneOptimizerOptions {
  // Degrades take haze first, then the rest; restores clear the haze first too, so the view
  // comes back before anything else — beauty before pixels.
  const tail: SceneOptimization[][] = [
    [new HardwareScalingOptimization(0, improve ? 1 : 2)],
    [pipelineEffects(pipeline)],
    [new ShadowsOptimization()],
    [new ParticlesOptimization(), new RenderTargetsOptimization()],
  ];
  const steps = improve ? [[hazeStep], ...tail.slice().reverse()] : [[hazeStep], ...tail];
  const result = new SceneOptimizerOptions(targetFps, CHECK_MS);
  steps.forEach((step, priority) => step.forEach(optimization => {
    optimization.priority = priority;
    result.addOptimization(optimization);
  }));
  return result;
}

// Samples the fps into a ten-second window. When the window's average leaves the band, SceneOptimizer applies
// one step (down, or back up in improvement mode) and the window starts over, so every further step is
// justified by a fresh window measured with the new settings. While beautyHeld runs (the player aboard
// the tour boat lying at a stop, guide talking) everything is restored to full once and no decisions are taken;
// the optimizer resumes with a fresh window when she casts off. A still or zoomed camera holds beauty the
// same way (see stillIdle): standing still means immersion, so frame rate stops mattering. The settings toggle
// can stop tuning and restore full beauty; the returned function applies settings changes.
export function startOptimizer(scene: Scene, pipeline: DefaultRenderingPipeline, beautyHeld = () => false, beautyZoom = () => false): () => void {
  const engine = scene.getEngine();
  const samples: number[] = [];
  let running = false, retryMs = RETRY_MS[0], improveAt = 0;
  // Keep the native optimizer so switching off can cancel its pending check too.
  let activeOptimizer: SceneOptimizer | null = null;

  const degraded = () => getHazeLevel() > 0 || engine.getHardwareScalingLevel() > 1 || !pipeline.bloomEnabled || !scene.shadowsEnabled
    || !scene.particlesEnabled || !scene.renderTargetsEnabled;

  // A still camera restores one rung per decision with no headroom requirement: Babylon's improvement
  // mode only steps while the measured fps stays above its target, and degraded settings holding the
  // rate near the target never show that headroom — which is how sitting still left the haze up.
  // Target zero always passes unless the rate rounds to nothing; the retry backoff still paces the
  // walk back, so beauty returns slowly instead of all at once.
  const STILL_RESTORE_TARGET = 0;
  // Travel vs beauty from the camera's own speed, smoothed: standing still wants the picture
  // back, moving fast wants the frame rate. A teleport-length jump resets to still, so arrivals
  // land in beauty instead of tripping travel mode.
  let motion = 0;
  // When the smoothed speed last read as travel: several seconds below it shuts the optimizer
  // off, since a still player is immersing, not waiting on frames.
  let lastMoveMs = performance.now();
  const lastEye = new Vector3();
  let eyeSeen = false;
  scene.onBeforeRenderObservable.add(() => {
    const eye = scene.activeCamera?.globalPosition;
    const dt = engine.getDeltaTime() / 1000;
    if (!eye || !(dt > 0)) return;
    if (eyeSeen) {
      const jump = Vector3.Distance(eye, lastEye);
      if (jump > 50) motion = 0;
      else motion += (Math.min(jump / dt, 30) - motion) * (1 - Math.exp(-dt / MOTION_TAU_SECONDS));
      if (motion >= STILL_MS) lastMoveMs = performance.now();
    }
    lastEye.copyFrom(eye);
    eyeSeen = true;
  });

  const run = (improve: boolean, targetFps?: number) => {
    running = true;
    let stepped = false;
    // What the optimizer settings look like now: an optimization that applies without changing
    // any of this is a no-op (a rung already at its limit), so the run carries on to the next
    // priority instead of stopping. Without this every run restarts at level 0 and restores
    // nothing past it — which is how a cleared framerate left the haze up.
    const signature = () => [getHazeLevel(), engine.getHardwareScalingLevel(), pipeline.bloomEnabled,
      pipeline.sharpenEnabled, pipeline.samples, scene.shadowsEnabled, scene.particlesEnabled,
      scene.renderTargetsEnabled].join(",");
    const before = signature();
    const optimizer = new SceneOptimizer(scene, options(improve, pipeline, targetFps), false, improve);
    activeOptimizer = optimizer;
    const done = (restored: boolean) => {
      // A settings change may have cancelled this run before its queued callback.
      if (activeOptimizer !== optimizer) return;
      activeOptimizer = null;
      running = false;
      samples.length = 0;
      optimizer.stop();
      queueMicrotask(() => optimizer.dispose());
      if (improve) retryMs = restored ? RETRY_MS[0] : Math.min(retryMs * 2, RETRY_MS[1]);
      improveAt = performance.now() + retryMs;
    };
    // One step per decision: stop once a priority level has actually changed something. A level
    // already at its limit changes nothing, so it is not a step: the run falls through to the
    // next level, which is how harsher measures follow only once the haze is at storm levels —
    // and how restores get past no-op levels instead of stalling at them forever.
    optimizer.onNewOptimizationAppliedObservable.add(() => {
      if (!stepped && signature() === before) return;
      stepped = true;
      queueMicrotask(() => done(false));
    });
    optimizer.onSuccessObservable.add(() => done(false));
    optimizer.onFailureObservable.add(() => done(!stepped));
    optimizer.start();
  };

  // Full beauty at once: the stopped-boat moment can't wait for rung-by-rung restores.
  // The haze snaps (no ease-out); everything else is instant by nature.
  const restoreAll = () => {
    setHazeLevel(0);
    snapHaze();
    engine.setHardwareScalingLevel(1);
    pipeline.bloomEnabled = true;
    pipeline.sharpenEnabled = true;
    pipeline.samples = PIPELINE_SAMPLES;
    scene.shadowsEnabled = true;
    scene.particlesEnabled = true;
    scene.renderTargetsEnabled = true;
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  scene.executeWhenReady(() => { timer = setInterval(() => {
    if (settings.sceneOptimization === "off") { samples.length = 0; return; }
    if (document.hidden) { samples.length = 0; return; }
    if (running) return;
    // Beauty holds shut the optimizer off: the dwelling tour boat with the player aboard, the
    // binoculars, or several seconds without camera travel. Each restores full beauty once and
    // takes no decisions; motion resumes with a fresh window.
    if (beautyHeld() || beautyZoom() || stillIdle(performance.now(), lastMoveMs)) {
      if (degraded()) restoreAll();
      samples.length = 0;
      return;
    }
    samples.push(engine.getFps());
    if (samples.length > WINDOW_SAMPLES) samples.shift();
    if (samples.length < WINDOW_SAMPLES) return;
    const average = samples.reduce((sum, fps) => sum + fps, 0) / samples.length;
    // A fast camera degrades up at the target itself; a still one only below the band. And a
    // still camera with anything degraded restores beauty without waiting for headroom first:
    // the zero target steps past Babylon's improvement gate, which would otherwise stall where
    // degraded settings hold the rate near the target.
    if (average < downgradeFloor(settings.targetFps, motion)) run(false);
    else if (motion < STILL_MS && degraded() && performance.now() >= improveAt) run(true, STILL_RESTORE_TARGET);
    else if (average > settings.targetFps * UPGRADE_ABOVE && degraded() && performance.now() >= improveAt) run(true);
  }, CHECK_MS); });

  const retune = () => {
    activeOptimizer?.dispose();
    activeOptimizer = null;
    running = false;
    samples.length = 0;
    retryMs = RETRY_MS[0];
    improveAt = 0;
    // Off means full quality, rather than freezing a degraded frame indefinitely.
    if (settings.sceneOptimization === "off") restoreAll();
  };
  scene.onDisposeObservable.addOnce(() => {
    clearInterval(timer);
    activeOptimizer?.dispose();
  });
  retune();
  return retune;
}
