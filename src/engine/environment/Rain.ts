import { Scene } from "@babylonjs/core/scene";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Observable } from "@babylonjs/core/Misc/observable";
import { nativeShaderMaterial } from "../../core/nativeShader";
import { createParticles, Particles } from "../../core/particles";
import { WATER_Y } from "../pack";
import { SKY_LAYER_GROUP, type SkyState } from "./sky";

const RAIN_BOX = 25;
const RAIN_TOP = [6, 16];
const FALL_SPEED = [6, 7.5];
const MAX_EMIT_RATE = 2500;
const RING_RADIUS = 40;
const RING_HEIGHT = 0.15;
const RING_CELL = 0.9;
const RING_SHARE = 0.45;
const DROP_BRIGHTNESS = 2.0;

const RING_GLSL_VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec2 vPos;
void main() {
  vec4 w = world * vec4(position, 1.0);
  vPos = w.xz;
  gl_Position = viewProjection * w;
}`;

const RING_GLSL_FRAGMENT = `
precision highp float;
uniform float time, rain, brightness;
uniform vec3 cameraPos;
varying vec2 vPos;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 cell = floor(vPos / ${RING_CELL.toFixed(2)});
  vec2 f = fract(vPos / ${RING_CELL.toFixed(2)}) - 0.5;
  float h = hash(cell);
  vec2 centre = (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.7;
  float phase = fract(time * (0.6 + 0.5 * hash(cell + 1.3)) + h);
  float width = 0.02 + 0.03 * phase;
  float ring = (1.0 - smoothstep(0.0, width, abs(length(f - centre) - phase * 0.4))) * (1.0 - phase) * (1.0 - phase);
  ring *= step(h, ${RING_SHARE.toFixed(2)} * rain);
  float fade = 1.0 - smoothstep(${(RING_RADIUS * 0.4).toFixed(1)}, ${RING_RADIUS.toFixed(1)}, length(vPos - cameraPos.xz));
  gl_FragColor = vec4(vec3(brightness), ring * fade * 0.5);
}`;

const RING_WGSL_VERTEX = `
attribute position: vec3f;
uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
varying vPos: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let w = uniforms.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vPos = w.xz;
  vertexOutputs.position = uniforms.viewProjection * w;
}`;

const RING_WGSL_FRAGMENT = `
uniform time: f32;
uniform rain: f32;
uniform brightness: f32;
uniform cameraPos: vec3f;
varying vPos: vec2f;
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let cell = floor(input.vPos / ${RING_CELL.toFixed(2)});
  let f = fract(input.vPos / ${RING_CELL.toFixed(2)}) - 0.5;
  let h = hash(cell);
  let centre = (vec2f(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.7;
  let phase = fract(uniforms.time * (0.6 + 0.5 * hash(cell + 1.3)) + h);
  let width = 0.02 + 0.03 * phase;
  var ring = (1.0 - smoothstep(0.0, width, abs(length(f - centre) - phase * 0.4))) * (1.0 - phase) * (1.0 - phase);
  ring *= step(h, ${RING_SHARE.toFixed(2)} * uniforms.rain);
  let fade = 1.0 - smoothstep(${(RING_RADIUS * 0.4).toFixed(1)}, ${RING_RADIUS.toFixed(1)}, length(input.vPos - uniforms.cameraPos.xz));
  fragmentOutputs.color = vec4f(vec3f(uniforms.brightness), ring * fade * 0.5);
}`;

export class Rain {
  constructor(scene: Scene, camera: Camera, onSky: Observable<SkyState>) {
    const drops = this.createDrops(scene);
    const emitter = drops.emitter as Vector3;
    const rings = this.createRings(scene);
    const ringMat = rings.material as ShaderMaterial;
    let time = 0;

    onSky.add((s: SkyState) => {
      time += s.dt;
      const cam = camera.globalPosition, rain = s.weather.rain;
      emitter.copyFrom(cam);
      drops.emitRate = rain * MAX_EMIT_RATE;
      drops.direction1.set(0.3 * s.weather.wind - 0.05, -1, -0.05);
      drops.direction2.set(0.3 * s.weather.wind + 0.05, -1, 0.05);
      const d = DROP_BRIGHTNESS * s.daylight;
      drops.color1.set(0.9 * d, 0.93 * d, 1.0 * d, 0.35);
      drops.color2.set(0.85 * d, 0.9 * d, 0.95 * d, 0.25);

      rings.position.set(cam.x, WATER_Y + RING_HEIGHT, cam.z);
      rings.setEnabled(rain > 0.01);
      ringMat.setFloat("time", time);
      ringMat.setFloat("rain", rain);
      ringMat.setFloat("brightness", 0.4 * s.daylight);
      ringMat.setVector3("cameraPos", cam);
    });
  }

  private createDrops(scene: Scene): Particles {
    const streak = new DynamicTexture("rainStreak", { width: 4, height: 64 }, scene, false);
    const ctx = streak.getContext();
    const gradient = ctx.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(1, "rgba(255,255,255,1)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 64);
    streak.update();
    streak.hasAlpha = true;

    const drops = createParticles("rain", 6000, scene);
    drops.particleTexture = streak;
    drops.emitter = new Vector3();
    drops.minEmitBox = new Vector3(-RAIN_BOX, RAIN_TOP[0], -RAIN_BOX);
    drops.maxEmitBox = new Vector3(RAIN_BOX, RAIN_TOP[1], RAIN_BOX);
    drops.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    drops.minSize = drops.maxSize = 1;
    drops.minScaleX = 0.01;
    drops.maxScaleX = 0.015;
    drops.minScaleY = 0.4;
    drops.maxScaleY = 0.7;
    drops.minEmitPower = FALL_SPEED[0];
    drops.maxEmitPower = FALL_SPEED[1];
    drops.minLifeTime = 2.4;
    drops.maxLifeTime = 3.2;
    drops.colorDead = new Color4(0, 0, 0, 0);
    drops.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    drops.emitRate = 0;
    drops.renderingGroupId = SKY_LAYER_GROUP;
    drops.start();
    return drops;
  }

  private createRings(scene: Scene): Mesh {
    const rings = MeshBuilder.CreateGround("rainRings", { width: 2 * RING_RADIUS, height: 2 * RING_RADIUS }, scene);
    const mat = nativeShaderMaterial("rainRingsMat", scene, { vertex: RING_GLSL_VERTEX, fragment: RING_GLSL_FRAGMENT },
      { vertex: RING_WGSL_VERTEX, fragment: RING_WGSL_FRAGMENT }, {
      attributes: ["position"], uniforms: ["world", "viewProjection", "time", "rain", "brightness", "cameraPos"],
      needAlphaBlending: true,
    });
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.disableDepthWrite = true;
    rings.material = mat;
    rings.isPickable = false;
    rings.alphaIndex = 10;
    rings.renderingGroupId = SKY_LAYER_GROUP;
    rings.setEnabled(false);
    return rings;
  }
}
