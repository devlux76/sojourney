import { Scene } from "@babylonjs/core/scene";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { Observable } from "@babylonjs/core/Misc/observable";
import { Constants } from "@babylonjs/core/Engines/constants";
import { nativeShaderMaterial } from "../../core/nativeShader";
import { WATER_Y } from "../pack";
import { skyLayer } from "./NightSky";
import { SKY_RADIUS, type SkyState } from "./sky";
import { updateCloudColors } from "./cloudLighting";

const CLOUD_HEIGHT = 800;
const CLOUD_EXTENT = SKY_RADIUS;
const CLOUD_SCALE = 2500;
const DRIFT_CALM = 2;
const DRIFT_WINDY = 12;
const SUN_LIT = 0.35;
const AMBIENT_LIT = 1.5;
const RAIN_DARKEN = 0.2;
// Under a closed sky the sky light is the clouds' own, and brighter than the blue sky's: without this the
// whole deck is a flat white. The thick parts darken most, which gives the overcast its texture.
const OVERCAST_DARKEN_LIT = 0.3;
const OVERCAST_DARKEN_SHADE = 0.55;

const GLSL_VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vWorld;
void main() {
  vWorld = (world * vec4(position, 1.0)).xyz;
  gl_Position = viewProjection * vec4(vWorld, 1.0);
}`;

const GLSL_FRAGMENT = `
precision highp float;
uniform vec3 cameraPos;
uniform vec2 offset;
uniform float cover, rain;
uniform vec3 litColour, shadeColour, sunDir, sunColour;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Replace subpixel octaves with their mean, preserving cover as detail fades at the horizon.
float fbm(vec2 p, float footprint) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * mix(0.5, noise(p), 1.0 - smoothstep(0.25, 0.75, footprint));
    p = p * 2.03 + 17.0; footprint *= 2.03; a *= 0.5;
  }
  return v;
}
void main() {
  float dist = length(vWorld.xz - cameraPos.xz);
  vec2 p = (vWorld.xz + offset) / ${CLOUD_SCALE.toFixed(1)};
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  float n = fbm(p, footprint);
  float t = mix(0.75, 0.05, cover);
  float width = max(0.1, fwidth(n));
  float closed = smoothstep(0.9, 1.0, cover);
  float density = max(smoothstep(t + 0.1 - width, t + 0.1 + width, n), closed);
  // Four samples across an assumed 200 m deck estimate the sunward optical depth.
  vec2 sunStep = sunDir.xz * (0.08 / max(sunDir.y, 0.12));
  float opticalDepth = 0.0;
  // Empty pixels and nights have no direct sunlight to attenuate.
  if (density > 0.001 && dot(sunColour, sunColour) > 0.0) {
    for (int i = 1; i <= 4; i++) {
      float ahead = fbm(p + sunStep * (float(i) / 4.0), footprint);
      opticalDepth += max(smoothstep(t, t + 0.2, ahead), closed) * 0.25;
    }
  }
  float transmittance = exp(-1.5 * opticalDepth / max(sunDir.y, 0.2));
  float shade = clamp(smoothstep(t, t + 0.45, n) * 0.7 + rain * 0.4, 0.0, 1.0);
  vec3 colour = mix(litColour, shadeColour, shade) - sunColour * (1.0 - shade) * (1.0 - transmittance);
  // Forward scattering lights thin edges only when the sun is above the horizon behind them.
  float forward = pow(max(dot(normalize(vWorld - cameraPos), sunDir), 0.0), 12.0);
  colour += sunColour * forward * (1.0 - density) * transmittance * 2.0;
  float edge = 1.0 - smoothstep(${(CLOUD_EXTENT * 0.4).toFixed(1)}, ${CLOUD_EXTENT.toFixed(1)}, dist);
  gl_FragColor = vec4(colour, density * edge);
}`;

const WGSL_VERTEX = `
attribute position: vec3f;
uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
varying vWorld: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vWorld = (uniforms.world * vec4f(vertexInputs.position, 1.0)).xyz;
  vertexOutputs.position = uniforms.viewProjection * vec4f(vertexOutputs.vWorld, 1.0);
}`;

const WGSL_FRAGMENT = `
uniform cameraPos: vec3f;
uniform offset: vec2f;
uniform cover: f32;
uniform rain: f32;
uniform litColour: vec3f;
uniform shadeColour: vec3f;
uniform sunDir: vec3f;
uniform sunColour: vec3f;
varying vWorld: vec3f;
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn fbm(start: vec2f, pixelFootprint: f32) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var p = start;
  var footprint = pixelFootprint;
  for (var i = 0; i < 5; i++) {
    v += a * mix(0.5, noise(p), 1.0 - smoothstep(0.25, 0.75, footprint));
    p = p * 2.03 + 17.0; footprint *= 2.03; a *= 0.5;
  }
  return v;
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let dist = length(input.vWorld.xz - uniforms.cameraPos.xz);
  // Derivatives stay in uniform fragment flow, outside the density-probe loop.
  let p = (input.vWorld.xz + uniforms.offset) / ${CLOUD_SCALE.toFixed(1)};
  let footprint = max(length(dpdx(p)), length(dpdy(p)));
  let n = fbm(p, footprint);
  let t = mix(0.75, 0.05, uniforms.cover);
  let width = max(0.1, fwidth(n));
  let closed = smoothstep(0.9, 1.0, uniforms.cover);
  let density = max(smoothstep(t + 0.1 - width, t + 0.1 + width, n), closed);
  let sunStep = uniforms.sunDir.xz * (0.08 / max(uniforms.sunDir.y, 0.12));
  var opticalDepth = 0.0;
  if (density > 0.001 && dot(uniforms.sunColour, uniforms.sunColour) > 0.0) {
    for (var i = 1; i <= 4; i++) {
      let ahead = fbm(p + sunStep * (f32(i) / 4.0), footprint);
      opticalDepth += max(smoothstep(t, t + 0.2, ahead), closed) * 0.25;
    }
  }
  let transmittance = exp(-1.5 * opticalDepth / max(uniforms.sunDir.y, 0.2));
  let shade = clamp(smoothstep(t, t + 0.45, n) * 0.7 + uniforms.rain * 0.4, 0.0, 1.0);
  var colour = mix(uniforms.litColour, uniforms.shadeColour, shade)
    - uniforms.sunColour * (1.0 - shade) * (1.0 - transmittance);
  let forward = pow(max(dot(normalize(input.vWorld - uniforms.cameraPos), uniforms.sunDir), 0.0), 12.0);
  colour += uniforms.sunColour * forward * (1.0 - density) * transmittance * 2.0;
  let edge = 1.0 - smoothstep(${(CLOUD_EXTENT * 0.4).toFixed(1)}, ${CLOUD_EXTENT.toFixed(1)}, dist);
  fragmentOutputs.color = vec4f(colour, density * edge);
}`;

export class Clouds {
  readonly mesh: Mesh;

  constructor(scene: Scene, camera: Camera, onSky: Observable<SkyState>, sun: DirectionalLight, moon: DirectionalLight) {
    const mesh = MeshBuilder.CreateGround("clouds", { width: 2 * CLOUD_EXTENT, height: 2 * CLOUD_EXTENT }, scene);
    const mat = nativeShaderMaterial("cloudsMat", scene, { vertex: GLSL_VERTEX, fragment: GLSL_FRAGMENT },
      { vertex: WGSL_VERTEX, fragment: WGSL_FRAGMENT }, {
      attributes: ["position"], needAlphaBlending: true,
      uniforms: ["world", "viewProjection", "cameraPos", "offset", "cover", "rain", "litColour", "shadeColour", "sunDir", "sunColour"],
    });
    this.mesh = skyLayer(mesh, mat, 3, Constants.ALPHA_COMBINE);
    mesh.infiniteDistance = false;

    const offset = new Vector2();
    const litColour = new Color3(), shadeColour = new Color3(), ambient = new Color3(), contribution = new Color3();
    const sunColour = new Color3();
    onSky.add((s: SkyState) => {
      const cam = camera.globalPosition;
      mesh.position.set(cam.x, WATER_Y + CLOUD_HEIGHT, cam.z);
      offset.x += s.dt * (DRIFT_CALM + (DRIFT_WINDY - DRIFT_CALM) * s.weather.wind);
      mesh.setEnabled(s.weather.cloudCover > 0.01);
      mat.setVector3("cameraPos", cam);
      mat.setVector2("offset", offset);
      mat.setFloat("cover", s.weather.cloudCover);
      mat.setFloat("rain", s.weather.rain);
      const overcast = s.weather.cloudCover * s.weather.cloudCover;
      updateCloudColors(scene.ambientColor, sun.diffuse, sun.intensity, moon.diffuse, moon.intensity,
        s.weather.rain, overcast, AMBIENT_LIT, RAIN_DARKEN, SUN_LIT,
        OVERCAST_DARKEN_LIT, OVERCAST_DARKEN_SHADE, litColour, shadeColour, ambient, contribution);
      mat.setColor3("litColour", litColour);
      mat.setColor3("shadeColour", shadeColour);
      mat.setVector3("sunDir", s.sunDir);
      // The direct sun is disabled below the horizon; lunar/ambient cloud light remains.
      sun.diffuse.scaleToRef(SUN_LIT * sun.intensity * s.daylight, sunColour);
      mat.setColor3("sunColour", sunColour);
    });
  }
}
