import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Observable } from "@babylonjs/core/Misc/observable";
import { nativeShaderMaterial } from "../../core/nativeShader";
import { settings } from "../../core/Settings";
import type { SettingControl } from "../../core/SettingsPanel";
import { skyLayer } from "./NightSky";
import { SKY_RADIUS, type SkyState } from "./sky";

const MOON_DISTANCE = SKY_RADIUS * 0.96;
const REAL_HALF_SIZE = MOON_DISTANCE * Math.tan((0.26 * Math.PI) / 180);
const MOON_BRIGHTNESS = 1.3;
const QUAD_SCALE = 5;
const HALO = `vec3(0.85, 0.9, 1.0) * (0.16 * exp(-2.2 * max(d - 1.0, 0.0)) + 0.012 / (1.0 + (d - 1.0) * (d - 1.0)))`;

const GLSL_VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
uniform vec3 moonDir, right, up;
uniform float halfSize;
varying vec2 vCorner;
void main() {
  vCorner = position.xy;
  vec3 p = moonDir * ${MOON_DISTANCE.toFixed(1)} + (right * position.x + up * position.y) * halfSize;
  vec4 clip = worldViewProjection * vec4(p, 1.0);
  gl_Position = vec4(clip.xy, clip.w, clip.w);
}`;

const GLSL_FRAGMENT = `
precision highp float;
uniform vec3 moonDir, right, up, sunDir;
uniform float visibility, darkness;
uniform sampler2D moonMap;
varying vec2 vCorner;
void main() {
  vec2 disc = vCorner * ${QUAD_SCALE.toFixed(1)};
  float r2 = dot(disc, disc), d = sqrt(r2);
  float edge = 1.0 - smoothstep(0.9, 1.0, r2);
  float fade = 1.0 - smoothstep(0.6, 1.0, d / ${QUAD_SCALE.toFixed(1)});
  vec3 halo = ${HALO} * (1.0 - 0.75 * edge) * fade * darkness;
  vec3 colour = halo * visibility;
  if (r2 < 1.0) {
    float z = sqrt(1.0 - r2);
    vec3 normal = right * disc.x + up * disc.y - moonDir * z;
    float lit = smoothstep(-0.05, 0.1, dot(normal, sunDir));
    float lon = atan(disc.x, z), lat = asin(clamp(disc.y, -1.0, 1.0));
    vec3 albedo = texture2D(moonMap, vec2(0.5 + lon / 6.2831853, 0.5 + lat / 3.1415927)).rgb;
    colour += albedo * (lit * ${MOON_BRIGHTNESS.toFixed(2)} + 0.015) * edge * visibility;
  }
  gl_FragColor = vec4(colour, edge * darkness * visibility);
}`;

const WGSL_VERTEX = `
attribute position: vec3f;
uniform worldViewProjection: mat4x4f;
uniform moonDir: vec3f;
uniform right: vec3f;
uniform up: vec3f;
uniform halfSize: f32;
varying vCorner: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vCorner = vertexInputs.position.xy;
  let p = uniforms.moonDir * ${MOON_DISTANCE.toFixed(1)}
    + (uniforms.right * vertexInputs.position.x + uniforms.up * vertexInputs.position.y) * uniforms.halfSize;
  let clip = uniforms.worldViewProjection * vec4f(p, 1.0);
  vertexOutputs.position = vec4f(clip.xy, clip.w, clip.w);
}`;

const WGSL_FRAGMENT = `
uniform moonDir: vec3f;
uniform right: vec3f;
uniform up: vec3f;
uniform sunDir: vec3f;
uniform visibility: f32;
uniform darkness: f32;
var moonMapSampler: sampler;
var moonMap: texture_2d<f32>;
varying vCorner: vec2f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let disc = input.vCorner * ${QUAD_SCALE.toFixed(1)};
  let r2 = dot(disc, disc);
  let d = sqrt(r2);
  let edge = 1.0 - smoothstep(0.9, 1.0, r2);
  let fade = 1.0 - smoothstep(0.6, 1.0, d / ${QUAD_SCALE.toFixed(1)});
  let halo = ${HALO.replace("vec3(", "vec3f(")} * (1.0 - 0.75 * edge) * fade * uniforms.darkness;
  var colour = halo * uniforms.visibility;
  if (r2 < 1.0) {
    let z = sqrt(1.0 - r2);
    let lon = atan2(disc.x, z);
    let lat = asin(clamp(disc.y, -1.0, 1.0));
    let albedo = textureSample(moonMap, moonMapSampler, vec2f(0.5 + lon / 6.2831853, 0.5 + lat / 3.1415927)).rgb;
    let normal = uniforms.right * disc.x + uniforms.up * disc.y - uniforms.moonDir * z;
    let lit = smoothstep(-0.05, 0.1, dot(normal, uniforms.sunDir));
    colour += albedo * (lit * ${MOON_BRIGHTNESS.toFixed(2)} + 0.015) * edge * uniforms.visibility;
  }
  fragmentOutputs.color = vec4f(colour, edge * uniforms.darkness * uniforms.visibility);
}`;

export class Moon {
  readonly mesh: Mesh;

  constructor(scene: Scene, onSky: Observable<SkyState>) {
    const mesh = new Mesh("moon", scene);
    const data = new VertexData();
    data.positions = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
    data.indices = [0, 1, 2, 0, 2, 3];
    data.applyToMesh(mesh);
    const mat = nativeShaderMaterial("moonMat", scene, { vertex: GLSL_VERTEX, fragment: GLSL_FRAGMENT },
      { vertex: WGSL_VERTEX, fragment: WGSL_FRAGMENT }, {
      attributes: ["position"], samplers: ["moonMap"], needAlphaBlending: true,
      uniforms: ["worldViewProjection", "moonDir", "right", "up", "sunDir", "visibility", "darkness", "halfSize"],
    });
    mat.setTexture("moonMap", new Texture(`${import.meta.env.BASE_URL}sky/moon.jpg`, scene));
    this.mesh = skyLayer(mesh, mat, 2, Constants.ALPHA_PREMULTIPLIED);
    // The current WebGPU moon shader samples inside non-uniform fragment control flow, so keep its disc disabled until that shader is rebuilt.
    this.mesh.setEnabled(false);

    const right = new Vector3(), up = new Vector3();
    onSky.add((s: SkyState) => {
      const reference = Math.abs(s.moonDir.y) > 0.999 ? Vector3.Forward() : Vector3.Up();
      Vector3.CrossToRef(reference, s.moonDir, right);
      right.normalize();
      Vector3.CrossToRef(s.moonDir, right, up);
      mat.setVector3("moonDir", s.moonDir);
      mat.setVector3("right", right);
      mat.setVector3("up", up);
      mat.setVector3("sunDir", s.sunDir);
      mat.setFloat("visibility", (1 - s.weather.cloudCover) / s.exposure);
      mat.setFloat("darkness", s.darkness);
      mat.setFloat("halfSize", REAL_HALF_SIZE * settings.moonScale * QUAD_SCALE);
    });
  }

  settingControls(): SettingControl[] {
    return [{ key: "moonScale", label: "Moon size (× real)", min: 1, max: 12, step: 0.1 }];
  }
}
