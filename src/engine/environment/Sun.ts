import { Scene } from "@babylonjs/core/scene";
import type { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { Observable } from "@babylonjs/core/Misc/observable";
import { nativeShaderMaterial } from "../../core/nativeShader";
import { skyLayer } from "./NightSky";
import { SKY_RADIUS, type SkyState } from "./sky";

const SUN_DISTANCE = SKY_RADIUS * 0.95;
const DISC_HALF_SIZE = SUN_DISTANCE * Math.tan((0.27 * Math.PI) / 180);
const QUAD_SCALE = 6;
// How much brighter the disc is than a white surface in full sun. It has to be far above the bloom
// threshold for the pipeline's bloom to spread it into a glare; at 40 the sun was a dim dot.
const DISC_RADIANCE = 480;
// The disc's brightness in a reflection. A flat mirror would show a second sun with its own glare;
// real water breaks a low sun's image up, so the mirror gets a twelfth.
const REFLECTED = 1 / 12;

const GLSL_VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
uniform vec3 sunDir, right, up;
uniform float halfSize;
varying vec2 vCorner;
void main() {
  vCorner = position.xy;
  vec3 p = sunDir * ${SUN_DISTANCE.toFixed(1)} + (right * position.x + up * position.y) * halfSize;
  vec4 clip = worldViewProjection * vec4(p, 1.0);
  gl_Position = vec4(clip.xy, clip.w, clip.w);
}`;

const GLSL_FRAGMENT = `
precision highp float;
uniform vec3 colour;
varying vec2 vCorner;
void main() {
  float d = length(vCorner) * ${QUAD_SCALE.toFixed(1)};
  float core = 1.0 - smoothstep(0.92, 1.0, d);
  float halo = 0.02 / (0.02 + d * d * d);
  gl_FragColor = vec4(colour * (core + halo) * (1.0 - smoothstep(0.6, 1.0, length(vCorner))), 1.0);
}`;

const WGSL_VERTEX = `
attribute position: vec3f;
uniform worldViewProjection: mat4x4f;
uniform sunDir: vec3f;
uniform right: vec3f;
uniform up: vec3f;
uniform halfSize: f32;
varying vCorner: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vCorner = vertexInputs.position.xy;
  let p = uniforms.sunDir * ${SUN_DISTANCE.toFixed(1)}
    + (uniforms.right * vertexInputs.position.x + uniforms.up * vertexInputs.position.y) * uniforms.halfSize;
  let clip = uniforms.worldViewProjection * vec4f(p, 1.0);
  vertexOutputs.position = vec4f(clip.xy, clip.w, clip.w);
}`;

const WGSL_FRAGMENT = `
uniform colour: vec3f;
varying vCorner: vec2f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let d = length(input.vCorner) * ${QUAD_SCALE.toFixed(1)};
  let core = 1.0 - smoothstep(0.92, 1.0, d);
  let halo = 0.02 / (0.02 + d * d * d);
  fragmentOutputs.color = vec4f(uniforms.colour * (core + halo) * (1.0 - smoothstep(0.6, 1.0, length(input.vCorner))), 1.0);
}`;

export class SunDisc {
  readonly mesh: Mesh;
  private readonly dim: (target: RenderTargetTexture) => void;

  constructor(scene: Scene, onSky: Observable<SkyState>, sun: DirectionalLight) {
    const mesh = new Mesh("sunDisc", scene);
    const data = new VertexData();
    data.positions = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
    data.indices = [0, 1, 2, 0, 2, 3];
    data.applyToMesh(mesh);
    const mat = nativeShaderMaterial("sunDiscMat", scene, { vertex: GLSL_VERTEX, fragment: GLSL_FRAGMENT },
      { vertex: WGSL_VERTEX, fragment: WGSL_FRAGMENT }, {
      attributes: ["position"], needAlphaBlending: true,
      uniforms: ["worldViewProjection", "sunDir", "right", "up", "halfSize", "colour"],
    });
    this.mesh = skyLayer(mesh, mat, 4);

    const right = new Vector3(), up = new Vector3();
    onSky.add((s: SkyState) => {
      mesh.setEnabled(s.sun.alt > -2);
      const reference = Math.abs(s.sunDir.y) > 0.999 ? Vector3.Forward() : Vector3.Up();
      Vector3.CrossToRef(reference, s.sunDir, right);
      right.normalize();
      Vector3.CrossToRef(s.sunDir, right, up);
      mat.setVector3("sunDir", s.sunDir);
      mat.setVector3("right", right);
      mat.setVector3("up", up);
      mat.setFloat("halfSize", DISC_HALF_SIZE * QUAD_SCALE);
      sun.diffuse.scaleToRef(DISC_RADIANCE * (1 - s.weather.cloudCover), colour);
      mat.setColor3("colour", colour);
    });

    const colour = new Color3(), reflected = new Color3();
    this.dim = target => {
      target.onBeforeRenderObservable.add(() => { mat.setColor3("colour", colour.scaleToRef(REFLECTED, reflected)); });
      target.onAfterRenderObservable.add(() => { mat.setColor3("colour", colour); });
    };
  }

  // Draws the disc dimmer while this target (the lake's mirror) is rendered.
  dimIn(target: RenderTargetTexture) {
    this.dim(target);
  }
}
