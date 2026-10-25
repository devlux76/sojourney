import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Observable } from "@babylonjs/core/Misc/observable";
import { nativeShaderMaterial } from "../../core/nativeShader";
import { equatorialToVector } from "../../sky/Astronomy";
import { starBrightness, starColour } from "../../sky/stars";
import { SKY_RADIUS, SKY_LAYER_GROUP, type SkyState } from "./sky";

const MILKY_WAY_RADIUS = SKY_RADIUS * 0.98;
const STAR_RADIUS = SKY_RADIUS * 0.97;
const MILKY_WAY_BRIGHTNESS = 1.0;
const MILKY_WAY_BLACK = 0.16;
const MOON_WASHOUT_MILKY_WAY = 0.85;
const MOON_WASHOUT_STARS = 0.5;
const MILKY_WAY_SEGMENTS_RA = 96;
const MILKY_WAY_SEGMENTS_DEC = 48;

const STAR_VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 corner;
attribute vec4 color;
uniform mat4 worldViewProjection;
uniform mat3 celestial;
uniform float visibility;
uniform float time;
uniform vec2 screenSize;
varying vec4 vColor;
varying vec2 vCorner;
void main() {
  vec4 clip = worldViewProjection * vec4(celestial * position, 1.0);
  float size = clamp(2.0 + 3.5 * color.a, 2.0, 8.0);
  clip.xy += corner * size / screenSize * clip.w;
  gl_Position = vec4(clip.xy, clip.w, clip.w);
  float twinkle = 0.85 + 0.15 * sin(time * 3.0 + position.x * 0.013 + position.y * 0.021);
  vColor = vec4(color.rgb, min(pow(color.a, 0.5), 1.0) * visibility * twinkle);
  vCorner = corner;
}`;

const STAR_FRAGMENT = `
precision highp float;
varying vec4 vColor;
varying vec2 vCorner;
void main() {
  float disc = sqrt(max(0.0, 1.0 - dot(vCorner, vCorner)));
  gl_FragColor = vec4(vColor.rgb, vColor.a * disc);
}`;

const MILKY_WAY_VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
uniform mat3 celestial;
varying vec2 vUV;
void main() {
  vUV = uv;
  vec4 clip = worldViewProjection * vec4(celestial * position, 1.0);
  gl_Position = vec4(clip.xy, clip.w, clip.w);
}`;

const MILKY_WAY_FRAGMENT = `
precision highp float;
uniform sampler2D milkyWay;
uniform float visibility;
varying vec2 vUV;
void main() {
  float dec = (vUV.y - 0.5) * 3.1415927;
  float bias = clamp(log2(1.0 / max(cos(dec), 0.01)), 0.0, 6.0);
  vec3 c = max(texture2D(milkyWay, vUV, bias).rgb - ${MILKY_WAY_BLACK.toFixed(2)}, 0.0) / ${(1 - MILKY_WAY_BLACK).toFixed(2)};
  gl_FragColor = vec4(c * ${MILKY_WAY_BRIGHTNESS.toFixed(2)} * visibility, 1.0);
}`;

const STAR_WGSL_VERTEX = `
attribute position: vec3f;
attribute corner: vec2f;
attribute color: vec4f;
uniform worldViewProjection: mat4x4f;
uniform celestial: mat3x3f;
uniform visibility: f32;
uniform time: f32;
uniform screenSize: vec2f;
varying vColor: vec4f;
varying vCorner: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let p = vertexInputs.position;
  let clip = uniforms.worldViewProjection * vec4f(uniforms.celestial * p, 1.0);
  let size = clamp(2.0 + 3.5 * vertexInputs.color.a, 2.0, 8.0);
  vertexOutputs.position = vec4f(clip.xy + vertexInputs.corner * size / uniforms.screenSize * clip.w, clip.w, clip.w);
  let twinkle = 0.85 + 0.15 * sin(uniforms.time * 3.0 + p.x * 0.013 + p.y * 0.021);
  vertexOutputs.vColor = vec4f(vertexInputs.color.rgb, min(pow(vertexInputs.color.a, 0.5), 1.0) * uniforms.visibility * twinkle);
  vertexOutputs.vCorner = vertexInputs.corner;
}`;

const STAR_WGSL_FRAGMENT = `
varying vColor: vec4f;
varying vCorner: vec2f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let disc = sqrt(max(0.0, 1.0 - dot(input.vCorner, input.vCorner)));
  fragmentOutputs.color = vec4f(input.vColor.rgb, input.vColor.a * disc);
}`;

const MILKY_WAY_WGSL_VERTEX = `
attribute position: vec3f;
attribute uv: vec2f;
uniform worldViewProjection: mat4x4f;
uniform celestial: mat3x3f;
varying vUV: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vUV = vertexInputs.uv;
  let clip = uniforms.worldViewProjection * vec4f(uniforms.celestial * vertexInputs.position, 1.0);
  vertexOutputs.position = vec4f(clip.xy, clip.w, clip.w);
}`;

const MILKY_WAY_WGSL_FRAGMENT = `
uniform visibility: f32;
var milkyWaySampler: sampler;
var milkyWay: texture_2d<f32>;
varying vUV: vec2f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let dec = (input.vUV.y - 0.5) * 3.1415927;
  let bias = clamp(log2(1.0 / max(cos(dec), 0.01)), 0.0, 6.0);
  let c = max(textureSampleBias(milkyWay, milkyWaySampler, input.vUV, bias).rgb - ${MILKY_WAY_BLACK.toFixed(2)}, vec3f(0.0)) / ${(1 - MILKY_WAY_BLACK).toFixed(2)};
  fragmentOutputs.color = vec4f(c * ${MILKY_WAY_BRIGHTNESS.toFixed(2)} * uniforms.visibility, 1.0);
}`;

export class NightSky {
  private constructor(readonly meshes: Mesh[]) {}

  static async create(scene: Scene, onSky: Observable<SkyState>): Promise<NightSky> {
    const catalogue = new Float32Array(await (await fetch(`${import.meta.env.BASE_URL}sky/stars.bin`)).arrayBuffer());
    const stars = starMesh(scene, catalogue);
    const milkyWay = milkyWayMesh(scene);
    const starMat = stars.material as ShaderMaterial, milkyMat = milkyWay.material as ShaderMaterial;
    let time = 0;
    const engine = scene.getEngine(), screenSize = new Vector2();
    onSky.add((s: SkyState) => {
      time += s.dt;
      const visibility = s.darkness * (1 - s.weather.cloudCover) / s.exposure;
      const moonlight = s.moonFraction * Math.min(1, Math.max(0, s.moon.alt / 10));
      stars.setEnabled(visibility > 0.0001);
      milkyWay.setEnabled(visibility > 0.0001);
      for (const mat of [starMat, milkyMat]) mat.setMatrix3x3("celestial", s.celestial);
      starMat.setFloat("visibility", visibility * (1 - MOON_WASHOUT_STARS * moonlight));
      milkyMat.setFloat("visibility", visibility * (1 - MOON_WASHOUT_MILKY_WAY * moonlight));
      starMat.setFloat("time", time);
      starMat.setVector2("screenSize", screenSize.set(engine.getRenderWidth(), engine.getRenderHeight()));
    });
    return new NightSky([milkyWay, stars]);
  }
}

function starMesh(scene: Scene, catalogue: Float32Array): Mesh {
  const count = catalogue.length / 4;
  const positions = new Float32Array(count * 12), corners = new Float32Array(count * 8);
  const colors = new Float32Array(count * 16), indices = new Uint32Array(count * 6);
  const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];
  for (let i = 0; i < count; i++) {
    const [ra, dec, vmag, bv] = catalogue.subarray(i * 4, i * 4 + 4);
    const v = equatorialToVector({ ra, dec });
    const colour = [...starColour(bv), starBrightness(vmag)];
    for (let k = 0; k < 4; k++) {
      positions.set([v.x * STAR_RADIUS, v.y * STAR_RADIUS, v.z * STAR_RADIUS], (i * 4 + k) * 3);
      colors.set(colour, (i * 4 + k) * 4);
    }
    corners.set(CORNERS, i * 8);
    indices.set([0, 1, 2, 0, 2, 3].map(j => i * 4 + j), i * 6);
  }
  const mesh = new Mesh("stars", scene);
  const data = new VertexData();
  data.positions = positions;
  data.colors = colors;
  data.indices = indices;
  data.applyToMesh(mesh);
  mesh.setVerticesData("corner", corners, false, 2);

  const mat = nativeShaderMaterial("starsMat", scene, { vertex: STAR_VERTEX, fragment: STAR_FRAGMENT },
    { vertex: STAR_WGSL_VERTEX, fragment: STAR_WGSL_FRAGMENT }, {
      attributes: ["position", "corner", "color"],
      uniforms: ["worldViewProjection", "celestial", "visibility", "time", "screenSize"],
      needAlphaBlending: true,
    });
  return skyLayer(mesh, mat, 1);
}

function milkyWayMesh(scene: Scene): Mesh {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let j = 0; j <= MILKY_WAY_SEGMENTS_RA; j++) {
    const u = j / MILKY_WAY_SEGMENTS_RA;
    for (let i = 0; i <= MILKY_WAY_SEGMENTS_DEC; i++) {
      const v = i / MILKY_WAY_SEGMENTS_DEC;
      const p = equatorialToVector({ ra: (0.5 - u) * 360, dec: (v - 0.5) * 180 });
      positions.push(p.x * MILKY_WAY_RADIUS, p.y * MILKY_WAY_RADIUS, p.z * MILKY_WAY_RADIUS);
      uvs.push(u, v);
    }
  }
  const column = MILKY_WAY_SEGMENTS_DEC + 1;
  for (let j = 0; j < MILKY_WAY_SEGMENTS_RA; j++)
    for (let i = 0; i < MILKY_WAY_SEGMENTS_DEC; i++) {
      const a = j * column + i, b = a + column;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const mesh = new Mesh("milkyWay", scene);
  const data = new VertexData();
  data.positions = positions;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh);

  const mat = nativeShaderMaterial("milkyWayMat", scene, { vertex: MILKY_WAY_VERTEX, fragment: MILKY_WAY_FRAGMENT },
    { vertex: MILKY_WAY_WGSL_VERTEX, fragment: MILKY_WAY_WGSL_FRAGMENT }, {
    attributes: ["position", "uv"], uniforms: ["worldViewProjection", "celestial", "visibility"], samplers: ["milkyWay"],
    needAlphaBlending: true,
  });
  mat.setTexture("milkyWay", new Texture(`${import.meta.env.BASE_URL}sky/milkyway.jpg`, scene));
  return skyLayer(mesh, mat, 0);
}

export function skyLayer(mesh: Mesh, mat: ShaderMaterial, order: number, alphaMode = Constants.ALPHA_ADD): Mesh {
  mat.alphaMode = alphaMode;
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.infiniteDistance = true;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.alphaIndex = order;
  mesh.renderingGroupId = SKY_LAYER_GROUP;
  return mesh;
}
