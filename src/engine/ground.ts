import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { MirrorTexture } from "@babylonjs/core/Materials/Textures/mirrorTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { DitheredTileFadeMaterialPlugin } from "@babylonjs/core/Materials/ditheredTileFadeMaterialPlugin";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Plane } from "@babylonjs/core/Maths/math.plane";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { CreateTexture2DArrayFromKTX2Async } from "@babylonjs/core/Materials/Textures/rawTexture2DArray.functions";
import type { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import "../core/ktx2";
import "./meshopt";
import { TerrainMaterialPlugin } from "./TerrainMaterial";
import type { Biome } from "../biomes/Biome";
import { WATER_Y, type GroundManifest } from "./pack";
import { GroundStream } from "./groundStream";
import { GroundNormalTiles } from "./groundNormalTiles";
import { DAYLIGHT_DEPTH_METRES, loadLakeMask } from "./lake";

const MIRROR_SIZE = 512;
const HIDDEN_FROM_CAMERA = 0x10000000;
const RIPPLE_TILE_METRES = 12;
// U19 washout: the anisotropic level the relief-carrying ground textures ask for. 16 is the highest
// any desktop GPU exposes, and groundMaterial never asks for more than the engine reports it can do,
// so on weaker hardware this simply resolves to the hardware limit. Always on — anisotropy is
// sharpness, not a quality trade, so there is nothing for a player setting to decide.
const GRAZING_ANISOTROPY = 16;

export interface Ground {
  manifest: GroundManifest;
  // Share the existing mask with submerged-object lighting; no duplicate upload.
  lakeMask: RawTexture;
  stream: GroundStream;
  surface: TerrainMaterialPlugin;
  normalTiles: GroundNormalTiles | null;
  water: Mesh;
  waterMaterial: PBRMaterial;
  ripples: Texture;
  mirror: MirrorTexture;
  reflectionProxy: Mesh;
}

export async function loadGround(scene: Scene, biome: Biome): Promise<Ground> {
  const manifest: GroundManifest = await (await fetch(`packs/${biome.id}/ground/ground.json`)).json();
  const lakeMask = await loadLakeMask(scene, manifest);
  const { material, surface, anisotropy } = await groundMaterial(scene, manifest, lakeMask);
  // Regional data follows the near geometry's existing request/release lifecycle.
  // The shared material binds a ready authored crop per draw and otherwise uses
  // the small distant map; neither path slices or derives texture data at runtime.
  const normalTiles = manifest.material.normalAoTiles
    ? new GroundNormalTiles(scene, manifest.material.normalAoTiles.tiles,
      (mesh, texture, bounds) => surface.setNormalMap(mesh, texture, bounds), anisotropy)
    : null;
  // Ground levels cross-fade on a timer: the plugin draws each mesh only in its own
  // interval of the screen-fixed Bayer pattern, so two levels meet with no pop.
  const stream = await GroundStream.create(scene, manifest, material,
    DitheredTileFadeMaterialPlugin.GetOrCreate(material), normalTiles ?? undefined);

  const { water, waterMaterial, ripples, mirror } = await loadWater(scene, manifest, biome);
  const proxies = await LoadAssetContainerAsync(manifest.reflectionProxy.url, scene);
  proxies.addAllToScene();
  const reflectionProxy = proxies.meshes.find(mesh => mesh.name === "reflectionProxy") as Mesh;
  reflectionProxy.material = material;
  reflectionProxy.layerMask = HIDDEN_FROM_CAMERA;
  reflectionProxy.isPickable = false;
  reflectionProxy.computeWorldMatrix(true);
  reflectionProxy.freezeWorldMatrix();
  return { manifest, lakeMask, stream, surface, normalTiles, water, waterMaterial, ripples, mirror, reflectionProxy };
}

export async function groundMaterial(scene: Scene, manifest: GroundManifest, lakeMask: RawTexture) {
  const m = manifest.material;
  // U19 washout at the Llao Rock boat viewpoint: from the water the wall stands ~190 m off, is seen
  // at a grazing angle and is heavily minified, so at the default anisotropic level (4) the 2.2 m/texel
  // bake smeared into mush — normalAo above all, which is where that view's relief lives. Every
  // texture whose sharpness at grazing incidence carries relief is therefore filtered at the highest
  // level this GPU supports. The engine clamps the level against its own maxAnisotropy again when it
  // applies it; this `Math.max(1, Math.min(...))` mirrors that same clamp (and keeps the level ≥ 1
  // even on an engine that reports maxAnisotropy 0, as NullEngine does), so the level set here is
  // always a level the engine itself would allow.
  const anisotropy = Math.max(1, Math.min(GRAZING_ANISOTROPY, scene.getEngine().getCaps().maxAnisotropy));
  /** Raise a texture's anisotropic filtering to that level and hand it back, for use at construction. */
  const applyAnisotropy = <T extends Texture>(texture: T): T => {
    texture.anisotropicFilteringLevel = anisotropy;
    return texture;
  };
  const splat = applyAnisotropy(new Texture(m.splatmapUrl, scene, false, true, Texture.BILINEAR_SAMPLINGMODE));
  splat.wrapU = splat.wrapV = Texture.CLAMP_ADDRESSMODE;
  // The bed's depth bands travel as two KTX2 texture arrays (one layer per band, albedo and
  // normals), decoded to RGBA array textures: two bindings instead of ten 2D ones.
  let [bedAlbedo, bedNormal] = await Promise.all([
    CreateTexture2DArrayFromKTX2Async(scene, m.lakeBed.albedoArrayUrl),
    CreateTexture2DArrayFromKTX2Async(scene, m.lakeBed.normalArrayUrl),
  ]);
  // RawTexture2DArray is a Texture, so the same anisotropicFilteringLevel property applies, and it
  // samples trilinearly by default — anisotropy reaches these arrays as it does the 2D textures.
  bedAlbedo = applyAnisotropy(bedAlbedo);
  bedNormal = applyAnisotropy(bedNormal);
  // A relief pack carries micro XY in RG and macro XY in BA of one rock normal
  // texture, keeping the same texture binding count as the pre-relief material.
  const rockNormalUrl = m.relief?.packedNormalUrl ?? m.rock.normalUrl;
  const textures: Record<string, Texture> = {
    rockAlbedo: applyAnisotropy(new Texture(m.rock.albedoUrl, scene)),
    rockNormal: applyAnisotropy(new Texture(rockNormalUrl, scene)),
    bedAlbedo,
    bedNormal,
    splatMap: splat,
    // The lake mask is 24 m cells sampled bilinearly: no fine relief to lose at a grazing angle, so
    // it keeps Babylon's default level.
    lakeMask,
    // Authored distant normal/AO. Ready leaf crops replace this binding for near
    // draws at their original 2.2 m density, with registered padding and mips.
    normalAo: applyAnisotropy(new Texture(m.normalAoUrl, scene)),
  };
  const groundLayers = m.layers.map(layer => {
    const sampler = `${layer.name}Tex`;
    textures[sampler] = applyAnisotropy(new Texture(layer.albedoUrl, scene));
    textures[`${sampler}Normal`] = applyAnisotropy(new Texture(layer.normalUrl, scene));
    return { sampler, normalUrl: layer.normalUrl, tileMetres: layer.tileMetres, tint: layer.tint };
  });
  textures.rockNormal.gammaSpace = false;
  textures.normalAo.gammaSpace = false;
  textures.normalAo.wrapU = textures.normalAo.wrapV = Texture.CLAMP_ADDRESSMODE;

  const material = new PBRMaterial("ground", scene);
  material.albedoColor = new Color3(0.7, 0.7, 0.7);
  material.metallic = 0;
  material.roughness = 1;
  material.metallicF0Factor = 0.3;
  const surface = new TerrainMaterialPlugin(material, {
    sizeMetres: manifest.sizeMetres, waterLevel: WATER_Y, rockTileMetres: m.rock.tileMetres,
    bedTiles: m.lakeBed.layers.map(l => l.tileMetres),
    daylightDepthMetres: DAYLIGHT_DEPTH_METRES, groundLayers,
    reliefTileMetres: m.relief?.tileMetres,
  }, textures);
  return { material, surface, anisotropy };
}

async function loadWater(scene: Scene, manifest: GroundManifest, biome: Biome) {
  const container = await LoadAssetContainerAsync(manifest.water.url, scene);
  container.addAllToScene();
  const water = container.meshes.find(mesh => mesh.name === "water") as Mesh;
  water.isPickable = false;

  const waterMaterial = new PBRMaterial("water", scene);
  waterMaterial.albedoColor = Color3.FromArray(biome.water!.colour);
  waterMaterial.metallic = 0;
  waterMaterial.roughness = 0.12;
  waterMaterial.directIntensity = 0.6;
  waterMaterial.specularIntensity = 0.6;
  const ripples = new Texture("textures/waterbump.png", scene);
  ripples.uScale = ripples.vScale = manifest.sizeMetres / RIPPLE_TILE_METRES;
  ripples.level = 0.35;
  waterMaterial.bumpTexture = ripples;
  water.material = waterMaterial;

  const mirror = new MirrorTexture("lakeMirror", MIRROR_SIZE, scene, true, Constants.TEXTURETYPE_HALF_FLOAT, Texture.TRILINEAR_SAMPLINGMODE);
  mirror.mirrorPlane = new Plane(0, -1, 0, WATER_Y);
  return { water, waterMaterial, ripples, mirror };
}
