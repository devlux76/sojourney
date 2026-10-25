import { Scene } from "@babylonjs/core/scene";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { GroundManifest } from "./pack";

// The caldera lake as a coarse grid (one byte per cell, row 0 = south, column 0 = west, 255 = lake).
// Land outside the caldera lies below lake level too, so "below WATER_Y" alone must not mean "in the lake".
// The depth of water over which daylight falls to 1/e of what it was. Crater Lake is among the
// clearest lakes there are: about a hundredth of the surface light is left 100 m down, which is 22 m
// to 1/e. An eye adapts to that and the camera here does not, so the fade is stretched to keep the
// moss beds (to 140 m down) dimly in view: half the light is left at 28 m, 3% at 140 m, and the
// floor at 594 m is black.
export const DAYLIGHT_DEPTH_METRES = 40;

let mask: { cells: Uint8Array; count: number; sizeMetres: number } | null = null;

// Loads the mask for inLake() and returns it as an R8 texture for the terrain shader (same uv as the splat map).
export async function loadLakeMask(scene: Scene, manifest: Pick<GroundManifest, "lakeMask" | "sizeMetres">): Promise<RawTexture> {
  const { url, cells: count } = manifest.lakeMask;
  const cells = new Uint8Array(await (await fetch(url)).arrayBuffer());
  mask = { cells, count, sizeMetres: manifest.sizeMetres };
  const texture = RawTexture.CreateRTexture(cells, count, count, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

// The baked water depth as an R8 texture for the lake surface (LakeSurfaceMaterial), or null for a
// pack built before it existed. Bilinear, so the shallows fade smoothly up to the shore.
export async function loadLakeDepth(scene: Scene, manifest: Pick<GroundManifest, "lakeDepth">) {
  const depth = manifest.lakeDepth;
  if (!depth) return null;
  const cells = new Uint8Array(await (await fetch(depth.url)).arrayBuffer());
  const texture = RawTexture.CreateRTexture(cells, depth.cols, depth.rows, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return { texture, rect: depth.rect, unitMetres: depth.unitMetres };
}

// True when (x, z) world metres falls in a lake cell; false until the mask has loaded.
export function inLake(x: number, z: number): boolean {
  if (!mask) return false;
  const c = Math.floor((x / mask.sizeMetres + 0.5) * mask.count);
  const r = Math.floor((z / mask.sizeMetres + 0.5) * mask.count);
  return c >= 0 && c < mask.count && r >= 0 && r < mask.count && mask.cells[r * mask.count + c] > 0;
}
