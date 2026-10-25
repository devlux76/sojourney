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
import "../core/ktx2";
import "./meshopt";
import type { Biome } from "../biomes/Biome";
import { WATER_Y, type GroundManifest } from "./pack";
import { GroundStream } from "./groundStream";
import { loadLakeMask } from "./lake";

const MIRROR_SIZE = 512;
const HIDDEN_FROM_CAMERA = 0x10000000;
const RIPPLE_TILE_METRES = 12;

export interface Ground {
  manifest: GroundManifest;
  stream: GroundStream;
  water: Mesh;
  waterMaterial: PBRMaterial;
  ripples: Texture;
  mirror: MirrorTexture;
  reflectionProxy: Mesh;
}

export async function loadGround(scene: Scene, biome: Biome): Promise<Ground> {
  const manifest: GroundManifest = await (await fetch(`packs/${biome.id}/ground/ground.json`)).json();
  await loadLakeMask(manifest);
  const material = createFlatGroundMaterial(scene);
  // Ground levels cross-fade on a timer: the plugin draws each mesh only in its own
  // interval of the screen-fixed Bayer pattern, so two levels meet with no pop.
  const stream = await GroundStream.create(scene, manifest, material,
    DitheredTileFadeMaterialPlugin.GetOrCreate(material));

  const { water, waterMaterial, ripples, mirror } = await loadWater(scene, manifest, biome);
  const proxies = await LoadAssetContainerAsync(manifest.reflectionProxy.url, scene);
  proxies.addAllToScene();
  const reflectionProxy = proxies.meshes.find(mesh => mesh.name === "reflectionProxy") as Mesh;
  reflectionProxy.isPickable = false;
  reflectionProxy.computeWorldMatrix(true);
  reflectionProxy.freezeWorldMatrix();
  reflectionProxy.material = material;
  reflectionProxy.layerMask = HIDDEN_FROM_CAMERA;
  return { manifest, stream, water, waterMaterial, ripples, mirror, reflectionProxy };
}

// A uniform PBR colour leaves only the authored land shape and sky lighting visible in the test.
export function createFlatGroundMaterial(scene: Scene): PBRMaterial {
  const material = new PBRMaterial("ground", scene);
  material.albedoColor = new Color3(0.36, 0.38, 0.4);
  material.metallic = 0;
  material.roughness = 1;
  DitheredTileFadeMaterialPlugin.GetOrCreate(material);
  return material;
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
