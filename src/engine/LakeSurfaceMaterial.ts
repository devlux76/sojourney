import { MaterialPluginBase, ShaderLanguage } from "@babylonjs/core";
import type { AbstractEngine, BaseTexture, Light, PBRMaterial, Scene, SubMesh, UniformBuffer } from "@babylonjs/core";

// The lake's surface (E25/E26, ideas from web-ocean, MIT): the one ripple normal map is laid three
// times, at three scales and headings, each drifting on its own, so no tile repeats. What a pixel
// is too coarse to show of the ripples' slopes becomes roughness, as LEAN mapping does: near water
// stays sharp and sparkles, far water settles into a sheen, and the sun draws a glitter path that
// widens with distance instead of a round ball. The roughness reaches both the sun's highlight and
// the mirror, whose mips blur with it.

// Measured from textures/waterbump.png (256²): its slope variance, mean slope, and the share of
// that variance a box filter of r texels keeps, fitted as 1 / (1 + (r / 7)^2.2).
const TEXELS = 256;
const SLOPE_VARIANCE = 0.006;
const MEAN_SLOPE = [-0.007, -0.0133];
const KEPT_AT = 7;
const KEPT_POWER = 2.2;

// Tile in metres, heading in radians, share of the slope (the squares sum to one), and drift in
// metres a second on a calm day.
const LAYERS = [
  { tile: 41, heading: 0.6, share: 0.55, drift: 0.5 },
  { tile: 12, heading: -0.35, share: 0.65, drift: 0.24 },
  { tile: 3.3, heading: 1.9, share: 0.52, drift: 0.12 },
];

// Slope strength from calm to full wind. Calm matches the old single tile's bump level (0.35), a
// nearly glassy lake; full wind gives a slope variance near 0.02, a breezy fetch-limited lake.
const CALM_STRENGTH = 0.37;
const WINDY_STRENGTH = 1.8;
// Capillary ripples finer than the smallest layer, never in the texture, as slope variance per
// strength squared: about 0.0005 calm and 0.012 in full wind (Cox-Munk's sub-metre share). Without
// it a windy lake still mirrors the walls crisply (seen 2026-10-17).
const CAPILLARY_VARIANCE = 0.0037;

export function rippleStrength(wind: number) {
  const w = Math.min(Math.max(wind, 0), 1);
  return CALM_STRENGTH + (WINDY_STRENGTH - CALM_STRENGTH) * w;
}

// Seeing the bed through the shallows (E27): the share of the bed's light the water takes over a
// path is 1 - exp(-path / VIEW_CLEAR_METRES). Crater Lake is among the clearest lakes there are
// (Secchi depth near 30 m); 8 m to 1/e keeps light rock plain at 3 m and gone by about 25 m.
const VIEW_CLEAR_METRES = 8;
const WATER_IOR = 1.333;

// The baked water depth (tools/build_ground.py --depth): one byte per cell over rect [x0, z0, x1, z1],
// row 0 = south, in unitMetres steps.
export interface LakeDepth {
  texture: BaseTexture;
  rect: [number, number, number, number];
  unitMetres: number;
}

// Which lights the rim hides from each cell of the lake (LakeLight): red the sun, green the moon,
// over rect. Each light's direct share on the water is dimmed by its channel (E11).
export interface LakeLightShare {
  texture: BaseTexture;
  rect: [number, number, number, number];
  sun: Light;
  moon: Light;
}

export interface LakeSurfaceOptions {
  depth?: LakeDepth;
  light?: LakeLightShare;
}

const f = (value: number) => value.toFixed(4);

export class LakeSurfaceMaterialPlugin extends MaterialPluginBase {
  // Each layer's offset in its own tiles, along its heading.
  readonly offsets = LAYERS.map(() => 0);
  private strength = CALM_STRENGTH;
  private depth?: LakeDepth;
  private light?: LakeLightShare;

  constructor(material: PBRMaterial, private ripples: BaseTexture, options: LakeSurfaceOptions = {}) {
    super(material, "LakeSurface", 200);
    this.depth = options.depth;
    this.light = options.light;
    this.doNotSerialize = true;
    this._enable(true);
  }

  // wind is the share above the biome's calm baseline, 0 to 1.
  advance(dt: number, wind: number) {
    this.strength = rippleStrength(wind);
    LAYERS.forEach((layer, i) => {
      this.offsets[i] = (this.offsets[i] + layer.drift * (1 + wind) * dt / layer.tile) % 1;
    });
  }

  override getClassName() { return "LakeSurfaceMaterialPlugin"; }
  override isCompatible() { return true; }
  override isReadyForSubMesh() {
    return this.ripples.isReady() && (this.depth?.texture.isReady() ?? true) && (this.light?.texture.isReady() ?? true);
  }
  override getSamplers(samplers: string[]) {
    samplers.push("lakeRipples");
    if (this.depth) samplers.push("lakeDepth");
    if (this.light) samplers.push("lakeLight");
  }
  override getActiveTextures(textures: BaseTexture[]) {
    textures.push(this.ripples);
    if (this.depth) textures.push(this.depth.texture);
    if (this.light) textures.push(this.light.texture);
  }
  override hasTexture(texture: BaseTexture) {
    return texture === this.ripples || texture === this.depth?.texture || texture === this.light?.texture;
  }

  override getUniforms(shaderLanguage?: ShaderLanguage) {
    return {
      ubo: [
        { name: "lakeDrift", size: 4, type: "vec4" },
        { name: "lakeStrength", size: 1, type: "float" },
        { name: "lakeDepthRect", size: 4, type: "vec4" },
        { name: "lakeLightRect", size: 4, type: "vec4" },
        { name: "lakeLightSlots", size: 2, type: "vec2" },
      ],
      fragment: shaderLanguage === ShaderLanguage.WGSL
        ? "var lakeDrift: vec4f;\nvar lakeStrength: f32;\nvar lakeDepthRect: vec4f;\nvar lakeLightRect: vec4f;\nvar lakeLightSlots: vec2f;"
        : "uniform vec4 lakeDrift;\nuniform float lakeStrength;\nuniform vec4 lakeDepthRect;\nuniform vec4 lakeLightRect;\nuniform vec2 lakeLightSlots;",
    };
  }

  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh) {
    if (this.light) {
      // The shader's light slots follow the mesh's own light list; -1 matches no slot.
      const lights = subMesh.getMesh().lightSources;
      ubo.updateFloat4("lakeLightRect", ...this.light.rect);
      ubo.updateFloat2("lakeLightSlots", lights.indexOf(this.light.sun), lights.indexOf(this.light.moon));
      ubo.setTexture("lakeLight", this.light.texture);
    }
    ubo.updateFloat4("lakeDrift", this.offsets[0], this.offsets[1], this.offsets[2], 0);
    ubo.updateFloat("lakeStrength", this.strength);
    ubo.setTexture("lakeRipples", this.ripples);
    if (this.depth) {
      ubo.updateFloat4("lakeDepthRect", ...this.depth.rect);
      ubo.setTexture("lakeDepth", this.depth.texture);
    }
  }

  override getCustomCode(shaderType: string, language?: ShaderLanguage) {
    if (shaderType !== "fragment") return null;
    const wgsl = language === ShaderLanguage.WGSL;
    const u = wgsl ? "uniforms." : "";
    const position = wgsl ? "fragmentInputs.vPositionW" : "vPositionW";
    const [dx, dy] = wgsl ? ["dpdx", "dpdy"] : ["dFdx", "dFdy"];
    const [v2, v3, v4] = wgsl ? ["vec2f", "vec3f", "vec4f"] : ["vec2", "vec3", "vec4"];
    const let_ = (type: string) => wgsl ? "let" : type;
    const sample = (uv: string) => wgsl
      ? `textureSample(lakeRipples, lakeRipplesSampler, ${uv})`
      : `texture2D(lakeRipples, ${uv})`;
    // One layer: its slope turned back to world axes, and the share of its variance the pixel loses.
    const layerFunction = wgsl
      ? `fn lakeLayer(xz: vec2f, turn: vec2f, tile: f32, offset: f32, footprint: f32) -> vec3f {`
      : `vec3 lakeLayer(vec2 xz, vec2 turn, float tile, float offset, float footprint) {`;
    const layerBody = `
  ${let_("vec2")} local = ${v2}(turn.x * xz.x + turn.y * xz.y, turn.x * xz.y - turn.y * xz.x) / tile;
  ${let_("vec3")} n = ${sample(`local + ${v2}(offset, 0.0)`)}.xyz * 2.0 - 1.0;
  ${let_("vec2")} s = n.xy / max(n.z, 0.2) - ${v2}(${f(MEAN_SLOPE[0])}, ${f(MEAN_SLOPE[1])});
  ${let_("float")} x = pow(max(footprint * ${f(TEXELS)} / tile / ${f(KEPT_AT)}, 1e-4), ${f(KEPT_POWER)});
  return ${v3}(turn.x * s.x - turn.y * s.y, turn.y * s.x + turn.x * s.y, x / (1.0 + x));
}`;
    const layers = LAYERS.map((layer, i) => `${let_("vec3")} lakeL${i} = lakeLayer(${position}.xz, ${v2}(${f(Math.cos(layer.heading))}, ${f(Math.sin(layer.heading))}), ${f(layer.tile)}, ${u}lakeDrift.${"xyz"[i]}, lakeFootprint);`).join("\n");
    const slope = LAYERS.map((layer, i) => `lakeL${i}.xy * ${f(layer.share)}`).join(" + ");
    const lost = LAYERS.map((layer, i) => `lakeL${i}.z * ${f(layer.share * layer.share)}`).join(" + ");
    const reflectivity = `${u}vReflectivityColor`;
    // Babylon asks for the hook names during super(), before depth is set, so the alpha hook is
    // always named and is empty without a depth texture.
    const depth = this.depth;
    const depthSample = wgsl
      ? "textureSample(lakeDepth, lakeDepthSampler, lakeDepthUv).r"
      : "texture2D(lakeDepth, lakeDepthUv).r";
    // Over the bed the view refracts into the water, so the path to the bed is the depth over the
    // cosine of the refracted angle. Alpha is the water's share; Babylon keeps the reflection on top
    // (radiance and specular over alpha), so the shallows still mirror the sky at a grazing look.
    const shallows = !depth ? "" : `
${let_("vec2")} lakeDepthUv = (${position}.xz - ${u}lakeDepthRect.xy) / (${u}lakeDepthRect.zw - ${u}lakeDepthRect.xy);
${let_("float")} lakeDepthMetres = ${depthSample} * ${f(255 * depth.unitMetres)};
${let_("float")} lakeCosView = clamp(viewDirectionW.y, 0.0, 1.0);
${let_("float")} lakeCosRefracted = sqrt(1.0 - (1.0 - lakeCosView * lakeCosView) / ${f(WATER_IOR * WATER_IOR)});
alpha *= 1.0 - exp(-lakeDepthMetres / lakeCosRefracted / ${f(VIEW_CLEAR_METRES)});
`;
    const depthDefinitions = !depth ? "" : wgsl
      ? "var lakeDepthSampler: sampler;\nvar lakeDepth: texture_2d<f32>;\n"
      : "uniform sampler2D lakeDepth;\n";
    // How much of the sun (r) and moon (g) shows over the rim here, and each light slot's share of it.
    const light = this.light;
    const lightDefinitions = !light ? "" : wgsl
      ? "var lakeLightSampler: sampler;\nvar lakeLight: texture_2d<f32>;\n"
      : "uniform sampler2D lakeLight;\n";
    const lightSample = !light ? "" : `
${let_("vec2")} lakeLightUv = (${position}.xz - ${u}lakeLightRect.xy) / (${u}lakeLightRect.zw - ${u}lakeLightRect.xy);
${let_("vec2")} lakeLit = ${wgsl ? "textureSample(lakeLight, lakeLightSampler, lakeLightUv).rg" : "texture2D(lakeLight, lakeLightUv).rg"};
`;
    const lightHooks: Record<string, string> = {};
    const lights = (this._material as PBRMaterial).maxSimultaneousLights ?? 4;
    for (let i = 0; i < lights; i++) {
      const share = `mix(1.0, lakeLit.x, 1.0 - step(0.5, abs(${i}.0 - ${u}lakeLightSlots.x))) * mix(1.0, lakeLit.y, 1.0 - step(0.5, abs(${i}.0 - ${u}lakeLightSlots.y)))`;
      lightHooks[`CUSTOM_LIGHT${i}_COLOR`] = !light ? "" : `
#ifdef DIRLIGHT${i}
${wgsl ? `diffuse${i} = vec4f(diffuse${i}.rgb * ${share}, diffuse${i}.a);` : `diffuse${i}.rgb *= ${share};`}
#endif
`;
    }
    return {
      ...lightHooks,
      CUSTOM_FRAGMENT_DEFINITIONS: wgsl
        ? `var lakeRipplesSampler: sampler;\nvar lakeRipples: texture_2d<f32>;\n${depthDefinitions}${lightDefinitions}${layerFunction}${layerBody}`
        : `uniform sampler2D lakeRipples;\n${depthDefinitions}${lightDefinitions}${layerFunction}${layerBody}`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: shallows,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: `
${let_("float")} lakeFootprint = max(length(${dx}(${position}.xz)), length(${dy}(${position}.xz)));
${layers}
${let_("vec2")} lakeSlope = (${slope}) * ${u}lakeStrength;
${let_("vec2")} lakeSlopeDx = ${dx}(lakeSlope);
${let_("vec2")} lakeSlopeDy = ${dy}(lakeSlope);
// The variance the texture's mips filtered away, and what the pixel still spans (specular AA).
${let_("float")} lakeVariance = ((${lost}) * ${f(SLOPE_VARIANCE)} + ${f(CAPILLARY_VARIANCE)}) * ${u}lakeStrength * ${u}lakeStrength
  + 0.5 * (dot(lakeSlopeDx, lakeSlopeDx) + dot(lakeSlopeDy, lakeSlopeDy));
normalW = normalize(${v3}(-lakeSlope.x, 1.0, -lakeSlope.y));
// Babylon's alpha is roughness squared; slope variance adds to alpha squared.
${let_("float")} lakeAlpha = ${reflectivity}.g * ${reflectivity}.g;
${let_("float")} lakeRoughness = min(sqrt(sqrt(lakeAlpha * lakeAlpha + lakeVariance)), 1.0);
${let_("vec4")} lakeReflectivity = ${v4}(${reflectivity}.r, lakeRoughness, ${reflectivity}.b, ${reflectivity}.a);
${lightSample}`,
      "!reflectivityBlock\\(\\s*(?:uniforms\\.)?vReflectivityColor": "reflectivityBlock(\nlakeReflectivity",
    };
  }
}
