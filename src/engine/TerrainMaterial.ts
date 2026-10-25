import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { Material } from "@babylonjs/core/Materials/material";
import { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";

export interface TerrainLook {
  sizeMetres: number;
  waterLevel: number;
  rockTileMetres: number;
  // Authored NME relief tile, present only when the pack supplies its normal map.
  reliefTileMetres?: number;
  // Authored granular cinder in the shared arrays, selected by mapped substrate.
  cinder?: { arrayLayer: number; tileMetres: number };
  // The lake bed's depth bands (ISSUES.md B4), in texture-array layer order: bright shore sand,
  // moss, fine sediment, dark basalt, rust-gold bacterial mats. Each entry is that layer's tile
  // in metres; the layers share pixels (arrays need identical sizes) but not scale.
  bedTiles: number[];
  // The depth of water over which daylight falls to 1/e of what it was.
  daylightDepthMetres: number;
  groundLayers: { sampler: string; normalUrl?: string; aoUrl?: string; tileMetres: number; tint: number }[];
}

const f = (x: number, digits = 3) => x.toFixed(digits);
const MIN_PROJECTION = 0.02;
const MIN_LAYER = 0.004;
const TILED_SAMPLER = "rockAlbedo";
// The lake mask (24 m cells, bilinear) limits the underwater look to the caldera lake. It, the baked normal map,
// every tiled layer and both bed texture arrays share one sampler. Sampler count and texture count
// are separate budgets; include Babylon's and the atmosphere's bindings in either count.
// The bed arrays travel as two texture bindings (albedo + normals, five depth bands each) instead of ten
// 2D textures. The engine requests each adapter's supported limits (Engine.ts); 16 is WebGPU's
// default guaranteed texture allowance, not a universal hardware ceiling (see NME_NOTES.md).
// Regional maps need their clamp sampler on WebGPU too; repeating material
// textures keep sharing rockAlbedo's sampler. This adds no texture binding.
const OWN_SAMPLER = [TILED_SAMPLER, "splatMap", "normalAo"];
// Beyond the reach of the tree cards the forest is painted into the ground: where the splat map has
// needle litter (which the pipeline lays under tree crowns, at up to NEEDLES_UNDER_FULL_CANOPY) the
// ground takes the colour of a conifer canopy seen from afar, in linear RGB.
const NEEDLES_UNDER_FULL_CANOPY = 0.85;
const CANOPY_COLOUR = "0.022, 0.034, 0.018";
const CANOPY_COVER = 0.9;
// A ground mesh's skirt (the strip under its edge that hides cracks between levels) is drawn this much
// farther back in depth than it lies: a metre, plus this share of its distance from the eye. Without it
// a skirt flickered through the face of any cliff standing a few metres in front of it. The share is
// what depth is really good for here, with room to spare: positions are worked out in 32-bit floats
// from world coordinates thousands of metres from the origin, with the near plane at 0.1 m, and the
// rounding in that is worth about a hundredth of the distance (measured: a skirt 2.7 m behind a slope
// 1,270 m away still showed through when pushed back 4 m).
// Caustics are the surface's ripples focusing the sun, and blur out over this e-folding depth.
const CAUSTICS_DEPTH_METRES = 8;
// PBRMaterial's default maxSimultaneousLights, which the ground keeps: one colour hook per light.
const LIGHTS = 4;
const SKIRT_BACK_METRES = 1;
const SKIRT_BACK_SHARE = 0.05;

export class TerrainMaterialPlugin extends MaterialPluginBase {
  // All terrain still shares one material. Only this authored texture and its
  // world registration change per draw; no material or shader is cloned per tile.
  private normalMaps = new WeakMap<AbstractMesh, { texture: BaseTexture; bounds: [number, number, number, number] }>();
  private regionalTextures = new Map<BaseTexture, number>();
  causticsTime = 0;
  causticsStrength = 0;
  wetness = 0;
  // Camera distances in metres between which the painted forest fades in: none where the full tree
  // files are drawn, complete where the middle-band cards end. The default leaves the ground unpainted.
  forestBand: [number, number] = [1e9, 2e9];

  constructor(material: Material, private look: TerrainLook, private textures: Record<string, BaseTexture>) {
    // The order among a material's plugins: after Babylon's atmosphere plugin (600), which sets the
    // sun's colour at the same per-light hook this one dims it at, so the dimming is not overwritten.
    super(material, "Terrain", 700, { TERRAIN_SKIRT: false });
    // Babylon's normal bind can be skipped between meshes sharing a material.
    // Its extra-event hard bind runs for every submesh, including mirror draws.
    this.registerForExtraEvents = true;
    this._enable(true);
  }

  setNormalMap(mesh: AbstractMesh, texture: BaseTexture | null, bounds?: [number, number, number, number]) {
    const previous = this.normalMaps.get(mesh);
    if (previous) {
      const count = this.regionalTextures.get(previous.texture)! - 1;
      if (count) this.regionalTextures.set(previous.texture, count);
      else this.regionalTextures.delete(previous.texture);
    }
    this.normalMaps.delete(mesh);
    if (texture && bounds) {
      this.normalMaps.set(mesh, { texture, bounds });
      this.regionalTextures.set(texture, (this.regionalTextures.get(texture) ?? 0) + 1);
    }
  }

  override getClassName() {
    return "TerrainMaterialPlugin";
  }

  override isCompatible() {
    return true;
  }

  override isReadyForSubMesh() {
    return Object.values(this.textures).every(t => t.isReady());
  }

  // The pack marks skirt vertices with u = 1 in the mesh's uv; a mesh without uvs has no skirt to push.
  override prepareDefines(defines: MaterialDefines, _scene: Scene, mesh: AbstractMesh) {
    (defines as MaterialDefines & { TERRAIN_SKIRT: boolean }).TERRAIN_SKIRT = mesh.isVerticesDataPresent(VertexBuffer.UVKind);
  }

  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh) {
    if (mesh.isVerticesDataPresent(VertexBuffer.UVKind) && !attributes.includes(VertexBuffer.UVKind)) attributes.push(VertexBuffer.UVKind);
  }

  override getSamplers(samplers: string[]) {
    samplers.push(...Object.keys(this.textures));
  }

  override getActiveTextures(active: BaseTexture[]) {
    active.push(...Object.values(this.textures));
    active.push(...this.regionalTextures.keys());
  }

  override hasTexture(texture: BaseTexture) {
    return Object.values(this.textures).includes(texture) || this.regionalTextures.has(texture);
  }

  override getUniforms(shaderLanguage?: ShaderLanguage) {
    return {
      ubo: [
        { name: "causticsTime", size: 1, type: "float" },
        { name: "causticsStrength", size: 1, type: "float" },
        { name: "weatherWetness", size: 1, type: "float" },
        { name: "forestBand", size: 2, type: "vec2" },
        { name: "normalMapRect", size: 4, type: "vec4" },
      ],
      fragment: shaderLanguage === ShaderLanguage.WGSL
        ? "var causticsTime: f32;\nvar causticsStrength: f32;\nvar weatherWetness: f32;\nvar forestBand: vec2f;\nvar normalMapRect: vec4f;"
        : "uniform float causticsTime;\nuniform float causticsStrength;\nuniform float weatherWetness;\nuniform vec2 forestBand;\nuniform vec4 normalMapRect;",
    };
  }

  override bindForSubMesh(ubo: UniformBuffer) {
    ubo.updateFloat("causticsTime", this.causticsTime);
    ubo.updateFloat("causticsStrength", this.causticsStrength);
    ubo.updateFloat("weatherWetness", this.wetness);
    ubo.updateFloat2("forestBand", this.forestBand[0], this.forestBand[1]);
    // normalAo is bound by hardBindForSubMesh, otherwise a cached material bind
    // could reuse the preceding leaf's texture or overwrite its regional map.
    for (const [name, texture] of Object.entries(this.textures)) if (name !== "normalAo") ubo.setTexture(name, texture);
  }

  override hardBindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh) {
    const region = this.normalMaps.get(subMesh.getMesh());
    const size = this.look.sizeMetres;
    const bounds = region?.bounds ?? [-size / 2, -size / 2, size, size];
    ubo.updateFloat4("normalMapRect", bounds[0], bounds[1], bounds[2], bounds[3]);
    ubo.setTexture("normalAo", region?.texture ?? this.textures.normalAo);
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType === "vertex") return this.skirtBack(shaderLanguage === ShaderLanguage.WGSL);
    if (shaderType !== "fragment") return null;
    if (!this.look) return { CUSTOM_FRAGMENT_DEFINITIONS: "", CUSTOM_FRAGMENT_UPDATE_ALPHA: "", CUSTOM_FRAGMENT_BEFORE_LIGHTS: "", CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: "" };
    return shaderLanguage === ShaderLanguage.WGSL ? this.wgsl() : this.glsl();
  }

  // Vertex code: a skirt vertex keeps its place on the screen and takes the depth of a point farther
  // along the line from the eye, so whatever lies just in front of the skirt always covers it.
  private skirtBack(wgsl: boolean): { [point: string]: string } {
    const back = `(${f(SKIRT_BACK_METRES, 1)} + reach * ${f(SKIRT_BACK_SHARE, 3)})`;
    return wgsl ? {
      CUSTOM_VERTEX_DEFINITIONS: `
#if defined(TERRAIN_SKIRT) && !defined(UV1)
attribute uv: vec2f;
#endif`,
      CUSTOM_VERTEX_MAIN_END: `
#ifdef TERRAIN_SKIRT
if (vertexInputs.uv.x > 0.5) {
  let away = worldPos.xyz - scene.vEyePosition.xyz;
  let reach = length(away);
  let behind = scene.viewProjection * vec4f(worldPos.xyz + away * (${back} / reach), 1.0);
  vertexOutputs.position.z = behind.z / behind.w * vertexOutputs.position.w;
}
#endif`,
    } : {
      CUSTOM_VERTEX_DEFINITIONS: `
#if defined(TERRAIN_SKIRT) && !defined(UV1)
attribute vec2 uv;
#endif`,
      CUSTOM_VERTEX_MAIN_END: `
#ifdef TERRAIN_SKIRT
if (uv.x > 0.5) {
  vec3 away = worldPos.xyz - vEyePosition.xyz;
  float reach = length(away);
  vec4 behind = viewProjection * vec4(worldPos.xyz + away * (${back} / reach), 1.0);
  gl_Position.z = behind.z / behind.w * gl_Position.w;
}
#endif`,
    };
  }

  private glsl() {
    const l = this.look, layers = l.groundLayers;
    const isBedArray = (name: string) => name === "bedAlbedo" || name === "bedNormal";
    const samplers = Object.keys(this.textures).filter(n => !isBedArray(n)).map(name => `uniform sampler2D ${name};`).join("\n")
      + "\nuniform sampler2DArray bedAlbedo;\nuniform sampler2DArray bedNormal;";
    const bedT = (i: number) => f(l.bedTiles[i], 1);
    const layer = (i: number) =>
      `toLinearSpace(triplanar(${layers[i].sampler}, ${f(layers[i].tileMetres, 1)}) * ${f(layers[i].tint, 2)})` +
      (layers[i].aoUrl ? ` * triplanar(${layers[i].sampler}AO, ${f(layers[i].tileMetres, 1)}).r` : "");
    const w = (i: number) => `splat.${"rgb"[i]}`;
    const rockNormalNeeded = [`rockWeight > ${f(MIN_LAYER, 4)}`,
      ...layers.flatMap((layer, i) => layer.normalUrl ? [] : [`${w(i)} > ${f(MIN_LAYER, 4)}`])].join(" || ");
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
// Array samplers have no default fragment precision in GLSL ES. Declare it
// here so terrain is valid in standalone scenes as well as the atmosphere world.
precision highp sampler2DArray;
${samplers}
vec3 triplanarWeights(vec3 n) {
  vec3 a = abs(n);
  vec3 n2 = a * a;
  vec3 w = n2 * n2;
  w /= w.x + w.y + w.z;
  w *= step(${f(MIN_PROJECTION)}, w);
  return w / (w.x + w.y + w.z);
}
vec3 axisSign(vec3 n) { return step(0.0, n) * 2.0 - 1.0; }
// USGS mapped substrate is packed into splat alpha. Fetch a base-level texel:
// interpolating categorical IDs or their mips would invent colours at contacts.
// Legacy RGB maps have alpha=1, which selects the neutral treatment.
float mappedSubstrate(vec2 uv) {
  ivec2 size = textureSize(splatMap, 0);
  ivec2 pixel = clamp(ivec2(floor(uv * vec2(size))), ivec2(0), size - 1);
  return floor(texelFetch(splatMap, pixel, 0).a * 4.0 + 0.5);
}
vec3 mappedSubstrateTint(float substrate) {
  if (substrate < 0.5) return vec3(0.72, 0.76, 0.80); // glassy lava
  if (substrate < 1.5) return vec3(1.0); // cinder has its own authored surface
  if (substrate < 2.5) return vec3(4.50, 2.20, 1.00); // bright ochre tuff, above the dark carrier (USGS Castle reference)
  if (substrate < 3.5) return vec3(1.35, 1.32, 1.25); // pale pyroclastic deposits
  return vec3(1.0);
}
// Geology tint at a contact: blend the four neighbouring texels' tints
// bilinearly at a uv jittered by sub-texel value noise, so the contact is an
// irregular soft edge instead of a 4.4 m pixel staircase. The class itself is
// still the single nearest texel (the cinder branch tests it), only the tint
// is blended here. textureLoad + pure math, so it stays legal inside the
// non-uniform underwater branch (no derivatives).
// GLSL requires a declaration before the contact jitter calls this helper.
float valueNoise(vec2 p);
vec3 mappedSubstrateTintSoft(vec2 uv) {
  ivec2 size = textureSize(splatMap, 0);
  vec2 oneTexel = 1.0 / vec2(size);
  // Jitter of about one texel, varying every few tens of metres, so the contact
  // breaks up the texel grid instead of running straight along it.
  vec2 p = uv + (valueNoise(uv * 100.0) - 0.5) * 2.0 * oneTexel;
  vec2 c = p * vec2(size);
  ivec2 base = clamp(ivec2(floor(c)), ivec2(0), size - ivec2(2));
  vec2 f = clamp(fract(c), 0.0, 1.0);
  float s00 = floor(texelFetch(splatMap, base, 0).a * 4.0 + 0.5);
  float s10 = floor(texelFetch(splatMap, base + ivec2(1, 0), 0).a * 4.0 + 0.5);
  float s01 = floor(texelFetch(splatMap, base + ivec2(0, 1), 0).a * 4.0 + 0.5);
  float s11 = floor(texelFetch(splatMap, base + ivec2(1, 1), 0).a * 4.0 + 0.5);
  vec3 t00 = mappedSubstrateTint(s00);
  vec3 t10 = mappedSubstrateTint(s10);
  vec3 t01 = mappedSubstrateTint(s01);
  vec3 t11 = mappedSubstrateTint(s11);
  vec3 top = mix(t00, t10, f.x);
  vec3 bottom = mix(t01, t11, f.x);
  return mix(top, bottom, f.y);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Offset blends break up tiling on cliffs as well as flats. Albedo and micro
// normals use the same coordinates; the separately authored macro relief stays intact.
vec4 sampleNoRepeat(sampler2D tex, vec2 uv, vec2 dx, vec2 dy) {
  float l = valueNoise(uv * 0.3) * 8.0, i = floor(l);
  vec4 a = textureGrad(tex, uv + sin(vec2(3.0, 7.0) * i), dx, dy);
  vec4 b = textureGrad(tex, uv + sin(vec2(3.0, 7.0) * (i + 1.0)), dx, dy);
  return mix(a, b, smoothstep(0.35, 0.65, l - i));
}
vec4 sampleNoRepeatArray(sampler2DArray tex, vec2 uv, float layer, vec2 dx, vec2 dy) {
  float l = valueNoise(uv * 0.3) * 8.0, i = floor(l);
  vec4 a = textureGrad(tex, vec3(uv + sin(vec2(3.0, 7.0) * i), layer), dx, dy);
  vec4 b = textureGrad(tex, vec3(uv + sin(vec2(3.0, 7.0) * (i + 1.0)), layer), dx, dy);
  return mix(a, b, smoothstep(0.35, 0.65, l - i));
}
// The existing lake mask also confines shoreline staining to the caldera.
float lakeShoreCoverage;
// Neutral volcanic-rock grade with irregular weathering and scree accents.
vec3 strataTint(vec3 p, float up) {
  vec3 cold = vec3(1.42, 1.49, 1.62);
  float rust = smoothstep(0.55, 0.8, valueNoise(p.xz / 41.0 + p.y * 0.023)) * smoothstep(0.62, 0.82, valueNoise(p.xz / 13.0 + p.y * 0.05 + 3.7));
  float lichen = smoothstep(0.62, 0.8, valueNoise(p.xz / 7.0 + 9.1)) * smoothstep(0.45, 0.7, up);
  vec3 tint = mix(vec3(1.0), vec3(1.25, 0.72, 0.45), rust * 0.35);
  tint = mix(tint, vec3(1.05, 1.08, 0.98), lichen * 0.5);
  // A single near-shore weathering ring, rather than recurring geological bands.
  float aboveLake = p.y - ${f(l.waterLevel, 1)};
  float shoreRing = smoothstep(0.5, 1.3, aboveLake)
    * (1.0 - smoothstep(3.5, 5.0, aboveLake)) * lakeShoreCoverage;
  tint *= mix(vec3(1.0), vec3(1.15, 0.8, 0.65), shoreRing * 0.6);
  // Vertical structure dominates the reference: fractures and dikes run down the crag, while
  // horizontal bands read as contour-following. Streaks vary fast across the face and slow along
  // the fall line, gated by steepness (1 on cliffs) so the flats keep their bedding.
  float steep = 1.0 - clamp(up, 0.0, 1.0);
  float streak = valueNoise(vec2((p.x + p.z) * 0.11, p.y * 0.012)) - 0.5;
  float dike = smoothstep(0.68, 0.8, valueNoise(vec2((p.x - p.z) * 0.045 + 7.3, p.y * 0.006)));
  tint *= 1.0 + (streak * 0.22 - dike * 0.18) * steep;
  // Pale scree chutes: near-white talus tracks run rim-to-waterline down the drainages.
  float chute = smoothstep(0.65, 0.8, valueNoise(p.xz / 37.0 + p.y * 0.01)) * steep;
  tint = mix(tint, vec3(1.9, 1.9, 1.85), chute * 0.55);
  return cold * tint * (0.88 + 0.24 * valueNoise(p.xz / 121.0));
}
// Faint volcanic layering on open deposits. This must never read as contour lines: the bands are
// long (34 m), heavily wobbled, and broken along strike by patch noise, at a whisper of amplitude.
vec3 slopeBands(vec3 p) {
  float wobble = (valueNoise(p.xz / 47.0) - 0.5) * 24.0;
  float f = fract((p.y + wobble) / 34.0);
  float along = smoothstep(0.35, 0.7, valueNoise(vec2(p.x * 0.008 + p.z * 0.013, p.y * 0.02)));
  vec3 tint = mix(vec3(0.995, 0.99, 0.985), vec3(1.045, 1.0, 0.93), smoothstep(0.3, 0.55, f) * along);
  return mix(tint, vec3(0.93, 0.92, 0.91), smoothstep(0.78, 0.92, f) * along * 0.5);
}
// The authored lidar bake: RG stores world-normal east/north, B sky visibility.
// normalMapRect registers either a padded leaf crop or the distant whole-map
// representation. Decode and renormalize identically after native filtering.
float skyVisibility;
vec3 bakedNormal() {
  vec3 baked = texture2D(normalAo, (vPositionW.xz - normalMapRect.xy) / normalMapRect.zw).rgb;
  vec2 nxz = baked.rg * 2.0 - 1.0;
  skyVisibility = baked.b;
  return normalize(vec3(nxz.x, sqrt(clamp(1.0 - dot(nxz, nxz), 0.0, 1.0)), nxz.y));
}
vec3 tpN, tpW, tpS, tpDx, tpDy;
void triplanarSetup() {
  tpN = bakedNormal(); tpW = triplanarWeights(tpN); tpS = axisSign(tpN);
  tpDx = dFdx(vPositionW); tpDy = dFdy(vPositionW);
}
vec3 triplanar(sampler2D tex, float tileMetres) {
  vec3 s = tpS, p = vPositionW / tileMetres, dx = tpDx / tileMetres, dy = tpDy / tileMetres, c = vec3(0.0);
  if (tpW.x > 0.0) c += sampleNoRepeat(tex, vec2(p.z * s.x, p.y), vec2(dx.z * s.x, dx.y), vec2(dy.z * s.x, dy.y)).rgb * tpW.x;
  if (tpW.y > 0.0) c += sampleNoRepeat(tex, vec2(p.x * s.y, p.z), vec2(dx.x * s.y, dx.z), vec2(dy.x * s.y, dy.z)).rgb * tpW.y;
  if (tpW.z > 0.0) c += sampleNoRepeat(tex, vec2(-p.x * s.z, p.y), vec2(-dx.x * s.z, dx.y), vec2(-dy.x * s.z, dy.y)).rgb * tpW.z;
  return c;
}
// Babylon's detail normals reconstruct positive Z from two signed components
// (ShadersInclude/bumpFragment.js). Our authored rock map stores micro XY in RG
// and macro XY in BA; other layers keep their original RGB normal encoding.
vec3 unpackTerrainNormal(vec4 value, int pair) {
  if (pair == 0) return value.xyz * 2.0 - 1.0;
  vec2 xy = (pair == 1 ? value.rg : value.ba) * 2.0 - 1.0;
  return vec3(xy, sqrt(1.0 - clamp(dot(xy, xy), 0.0, 1.0)));
}
vec3 triplanarNormal(sampler2D tex, float tileMetres, int pair) {
  vec3 n = tpN, s = tpS, p = vPositionW / tileMetres, dx = tpDx / tileMetres, dy = tpDy / tileMetres, c = vec3(0.0);
  if (tpW.x > 0.0) {
    vec3 t = unpackTerrainNormal(pair == 2 ? textureGrad(tex, vec2(p.z * s.x, p.y), vec2(dx.z * s.x, dx.y), vec2(dy.z * s.x, dy.y)) : sampleNoRepeat(tex, vec2(p.z * s.x, p.y), vec2(dx.z * s.x, dx.y), vec2(dy.z * s.x, dy.y)), pair);
    t.x *= s.x;
    c += vec3(t.xy + n.zy, abs(t.z) * n.x).zyx * tpW.x;
  }
  if (tpW.y > 0.0) {
    vec3 t = unpackTerrainNormal(sampleNoRepeat(tex, vec2(p.x * s.y, p.z), vec2(dx.x * s.y, dx.z), vec2(dy.x * s.y, dy.z)), pair);
    t.x *= s.y;
    c += vec3(t.xy + n.xz, abs(t.z) * n.y).xzy * tpW.y;
  }
  if (tpW.z > 0.0) {
    vec3 t = unpackTerrainNormal(pair == 2 ? textureGrad(tex, vec2(-p.x * s.z, p.y), vec2(-dx.x * s.z, dx.y), vec2(-dy.x * s.z, dy.y)) : sampleNoRepeat(tex, vec2(-p.x * s.z, p.y), vec2(-dx.x * s.z, dx.y), vec2(-dy.x * s.z, dy.y)), pair);
    t.x *= -s.z;
    c += vec3(t.xy + n.xy, abs(t.z) * n.z) * tpW.z;
  }
  return normalize(c);
}
vec3 triplanarNormal(sampler2D tex, float tileMetres) {
  return triplanarNormal(tex, tileMetres, 0);
}
vec3 triplanarArray(sampler2DArray tex, float tileMetres, float layer) {
  vec3 s = tpS, p = vPositionW / tileMetres, dx = tpDx / tileMetres, dy = tpDy / tileMetres, c = vec3(0.0);
  if (tpW.x > 0.0) c += textureGrad(tex, vec3(p.z * s.x, p.y, layer), vec2(dx.z * s.x, dx.y), vec2(dy.z * s.x, dy.y)).rgb * tpW.x;
  if (tpW.y > 0.0) c += sampleNoRepeatArray(tex, vec2(p.x * s.y, p.z), layer, vec2(dx.x * s.y, dx.z), vec2(dy.x * s.y, dy.z)).rgb * tpW.y;
  if (tpW.z > 0.0) c += textureGrad(tex, vec3(-p.x * s.z, p.y, layer), vec2(-dx.x * s.z, dx.y), vec2(-dy.x * s.z, dy.y)).rgb * tpW.z;
  return c;
}
vec3 triplanarNormalArray(sampler2DArray tex, float tileMetres, float layer) {
  vec3 n = tpN, s = tpS, p = vPositionW / tileMetres, dx = tpDx / tileMetres, dy = tpDy / tileMetres, c = vec3(0.0);
  if (tpW.x > 0.0) {
    vec3 t = textureGrad(tex, vec3(p.z * s.x, p.y, layer), vec2(dx.z * s.x, dx.y), vec2(dy.z * s.x, dy.y)).xyz * 2.0 - 1.0;
    t.x *= s.x;
    c += vec3(t.xy + n.zy, abs(t.z) * n.x).zyx * tpW.x;
  }
  if (tpW.y > 0.0) {
    vec3 t = sampleNoRepeatArray(tex, vec2(p.x * s.y, p.z), layer, vec2(dx.x * s.y, dx.z), vec2(dy.x * s.y, dy.z)).xyz * 2.0 - 1.0;
    t.x *= s.y;
    c += vec3(t.xy + n.xz, abs(t.z) * n.y).xzy * tpW.y;
  }
  if (tpW.z > 0.0) {
    vec3 t = textureGrad(tex, vec3(-p.x * s.z, p.y, layer), vec2(-dx.x * s.z, dx.y), vec2(-dy.x * s.z, dy.y)).xyz * 2.0 - 1.0;
    t.x *= -s.z;
    c += vec3(t.xy + n.xy, abs(t.z) * n.z) * tpW.z;
  }
  return normalize(c);
}
// The lake bed's depth bands (ISSUES.md B4), in array-layer order: bright shore sand at the water's
// edge, moss on the submerged slopes from roughly 26 to 140 m, fine sediment on the dim plain,
// dark basalt in the deep basins, rust-gold bacterial mats in patches over the basalt. Each band
// feathers into the next over tens of metres, the sample depth is roughened by noise so no
// boundary follows a contour line, and slope steers the choice: sediment settles on flats while
// steep walls show bare basalt.
float bedW0, bedW1, bedW2, bedW3, bedW4, bedSum;
void bedWeights(float depth, vec2 xz, float up) {
  float wobble = mix(8.0, 28.0, smoothstep(30.0, 250.0, depth));
  float d = depth + (valueNoise(xz / 41.0) - 0.5) * 2.0 * wobble + (valueNoise(xz / 7.0) - 0.5) * 3.0;
  bedW0 = 1.0 - smoothstep(16.0, 30.0, d);
  bedW1 = smoothstep(20.0, 30.0, d) * (1.0 - smoothstep(125.0, 150.0, d));
  bedW2 = smoothstep(135.0, 160.0, d) * (1.0 - smoothstep(230.0, 280.0, d));
  bedW3 = smoothstep(250.0, 300.0, d);
  float shift = bedW2 * (1.0 - smoothstep(0.35, 0.6, up));
  bedW2 -= shift; bedW3 += shift;
  shift = bedW1 * (1.0 - smoothstep(0.25, 0.45, up));
  bedW1 -= shift; bedW3 += shift;
  float blotch = valueNoise(xz / 9.0) * 0.55 + valueNoise(xz / 31.0) * 0.45;
  float cover = mix(0.72, 0.42, smoothstep(280.0, 520.0, d));
  float mats = bedW3 * smoothstep(cover, cover + 0.15, blotch) * smoothstep(250.0, 300.0, d) * 0.85;
  bedW3 -= mats; bedW4 = mats;
  bedSum = bedW0 + bedW1 + bedW2 + bedW3 + bedW4;
}
float causticLayer(vec2 p, float t) {
  vec2 q = p + 0.5 * vec2(sin(p.y * 1.3 + t * 0.7), cos(p.x * 1.1 - t * 0.6));
  float a = sin(q.x * 2.1 + t) + sin(q.y * 1.7 - t * 0.9) + sin((q.x - q.y) * 1.3 + t * 0.5);
  return pow(1.0 - abs(a) / 3.0, 10.0);
}
float caustics(vec2 p, float t) {
  return 0.5 * (causticLayer(p, t) + causticLayer(p * 1.37 + 7.0, t * 1.3));
}
float underwaterWeight() {
  float lake = smoothstep(0.2, 0.5, texture2D(lakeMask, vPositionW.xz / ${f(l.sizeMetres, 1)} + 0.5).r);
  lakeShoreCoverage = lake;
  return (1.0 - smoothstep(${f(l.waterLevel - 1, 1)}, ${f(l.waterLevel, 1)}, vPositionW.y)) * lake;
}
// The shore stays pale gravel: the attempt to mottle dark basalt rubble into it near the
// water (e98e69d) read as camouflage blotches, so it is gone rather than tuned.
`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
triplanarSetup();
vec3 splat = texture2D(splatMap, vPositionW.xz / ${f(l.sizeMetres, 1)} + 0.5).rgb;
float rockWeight = clamp(1.0 - splat.r - splat.g - splat.b, 0.0, 1.0);
float underwater = underwaterWeight();
float substrate = 4.0;
// Water takes the daylight out with depth: this is the share of it left on the lake bed here, and
// what the sun, the moon and the sky are dimmed by below. Lamps the player carries are not dimmed.
float bedDepth = max(${f(l.waterLevel, 1)} - vPositionW.y, 0.0) * underwater;
float daylightLeft = exp(-bedDepth / ${f(l.daylightDepthMetres, 1)});
vec3 land = vec3(0.0), lakeBed = vec3(0.0);
if (underwater < 1.0) {
  substrate = mappedSubstrate(vPositionW.xz / ${f(l.sizeMetres, 1)} + 0.5);
${l.cinder ? `  // Loose cinder replaces mineral ground, while crown litter stays independent.
  if (substrate > 0.5 && substrate < 1.5) {
    land = toLinearSpace(triplanarArray(bedAlbedo, ${f(l.cinder.tileMetres)}, ${f(l.cinder.arrayLayer, 1)})) * (1.0 - splat.g)
      + ${layer(1)} * splat.g;
  } else {` : ""}
  if (rockWeight > ${f(MIN_LAYER, 4)}) land += surfaceAlbedo * toLinearSpace(triplanar(rockAlbedo, ${f(l.rockTileMetres)}) * strataTint(vPositionW, tpN.y)) * rockWeight;
${[0, 1, 2].map(i => `  if (${w(i)} > ${f(MIN_LAYER, 4)}) land += ${layer(i)} * ${w(i)};`).join("\n")}
  // Wet ground darkens; the old large-scale albedo mottling is gone (read as camouflage).
  // Geology grades the mineral surface; needle litter and the distant canopy
  // retain their own colours. The surveyed layer weights remain unchanged.
${l.cinder ? "  }" : ""}
  land *= mix(vec3(1.0), mappedSubstrateTintSoft(vPositionW.xz / ${f(l.sizeMetres, 1)} + 0.5), 1.0 - splat.g);
  land *= 1.0 - 0.35 * weatherWetness;
  float forest = clamp(splat.g / ${f(NEEDLES_UNDER_FULL_CANOPY, 2)}, 0.0, 1.0)
    * smoothstep(forestBand.x, forestBand.y, distance(vPositionW, vEyePosition.xyz));
  land = mix(land, vec3(${CANOPY_COLOUR}), ${f(CANOPY_COVER, 2)} * forest);
  // Open deposits carry the layer cake too, gently: pumice, ash and old-flow lines by elevation.
  float openGravel = splat.r * (1.0 - clamp(forest, 0.0, 1.0));
  if (openGravel > ${f(MIN_LAYER, 4)}) land *= mix(vec3(1.0), slopeBands(vPositionW), clamp(openGravel, 0.0, 1.0));
}
if (underwater > 0.0) {
  bedWeights(bedDepth, vPositionW.xz, tpN.y);
  vec3 bed = vec3(0.0);
  if (bedW0 > ${f(MIN_LAYER, 4)}) bed += toLinearSpace(triplanarArray(bedAlbedo, ${bedT(0)}, 0.0)) * bedW0;
  if (bedW1 > ${f(MIN_LAYER, 4)}) bed += toLinearSpace(triplanarArray(bedAlbedo, ${bedT(1)}, 1.0)) * bedW1;
  if (bedW2 > ${f(MIN_LAYER, 4)}) bed += toLinearSpace(triplanarArray(bedAlbedo, ${bedT(2)}, 2.0)) * bedW2;
  if (bedW3 > ${f(MIN_LAYER, 4)}) bed += toLinearSpace(triplanarArray(bedAlbedo, ${bedT(3)}, 3.0)) * bedW3;
  if (bedW4 > ${f(MIN_LAYER, 4)}) bed += toLinearSpace(triplanarArray(bedAlbedo, ${bedT(4)}, 4.0)) * bedW4;
  lakeBed = surfaceAlbedo * (bed / max(bedSum, 1e-4))
  * (1.0 + causticsStrength * exp(-bedDepth / ${f(CAUSTICS_DEPTH_METRES, 1)}) * caustics(vPositionW.xz / 1.5, causticsTime));
}
surfaceAlbedo = mix(land, lakeBed, underwater);
`,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: `
vec3 landN = vec3(0.0), bedN = vec3(0.0);
if (underwater < 1.0) {
${l.cinder ? `  // Cinder normals belong in the normal hook, after substrate is mapped
  // by the colour hook and landN is declared; match the WGSL branch's scope.
  if (substrate > 0.5 && substrate < 1.5) {
    landN = normalize(triplanarNormalArray(bedNormal, ${f(l.cinder.tileMetres)}, ${f(l.cinder.arrayLayer, 1)}) * (1.0 - splat.g)
      + triplanarNormal(needlesTexNormal, ${f(layers[1].tileMetres)}, 0) * splat.g);
  } else {` : ""}
  vec3 rockN = vec3(0.0);
  if (${rockNormalNeeded}) rockN = triplanarNormal(rockNormal, ${f(l.rockTileMetres)}, ${l.reliefTileMetres ? 1 : 0});
  landN = rockN * rockWeight;
${layers.map((layer, i) => `  if (${w(i)} > ${f(MIN_LAYER, 4)}) landN += ${layer.normalUrl
    ? `triplanarNormal(${layer.sampler}Normal, ${f(layer.tileMetres, 1)})` : "rockN"} * ${w(i)};`).join("\n")}
  landN = normalize(landN);
${l.reliefTileMetres ? `  // Add only the relief's departure from the baked slope, preserving the
  // fine material normal and leaving litter, soil and the lake bed unaffected.
  if (rockWeight > ${f(MIN_LAYER, 4)}) {
    vec3 reliefN = triplanarNormal(rockNormal, ${f(l.reliefTileMetres)}, 2);
    landN = normalize(landN + (reliefN - tpN) * rockWeight);
  }` : ""}
${l.cinder ? "  }" : ""}
}
if (underwater > 0.0) {
  bedN = vec3(0.0);
  if (bedW0 > ${f(MIN_LAYER, 4)}) bedN += triplanarNormalArray(bedNormal, ${bedT(0)}, 0.0) * bedW0;
  if (bedW1 > ${f(MIN_LAYER, 4)}) bedN += triplanarNormalArray(bedNormal, ${bedT(1)}, 1.0) * bedW1;
  if (bedW2 > ${f(MIN_LAYER, 4)}) bedN += triplanarNormalArray(bedNormal, ${bedT(2)}, 2.0) * bedW2;
  if (bedW3 > ${f(MIN_LAYER, 4)}) bedN += triplanarNormalArray(bedNormal, ${bedT(3)}, 3.0) * bedW3;
  if (bedW4 > ${f(MIN_LAYER, 4)}) bedN += triplanarNormalArray(bedNormal, ${bedT(4)}, 4.0) * bedW4;
  bedN = normalize(bedN);
}
normalW = mix(landN, bedN, underwater);
`,
      // Sky visibility dims only the light that comes from the sky, never the sun or the moon; the
      // depth of water dims all three.
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
#ifdef REFLECTION
finalIrradiance *= skyVisibility * daylightLeft;
finalRadianceScaled *= skyVisibility * daylightLeft;
#endif
`,
      ...this.daylightOnLights(i => `diffuse${i}.rgb *= daylightLeft;`),
    };
  }

  // One hook per light, where Babylon has just read the light's colour: the sun and the moon
  // (directional) and a sky fill (hemispheric) are daylight and take the water's dimming; a spot or
  // point light is a lamp down there with the player and keeps its full strength.
  private daylightOnLights(dim: (light: number) => string): { [point: string]: string } {
    const points: { [point: string]: string } = {};
    for (let i = 0; i < LIGHTS; i++) {
      points[`CUSTOM_LIGHT${i}_COLOR`] = `
#if defined(DIRLIGHT${i}) || defined(HEMILIGHT${i})
${dim(i)}
#endif
`;
    }
    return points;
  }

  private wgsl() {
    const l = this.look, layers = l.groundLayers;
    const isBedArray = (name: string) => name === "bedAlbedo" || name === "bedNormal";
    const samplers = Object.keys(this.textures).filter(n => !isBedArray(n))
      .map(name => `${OWN_SAMPLER.includes(name) ? `var ${name}Sampler: sampler;\n` : ""}var ${name}: texture_2d<f32>;`).join("\n")
      + "\nvar bedAlbedo: texture_2d_array<f32>;\nvar bedNormal: texture_2d_array<f32>;";
    const tex = (name: string) => `${name}, ${TILED_SAMPLER}Sampler`;
    const bedT = (i: number) => f(l.bedTiles[i], 1);
    const layer = (i: number) =>
      `toLinearSpaceVec3(triplanar(${tex(layers[i].sampler)}, ${f(layers[i].tileMetres, 1)}) * ${f(layers[i].tint, 2)})` +
      (layers[i].aoUrl ? ` * triplanar(${tex(`${layers[i].sampler}AO`)}, ${f(layers[i].tileMetres, 1)}).r` : "");
    const w = (i: number) => `splat.${"rgb"[i]}`;
    const rockNormalNeeded = [`rockWeight > ${f(MIN_LAYER, 4)}`,
      ...layers.flatMap((layer, i) => layer.normalUrl ? [] : [`${w(i)} > ${f(MIN_LAYER, 4)}`])].join(" || ");
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
${samplers}
fn triplanarWeights(n: vec3f) -> vec3f {
   let a = abs(n);
   let n2 = a * a;
   var w = n2 * n2;
  w /= w.x + w.y + w.z;
  w *= step(vec3f(${f(MIN_PROJECTION)}), w);
  return w / (w.x + w.y + w.z);
}
fn axisSign(n: vec3f) -> vec3f { return step(vec3f(0.0), n) * 2.0 - 1.0; }
// Same registered, categorical alpha lookup as GLSL; no additional binding.
fn mappedSubstrate(uv: vec2f) -> f32 {
  let size = vec2i(textureDimensions(splatMap, 0));
  let pixel = clamp(vec2i(floor(uv * vec2f(size))), vec2i(0), size - vec2i(1));
  return floor(textureLoad(splatMap, pixel, 0).a * 4.0 + 0.5);
}
fn mappedSubstrateTint(substrate: f32) -> vec3f {
  if (substrate < 0.5) { return vec3f(0.72, 0.76, 0.80); }
  if (substrate < 1.5) { return vec3f(1.0); }
  if (substrate < 2.5) { return vec3f(4.50, 2.20, 1.00); }
  if (substrate < 3.5) { return vec3f(1.35, 1.32, 1.25); }
  return vec3f(1.0);
}
// Geology tint at a contact: blend the four neighbouring texels' tints
// bilinearly at a uv jittered by sub-texel value noise, so the contact is an
// irregular soft edge instead of a 4.4 m pixel staircase. The class itself is
// still the single nearest texel (the cinder branch tests it), only the tint
// is blended here. textureLoad + pure math, so it stays legal inside the
// non-uniform underwater branch (no derivatives, no textureSample gradients).
fn mappedSubstrateTintSoft(uv: vec2f) -> vec3f {
  let size = vec2i(textureDimensions(splatMap, 0));
  let oneTexel = vec2f(1.0) / vec2f(size);
  // Jitter of about one texel, varying every few tens of metres, so the contact
  // breaks up the texel grid instead of running straight along it.
  let p = uv + (valueNoise(uv * 100.0) - 0.5) * 2.0 * oneTexel;
  let c = p * vec2f(size);
  let base = clamp(vec2i(floor(c)), vec2i(0), size - vec2i(2));
  let f = clamp(fract(c), vec2f(0.0), vec2f(1.0));
  let s00 = floor(textureLoad(splatMap, base, 0).a * 4.0 + 0.5);
  let s10 = floor(textureLoad(splatMap, base + vec2i(1, 0), 0).a * 4.0 + 0.5);
  let s01 = floor(textureLoad(splatMap, base + vec2i(0, 1), 0).a * 4.0 + 0.5);
  let s11 = floor(textureLoad(splatMap, base + vec2i(1, 1), 0).a * 4.0 + 0.5);
  let t00 = mappedSubstrateTint(s00);
  let t10 = mappedSubstrateTint(s10);
  let t01 = mappedSubstrateTint(s01);
  let t11 = mappedSubstrateTint(s11);
  let top = mix(t00, t10, f.x);
  let bottom = mix(t01, t11, f.x);
  return mix(top, bottom, f.y);
}
fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn valueNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2f(1.0, 0.0)), u.x),
             mix(hash12(i + vec2f(0.0, 1.0)), hash12(i + vec2f(1.0, 1.0)), u.x), u.y);
}
// Same offset blend and micro-normal alignment as the GLSL path.
fn sampleNoRepeat(tex: texture_2d<f32>, samp: sampler, uv: vec2f, dx: vec2f, dy: vec2f) -> vec4f {
  let l = valueNoise(uv * 0.3) * 8.0;
  let i = floor(l);
  let a = textureSampleGrad(tex, samp, uv + sin(vec2f(3.0, 7.0) * i), dx, dy);
  let b = textureSampleGrad(tex, samp, uv + sin(vec2f(3.0, 7.0) * (i + 1.0)), dx, dy);
  return mix(a, b, smoothstep(0.35, 0.65, l - i));
}
fn sampleNoRepeatArray(tex: texture_2d_array<f32>, samp: sampler, uv: vec2f, layer: i32, dx: vec2f, dy: vec2f) -> vec4f {
  let l = valueNoise(uv * 0.3) * 8.0;
  let i = floor(l);
  let a = textureSampleGrad(tex, samp, uv + sin(vec2f(3.0, 7.0) * i), layer, dx, dy);
  let b = textureSampleGrad(tex, samp, uv + sin(vec2f(3.0, 7.0) * (i + 1.0)), layer, dx, dy);
  return mix(a, b, smoothstep(0.35, 0.65, l - i));
}
// Same shoreline-mask registration as the GLSL path.
var<private> lakeShoreCoverage: f32;
// Neutral volcanic-rock grade with irregular weathering and scree accents.
fn strataTint(p: vec3f, up: f32) -> vec3f {
  let cold = vec3f(1.42, 1.49, 1.62);
  let rust = smoothstep(0.55, 0.8, valueNoise(p.xz / 41.0 + p.y * 0.023)) * smoothstep(0.62, 0.82, valueNoise(p.xz / 13.0 + p.y * 0.05 + 3.7));
  let lichen = smoothstep(0.62, 0.8, valueNoise(p.xz / 7.0 + 9.1)) * smoothstep(0.45, 0.7, up);
  var tint = mix(vec3f(1.0), vec3f(1.25, 0.72, 0.45), rust * 0.35);
  tint = mix(tint, vec3f(1.05, 1.08, 0.98), lichen * 0.5);
  // A single near-shore weathering ring, rather than recurring geological bands.
  let aboveLake = p.y - ${f(l.waterLevel, 1)};
  let shoreRing = smoothstep(0.5, 1.3, aboveLake)
    * (1.0 - smoothstep(3.5, 5.0, aboveLake)) * lakeShoreCoverage;
  tint *= mix(vec3f(1.0), vec3f(1.15, 0.8, 0.65), shoreRing * 0.6);
  // Vertical structure dominates the reference: fractures and dikes run down the crag, while
  // horizontal bands read as contour-following. Streaks vary fast across the face and slow along
  // the fall line, gated by steepness (1 on cliffs) so the flats keep their bedding.
  let steep = 1.0 - clamp(up, 0.0, 1.0);
  let streak = valueNoise(vec2f((p.x + p.z) * 0.11, p.y * 0.012)) - 0.5;
  let dike = smoothstep(0.68, 0.8, valueNoise(vec2f((p.x - p.z) * 0.045 + 7.3, p.y * 0.006)));
  tint *= 1.0 + (streak * 0.22 - dike * 0.18) * steep;
  // Pale scree chutes: near-white talus tracks run rim-to-waterline down the drainages.
  let chute = smoothstep(0.65, 0.8, valueNoise(p.xz / 37.0 + p.y * 0.01)) * steep;
  tint = mix(tint, vec3f(1.9, 1.9, 1.85), chute * 0.55);
  return cold * tint * (0.88 + 0.24 * valueNoise(p.xz / 121.0));
}
// Gentle volcanic layering on open deposits: pumice, ash and old-flow lines by elevation.
fn slopeBands(p: vec3f) -> vec3f {
  let wobble = (valueNoise(p.xz / 47.0) - 0.5) * 24.0;
  let f = fract((p.y + wobble) / 34.0);
  let along = smoothstep(0.35, 0.7, valueNoise(vec2f(p.x * 0.008 + p.z * 0.013, p.y * 0.02)));
  let tint = mix(vec3f(0.995, 0.99, 0.985), vec3f(1.045, 1.0, 0.93), smoothstep(0.3, 0.55, f) * along);
  return mix(tint, vec3f(0.93, 0.92, 0.91), smoothstep(0.78, 0.92, f) * along * 0.5);
}
var<private> tpN: vec3f;
var<private> tpW: vec3f;
var<private> tpS: vec3f;
var<private> tpDx: vec3f;
var<private> tpDy: vec3f;
// Authored RG world-normal east/north and B sky visibility, registered per draw
// to the padded leaf crop or distant map, identically to the GLSL path.
var<private> skyVisibility: f32;
fn bakedNormal(position: vec3f) -> vec3f {
  let baked = textureSample(normalAo, normalAoSampler, (position.xz - uniforms.normalMapRect.xy) / uniforms.normalMapRect.zw).rgb;
  let nxz = baked.rg * 2.0 - 1.0;
  skyVisibility = baked.b;
  return normalize(vec3f(nxz.x, sqrt(clamp(1.0 - dot(nxz, nxz), 0.0, 1.0)), nxz.y));
}
fn triplanarSetup(position: vec3f) {
  tpN = bakedNormal(position);
  tpW = triplanarWeights(tpN);
  tpS = axisSign(tpN);
  tpDx = dpdx(position);
  tpDy = dpdy(position);
}
fn triplanar(tex: texture_2d<f32>, samp: sampler, tileMetres: f32) -> vec3f {
  let s = tpS;
  let p = fragmentInputs.vPositionW / tileMetres;
  let dx = tpDx / tileMetres;
  let dy = tpDy / tileMetres;
  var c = vec3f(0.0);
  if (tpW.x > 0.0) { c += sampleNoRepeat(tex, samp, vec2f(p.z * s.x, p.y), vec2f(dx.z * s.x, dx.y), vec2f(dy.z * s.x, dy.y)).rgb * tpW.x; }
  if (tpW.y > 0.0) { c += sampleNoRepeat(tex, samp, vec2f(p.x * s.y, p.z), vec2f(dx.x * s.y, dx.z), vec2f(dy.x * s.y, dy.z)).rgb * tpW.y; }
  if (tpW.z > 0.0) { c += sampleNoRepeat(tex, samp, vec2f(-p.x * s.z, p.y), vec2f(-dx.x * s.z, dx.y), vec2f(-dy.x * s.z, dy.y)).rgb * tpW.z; }
  return c;
}
// Identical RG/BA decoding to the GLSL path, matching Babylon's native
// two-component detail-normal convention without another texture binding.
fn unpackTerrainNormal(value: vec4f, pair: i32) -> vec3f {
  if (pair == 0) { return value.xyz * 2.0 - 1.0; }
  let xy = select(value.ba, value.rg, pair == 1) * 2.0 - 1.0;
  return vec3f(xy, sqrt(1.0 - clamp(dot(xy, xy), 0.0, 1.0)));
}
fn triplanarNormal(tex: texture_2d<f32>, samp: sampler, tileMetres: f32, pair: i32) -> vec3f {
  let n = tpN;
  let s = tpS;
  let p = fragmentInputs.vPositionW / tileMetres;
  let dx = tpDx / tileMetres;
  let dy = tpDy / tileMetres;
  var c = vec3f(0.0);
  if (tpW.x > 0.0) {
    var sampled: vec4f;
    if (pair == 2) { sampled = textureSampleGrad(tex, samp, vec2f(p.z * s.x, p.y), vec2f(dx.z * s.x, dx.y), vec2f(dy.z * s.x, dy.y)); }
    else { sampled = sampleNoRepeat(tex, samp, vec2f(p.z * s.x, p.y), vec2f(dx.z * s.x, dx.y), vec2f(dy.z * s.x, dy.y)); }
    var t = unpackTerrainNormal(sampled, pair);
    t.x *= s.x;
    c += vec3f(t.xy + n.zy, abs(t.z) * n.x).zyx * tpW.x;
  }
  if (tpW.y > 0.0) {
    var t = unpackTerrainNormal(sampleNoRepeat(tex, samp, vec2f(p.x * s.y, p.z), vec2f(dx.x * s.y, dx.z), vec2f(dy.x * s.y, dy.z)), pair);
    t.x *= s.y;
    c += vec3f(t.xy + n.xz, abs(t.z) * n.y).xzy * tpW.y;
  }
  if (tpW.z > 0.0) {
    var sampled: vec4f;
    if (pair == 2) { sampled = textureSampleGrad(tex, samp, vec2f(-p.x * s.z, p.y), vec2f(-dx.x * s.z, dx.y), vec2f(-dy.x * s.z, dy.y)); }
    else { sampled = sampleNoRepeat(tex, samp, vec2f(-p.x * s.z, p.y), vec2f(-dx.x * s.z, dx.y), vec2f(-dy.x * s.z, dy.y)); }
    var t = unpackTerrainNormal(sampled, pair);
    t.x *= -s.z;
    c += vec3f(t.xy + n.xy, abs(t.z) * n.z) * tpW.z;
  }
  return normalize(c);
}
fn triplanarArray(tex: texture_2d_array<f32>, samp: sampler, tileMetres: f32, layer: i32) -> vec3f {
  let s = tpS;
  let p = fragmentInputs.vPositionW / tileMetres;
  let dx = tpDx / tileMetres;
  let dy = tpDy / tileMetres;
  var c = vec3f(0.0);
  if (tpW.x > 0.0) { c += textureSampleGrad(tex, samp, vec2f(p.z * s.x, p.y), layer, vec2f(dx.z * s.x, dx.y), vec2f(dy.z * s.x, dy.y)).rgb * tpW.x; }
  if (tpW.y > 0.0) { c += sampleNoRepeatArray(tex, samp, vec2f(p.x * s.y, p.z), layer, vec2f(dx.x * s.y, dx.z), vec2f(dy.x * s.y, dy.z)).rgb * tpW.y; }
  if (tpW.z > 0.0) { c += textureSampleGrad(tex, samp, vec2f(-p.x * s.z, p.y), layer, vec2f(-dx.x * s.z, dx.y), vec2f(-dy.x * s.z, dy.y)).rgb * tpW.z; }
  return c;
}
fn triplanarNormalArray(tex: texture_2d_array<f32>, samp: sampler, tileMetres: f32, layer: i32) -> vec3f {
  let n = tpN;
  let s = tpS;
  let p = fragmentInputs.vPositionW / tileMetres;
  let dx = tpDx / tileMetres;
  let dy = tpDy / tileMetres;
  var c = vec3f(0.0);
  if (tpW.x > 0.0) {
    var t = textureSampleGrad(tex, samp, vec2f(p.z * s.x, p.y), layer, vec2f(dx.z * s.x, dx.y), vec2f(dy.z * s.x, dy.y)).xyz * 2.0 - 1.0;
    t.x *= s.x;
    c += vec3f(t.xy + n.zy, abs(t.z) * n.x).zyx * tpW.x;
  }
  if (tpW.y > 0.0) {
    var t = sampleNoRepeatArray(tex, samp, vec2f(p.x * s.y, p.z), layer, vec2f(dx.x * s.y, dx.z), vec2f(dy.x * s.y, dy.z)).xyz * 2.0 - 1.0;
    t.x *= s.y;
    c += vec3f(t.xy + n.xz, abs(t.z) * n.y).xzy * tpW.y;
  }
  if (tpW.z > 0.0) {
    var t = textureSampleGrad(tex, samp, vec2f(-p.x * s.z, p.y), layer, vec2f(-dx.x * s.z, dx.y), vec2f(-dy.x * s.z, dy.y)).xyz * 2.0 - 1.0;
    t.x *= -s.z;
    c += vec3f(t.xy + n.xy, abs(t.z) * n.z) * tpW.z;
  }
  return normalize(c);
}
// The lake bed's depth bands (ISSUES.md B4), in array-layer order: bright shore sand at the water's
// edge, moss on the submerged slopes from roughly 26 to 140 m, fine sediment on the dim plain,
// dark basalt in the deep basins, rust-gold bacterial mats in patches over the basalt. Each band
// feathers into the next over tens of metres, the sample depth is roughened by noise so no
// boundary follows a contour line, and slope steers the choice: sediment settles on flats while
// steep walls show bare basalt.
var<private> bedW0: f32;
var<private> bedW1: f32;
var<private> bedW2: f32;
var<private> bedW3: f32;
var<private> bedW4: f32;
var<private> bedSum: f32;
fn bedWeights(depth: f32, xz: vec2f, up: f32) {
  let wobble = mix(8.0, 28.0, smoothstep(30.0, 250.0, depth));
  let d = depth + (valueNoise(xz / 41.0) - 0.5) * 2.0 * wobble + (valueNoise(xz / 7.0) - 0.5) * 3.0;
  bedW0 = 1.0 - smoothstep(16.0, 30.0, d);
  bedW1 = smoothstep(20.0, 30.0, d) * (1.0 - smoothstep(125.0, 150.0, d));
  bedW2 = smoothstep(135.0, 160.0, d) * (1.0 - smoothstep(230.0, 280.0, d));
  bedW3 = smoothstep(250.0, 300.0, d);
  var shift = bedW2 * (1.0 - smoothstep(0.35, 0.6, up));
  bedW2 -= shift; bedW3 += shift;
  shift = bedW1 * (1.0 - smoothstep(0.25, 0.45, up));
  bedW1 -= shift; bedW3 += shift;
  let blotch = valueNoise(xz / 9.0) * 0.55 + valueNoise(xz / 31.0) * 0.45;
  let cover = mix(0.72, 0.42, smoothstep(280.0, 520.0, d));
  let mats = bedW3 * smoothstep(cover, cover + 0.15, blotch) * smoothstep(250.0, 300.0, d) * 0.85;
  bedW3 -= mats; bedW4 = mats;
  bedSum = bedW0 + bedW1 + bedW2 + bedW3 + bedW4;
}
fn causticLayer(p: vec2f, t: f32) -> f32 {
  let q = p + 0.5 * vec2f(sin(p.y * 1.3 + t * 0.7), cos(p.x * 1.1 - t * 0.6));
  let a = sin(q.x * 2.1 + t) + sin(q.y * 1.7 - t * 0.9) + sin((q.x - q.y) * 1.3 + t * 0.5);
  return pow(1.0 - abs(a) / 3.0, 10.0);
}
fn caustics(p: vec2f, t: f32) -> f32 {
  return 0.5 * (causticLayer(p, t) + causticLayer(p * 1.37 + 7.0, t * 1.3));
}
fn underwaterWeight() -> f32 {
  let lake = smoothstep(0.2, 0.5, textureSample(lakeMask, ${TILED_SAMPLER}Sampler, fragmentInputs.vPositionW.xz / ${f(l.sizeMetres, 1)} + 0.5).r);
  lakeShoreCoverage = lake;
  return (1.0 - smoothstep(${f(l.waterLevel - 1, 1)}, ${f(l.waterLevel, 1)}, fragmentInputs.vPositionW.y)) * lake;
}
// The shore stays pale gravel: the rubble mottling is gone (read as camouflage, see GLSL half).
`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
triplanarSetup(fragmentInputs.vPositionW);
let splat = textureSample(splatMap, splatMapSampler, fragmentInputs.vPositionW.xz / ${f(l.sizeMetres, 1)} + 0.5).rgb;
let rockWeight = clamp(1.0 - splat.r - splat.g - splat.b, 0.0, 1.0);
let underwater = underwaterWeight();
var substrate = 4.0;
// Water takes the daylight out with depth: this is the share of it left on the lake bed here, and
// what the sun, the moon and the sky are dimmed by below. Lamps the player carries are not dimmed.
let bedDepth = max(${f(l.waterLevel, 1)} - fragmentInputs.vPositionW.y, 0.0) * underwater;
let daylightLeft = exp(-bedDepth / ${f(l.daylightDepthMetres, 1)});
var land = vec3f(0.0);
var lakeBed = vec3f(0.0);
if (underwater < 1.0) {
  substrate = mappedSubstrate(fragmentInputs.vPositionW.xz / ${f(l.sizeMetres, 1)} + 0.5);
${l.cinder ? `  // Same authored cinder/litter blend as GLSL.
  if (substrate > 0.5 && substrate < 1.5) {
    land = toLinearSpaceVec3(triplanarArray(bedAlbedo, ${TILED_SAMPLER}Sampler, ${f(l.cinder.tileMetres)}, ${l.cinder.arrayLayer})) * (1.0 - splat.g)
      + ${layer(1)} * splat.g;
  } else {` : ""}
  if (rockWeight > ${f(MIN_LAYER, 4)}) { land += surfaceAlbedo * toLinearSpaceVec3(triplanar(${tex("rockAlbedo")}, ${f(l.rockTileMetres)}) * strataTint(fragmentInputs.vPositionW, tpN.y)) * rockWeight; }
${[0, 1, 2].map(i => `  if (${w(i)} > ${f(MIN_LAYER, 4)}) { land += ${layer(i)} * ${w(i)}; }`).join("\n")}
  // Wet ground darkens; the old large-scale albedo mottling is gone (read as camouflage).
  // Geology grades the mineral surface; needle litter and the distant canopy
  // retain their own colours. The surveyed layer weights remain unchanged.
${l.cinder ? "  }" : ""}
  land *= mix(vec3f(1.0), mappedSubstrateTintSoft(fragmentInputs.vPositionW.xz / ${f(l.sizeMetres, 1)} + 0.5), 1.0 - splat.g);
  land *= 1.0 - 0.35 * uniforms.weatherWetness;
  let forest = clamp(splat.g / ${f(NEEDLES_UNDER_FULL_CANOPY, 2)}, 0.0, 1.0)
    * smoothstep(uniforms.forestBand.x, uniforms.forestBand.y, distance(fragmentInputs.vPositionW, scene.vEyePosition.xyz));
  land = mix(land, vec3f(${CANOPY_COLOUR}), ${f(CANOPY_COVER, 2)} * forest);
  // Open deposits carry the layer cake too, gently: pumice, ash and old-flow lines by elevation.
  let openGravel = splat.r * (1.0 - clamp(forest, 0.0, 1.0));
  if (openGravel > ${f(MIN_LAYER, 4)}) { land *= mix(vec3f(1.0), slopeBands(fragmentInputs.vPositionW), clamp(openGravel, 0.0, 1.0)); }
}
if (underwater > 0.0) {
  bedWeights(bedDepth, fragmentInputs.vPositionW.xz, tpN.y);
  var bed = vec3f(0.0);
  if (bedW0 > ${f(MIN_LAYER, 4)}) { bed += toLinearSpaceVec3(triplanarArray(bedAlbedo, ${TILED_SAMPLER}Sampler, ${bedT(0)}, 0)) * bedW0; }
  if (bedW1 > ${f(MIN_LAYER, 4)}) { bed += toLinearSpaceVec3(triplanarArray(bedAlbedo, ${TILED_SAMPLER}Sampler, ${bedT(1)}, 1)) * bedW1; }
  if (bedW2 > ${f(MIN_LAYER, 4)}) { bed += toLinearSpaceVec3(triplanarArray(bedAlbedo, ${TILED_SAMPLER}Sampler, ${bedT(2)}, 2)) * bedW2; }
  if (bedW3 > ${f(MIN_LAYER, 4)}) { bed += toLinearSpaceVec3(triplanarArray(bedAlbedo, ${TILED_SAMPLER}Sampler, ${bedT(3)}, 3)) * bedW3; }
  if (bedW4 > ${f(MIN_LAYER, 4)}) { bed += toLinearSpaceVec3(triplanarArray(bedAlbedo, ${TILED_SAMPLER}Sampler, ${bedT(4)}, 4)) * bedW4; }
  lakeBed = surfaceAlbedo * (bed / max(bedSum, 1e-4))
    * (1.0 + uniforms.causticsStrength * exp(-bedDepth / ${f(CAUSTICS_DEPTH_METRES, 1)}) * caustics(fragmentInputs.vPositionW.xz / 1.5, uniforms.causticsTime));
}
surfaceAlbedo = mix(land, lakeBed, underwater);
`,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: `
var landN = vec3f(0.0);
var bedN = vec3f(0.0);
if (underwater < 1.0) {
${l.cinder ? `  if (substrate > 0.5 && substrate < 1.5) {
    landN = normalize(triplanarNormalArray(bedNormal, ${TILED_SAMPLER}Sampler, ${f(l.cinder.tileMetres)}, ${l.cinder.arrayLayer}) * (1.0 - splat.g)
      + triplanarNormal(${tex("needlesTexNormal")}, ${f(layers[1].tileMetres)}, 0) * splat.g);
  } else {` : ""}
  var rockN = vec3f(0.0);
  if (${rockNormalNeeded}) { rockN = triplanarNormal(${tex("rockNormal")}, ${f(l.rockTileMetres)}, ${l.reliefTileMetres ? 1 : 0}); }
  landN = rockN * rockWeight;
${layers.map((layer, i) => `  if (${w(i)} > ${f(MIN_LAYER, 4)}) { landN += ${layer.normalUrl
    ? `triplanarNormal(${tex(`${layer.sampler}Normal`)}, ${f(layer.tileMetres, 1)}, 0)` : "rockN"} * ${w(i)}; }`).join("\n")}
  landN = normalize(landN);
${l.reliefTileMetres ? `  // Same authored normal contribution as the GLSL path; explicit gradients
  // in triplanarNormal allow the rock-weight branch on WebGPU.
  if (rockWeight > ${f(MIN_LAYER, 4)}) {
    let reliefN = triplanarNormal(${tex("rockNormal")}, ${f(l.reliefTileMetres)}, 2);
    landN = normalize(landN + (reliefN - tpN) * rockWeight);
  }` : ""}
${l.cinder ? "  }" : ""}
}
if (underwater > 0.0) {
  bedN = vec3f(0.0);
  if (bedW0 > ${f(MIN_LAYER, 4)}) { bedN += triplanarNormalArray(bedNormal, ${TILED_SAMPLER}Sampler, ${bedT(0)}, 0) * bedW0; }
  if (bedW1 > ${f(MIN_LAYER, 4)}) { bedN += triplanarNormalArray(bedNormal, ${TILED_SAMPLER}Sampler, ${bedT(1)}, 1) * bedW1; }
  if (bedW2 > ${f(MIN_LAYER, 4)}) { bedN += triplanarNormalArray(bedNormal, ${TILED_SAMPLER}Sampler, ${bedT(2)}, 2) * bedW2; }
  if (bedW3 > ${f(MIN_LAYER, 4)}) { bedN += triplanarNormalArray(bedNormal, ${TILED_SAMPLER}Sampler, ${bedT(3)}, 3) * bedW3; }
  if (bedW4 > ${f(MIN_LAYER, 4)}) { bedN += triplanarNormalArray(bedNormal, ${TILED_SAMPLER}Sampler, ${bedT(4)}, 4) * bedW4; }
  bedN = normalize(bedN);
}
normalW = mix(landN, bedN, underwater);
`,
      // Sky visibility dims only the light that comes from the sky, never the sun or the moon; the
      // depth of water dims all three.
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
#ifdef REFLECTION
finalIrradiance *= skyVisibility * daylightLeft;
finalRadianceScaled *= skyVisibility * daylightLeft;
#endif
`,
      ...this.daylightOnLights(i => `diffuse${i} = vec4f(diffuse${i}.rgb * daylightLeft, diffuse${i}.a);`),
    };
  }
}
