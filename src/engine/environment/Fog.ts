import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { Observable } from "@babylonjs/core/Misc/observable";
import { Constants } from "@babylonjs/core/Engines/constants";
import { nativeShaderMaterial } from "../../core/nativeShader";
import { skyLayer } from "./NightSky";
import { SKY_RADIUS, FAR_PLANE, smoothstep, type SkyState } from "./sky";

// Visibility is the distance at which 5% of an object's own colour is left; Babylon's squared-exponential
// fog leaves exp(-(density * distance)^2).
const DENSITY_AT_VISIBILITY = Math.sqrt(-Math.log(0.05));
const MIST_VISIBILITY = 6000;
const RAIN_VISIBILITY = 150;
// Sun altitudes in degrees: the mist gathers before sunrise, lies while the sun is low and is gone by the
// last figure. Dusk runs the same way backwards.
const MIST_SUN = [-8, -2, 6, 18];
// Mist is as bright as the sky light on it, so what it hides fades into the sky behind and does not
// stand out against it. Rain fog is lit the same way, with a little of the sun or moon: under rain the sky
// light is already the rain clouds' own grey.
const MIST_AMBIENT_LIT = 1;
const RAIN_AMBIENT_LIT = 1;
const RAIN_SUN_LIT = 0.05;
// The fog is treated as a layer this deep above the eye, so the sky overhead clears before the horizon does.
export const FOG_DEPTH = 300;
const VEIL_RADIUS = SKY_RADIUS * 0.9;
const VEIL_ORDER = 9;

// Two fogs add up; the clear-day haze is left to Babylon's atmosphere, which already tints distant
// ground with the sky's own light. Morning and evening mist is light, the same every day, and lies on
// the land and water only. Rain thickens the air by the square of its strength, sky included: a
// drizzle hides the far shore, full rain closes the view to RAIN_VISIBILITY metres.
export function fogDensity(rain: number, sunAltitude: number): { mist: number; rain: number } {
  const mist = smoothstep(MIST_SUN[0], MIST_SUN[1], sunAltitude) * (1 - smoothstep(MIST_SUN[2], MIST_SUN[3], sunAltitude));
  return { mist: DENSITY_AT_VISIBILITY * mist / MIST_VISIBILITY, rain: DENSITY_AT_VISIBILITY * rain * rain / RAIN_VISIBILITY };
}

// How far the rain fog lets the player see: beyond this distance less than a thousandth of an
// object's own colour is left, since the fog leaves exp(-(density * distance)^2). Mist never hides
// anything this way: it does not veil the sky, so a far hill still stands out against it.
export function rainReach(rainDensity: number): number {
  return rainDensity > 0 ? Math.sqrt(Math.log(1000)) / rainDensity : Infinity;
}

// Whether the rain provably hides a thing: both the fog on it and the veil behind it must be opaque
// past the reach. Seen above the horizon the veil in its direction is thinner than the fog on it —
// its path is FOG_DEPTH / sin(elevation), about FOG_DEPTH * distance / rise — so a high thing is
// hidden only once the veil there is as thick. At or below the layer's own depth the veil is at
// least as thick as the fog, so the fog alone decides.
export function rainHides(reach: number, distance: number, rise: number): boolean {
  const veil = rise <= FOG_DEPTH ? 1 : FOG_DEPTH / rise;
  return distance * Math.min(1, veil) > reach;
}

const GLSL_VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

const GLSL_FRAGMENT = `
precision highp float;
uniform vec3 colour;
uniform float density;
varying vec3 vDir;
void main() {
  float path = min(${FOG_DEPTH.toFixed(1)} / max(normalize(vDir).y, 0.0001), ${FAR_PLANE.toFixed(1)});
  float thickness = density * path;
  gl_FragColor = vec4(colour, 1.0 - exp(-thickness * thickness));
}`;

const WGSL_VERTEX = `
attribute position: vec3f;
uniform worldViewProjection: mat4x4f;
varying vDir: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vDir = vertexInputs.position;
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
}`;

const WGSL_FRAGMENT = `
uniform colour: vec3f;
uniform density: f32;
varying vDir: vec3f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let path = min(${FOG_DEPTH.toFixed(1)} / max(normalize(input.vDir).y, 0.0001), ${FAR_PLANE.toFixed(1)});
  let thickness = uniforms.density * path;
  fragmentOutputs.color = vec4f(uniforms.colour, 1.0 - exp(-thickness * thickness));
}`;

// Weather and time of day set how far the player can see. Everything in the scene is fogged by Babylon's
// scene fog. The sky layers (atmosphere, stars, clouds, sun, moon) take no scene fog: mist leaves them
// clear, and a veil drawn over them fogs the sky by the rain's density alone. Under water, Underwater
// overrides the scene fog each frame.
export class Fog {
  constructor(scene: Scene, onSky: Observable<SkyState>, sun: DirectionalLight, moon: DirectionalLight) {
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0;

    const veil = MeshBuilder.CreateSphere("fogVeil", { diameter: 2 * VEIL_RADIUS, segments: 24 }, scene);
    const mat = nativeShaderMaterial("fogVeilMat", scene, { vertex: GLSL_VERTEX, fragment: GLSL_FRAGMENT },
      { vertex: WGSL_VERTEX, fragment: WGSL_FRAGMENT }, {
      attributes: ["position"], needAlphaBlending: true,
      uniforms: ["worldViewProjection", "colour", "density"],
    });
    skyLayer(veil, mat, VEIL_ORDER, Constants.ALPHA_COMBINE);

    const colour = new Color3();
    onSky.add((s: SkyState) => {
      const density = fogDensity(s.weather.rain, s.sun.alt);
      const total = density.mist + density.rain;
      // Fog shows the light that falls on it. The colour goes from the mist's to the rain's by the
      // share of the fog that is rain.
      const wet = total > 0 ? density.rain / total : 0;
      const ambient = MIST_AMBIENT_LIT + (RAIN_AMBIENT_LIT - MIST_AMBIENT_LIT) * wet;
      const direct = wet * RAIN_SUN_LIT * sun.intensity, lunar = wet * RAIN_SUN_LIT * moon.intensity;
      colour.set(
        ambient * scene.ambientColor.r + direct * sun.diffuse.r + lunar * moon.diffuse.r,
        ambient * scene.ambientColor.g + direct * sun.diffuse.g + lunar * moon.diffuse.g,
        ambient * scene.ambientColor.b + direct * sun.diffuse.b + lunar * moon.diffuse.b);
      scene.fogDensity = total;
      // PBR materials read the scene's fog colour as a display colour and convert it to linear light, so
      // it is stored that way round; the veil takes the linear colour directly.
      colour.toGammaSpaceToRef(scene.fogColor, scene.getEngine().useExactSrgbConversions);
      veil.setEnabled(density.rain > 0);
      mat.setColor3("colour", colour);
      mat.setFloat("density", density.rain);
    });
  }
}
