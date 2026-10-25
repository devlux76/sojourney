import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Horizontal } from "../../sky/Astronomy";
import type { WeatherParams } from "../../sky/Weather";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

// Only distant sky geometry belongs here. Local rain and lightning can be
// inside the water volume and must retain their own visibility rules.
export const distantSkyLayers = new WeakSet<AbstractMesh>();

export const SKY_RADIUS = 19000;
export const FAR_PLANE = 20000;
export const SKY_LAYER_GROUP = 1;

export interface SkyState {
  date: Date;
  sun: Horizontal;
  moon: Horizontal;
  sunDir: Vector3;
  moonDir: Vector3;
  moonFraction: number;
  celestial: Float32Array;
  weather: WeatherParams;
  daylight: number;
  darkness: number;
  exposure: number;
  dt: number;
}

export function smoothstep(a: number, b: number, t: number) {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}
