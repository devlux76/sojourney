import { Scene } from "@babylonjs/core/scene";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { GPUParticleSystem } from "@babylonjs/core/Particles/gpuParticleSystem";
import "@babylonjs/core/Particles/computeShaderParticleSystem";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader";

export type Particles = ParticleSystem | GPUParticleSystem;

export function createParticles(name: string, capacity: number, scene: Scene): Particles {
  if (!scene.getEngine().isWebGPU) return new ParticleSystem(name, capacity, scene);
  const gpu = new GPUParticleSystem(name, { capacity }, scene);
  gpu.emitRateControl = true;
  return gpu;
}
