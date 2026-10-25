import { PBRMaterial, Color3, ShadowGenerator, Texture, Vector4, type Scene, type AbstractMesh } from "@babylonjs/core";
import "../core/ktx2";

// The atmosphere attaches its lighting plugin to stock PBRMaterial instances.
// Keep play objects on that same contract rather than authoring a separate shader.
export function playMaterial(name: string, scene: Scene, colour: Color3, metallic = 0, roughness = 0.85): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = colour.clone();
  material.metallic = metallic;
  material.roughness = roughness;
  return material;
}

// Authored wood maps: one 0.5 m square tile at 1024 px (2048 texels/m), periodic
// so it wraps seamlessly. Albedo is sRGB with the wood hue baked in; the normal
// map is linear data in the conventional GL tangent convention.
const WOOD_ALBEDO_URL = "packs/crater-lake/play/wood_albedo.ktx2";
const WOOD_NORMAL_URL = "packs/crater-lake/play/wood_normal.ktx2";
const WOOD_TILE_METRES = 0.5;

// One shared native Texture pair per scene: every log, stump and fire log reads
// the same authored maps with their full mip chains, so no per-mesh texture cost.
const woodMaps = new WeakMap<Scene, { albedo: Texture; bump: Texture }>();

function woodTextures(scene: Scene): { albedo: Texture; bump: Texture } {
  let maps = woodMaps.get(scene);
  if (!maps) {
    const albedo = new Texture(WOOD_ALBEDO_URL, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    albedo.gammaSpace = true;
    albedo.wrapU = albedo.wrapV = Texture.WRAP_ADDRESSMODE;
    const bump = new Texture(WOOD_NORMAL_URL, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    bump.gammaSpace = false;
    bump.wrapU = bump.wrapV = Texture.WRAP_ADDRESSMODE;
    maps = { albedo, bump };
    woodMaps.set(scene, maps);
  }
  return maps;
}

// Chopped and campfire wood keeps the stock atmosphere-attached PBR contract and
// reads the authored maps instead of a flat brown: albedo factor stays White
// because the hue lives in the map. Hot-swapping stays off like every other PBR.
export function playWoodMaterial(name: string, scene: Scene): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  const maps = woodTextures(scene);
  material.albedoTexture = maps.albedo;
  material.albedoColor = Color3.White();
  material.bumpTexture = maps.bump;
  material.metallic = 0;
  material.roughness = 0.92;
  material.allowShaderHotSwapping = false;
  return material;
}

// Metric side UVs for a native cylinder's [bottom, side, top] faceUV: the side
// tiles circumference/0.5 m along U and height/0.5 m along V so grain density
// matches the 0.5 m bake, while caps keep the default crop. V runs along local Y,
// so the grain follows the log when it is rotated onto its side.
export function woodFaceUV(circumferenceMetres: number, heightMetres: number): Vector4[] {
  return [
    new Vector4(0, 0, 1, 1),
    new Vector4(0, 0, circumferenceMetres / WOOD_TILE_METRES, heightMetres / WOOD_TILE_METRES),
    new Vector4(0, 0, 1, 1),
  ];
}

export function playShadows(mesh: AbstractMesh) {
  mesh.receiveShadows = true;
  const shadows = mesh.getScene().getLightByName("sun")?.getShadowGenerator();
  if (!(shadows instanceof ShadowGenerator)) return;
  shadows.addShadowCaster(mesh);
  // Picked-up logs and completed cooking objects must leave the render list too.
  mesh.onDisposeObservable.addOnce(() => shadows.removeShadowCaster(mesh));
}

// Fire glow is authored for the displayed image. Counter the scene's exposure so
// the same embers do not become a white cone when night exposure rises to 30.
export function compensateEmission(material: PBRMaterial) {
  material.emissiveIntensity = 1 / Math.max(0.001, material.getScene().imageProcessingConfiguration.exposure);
}
