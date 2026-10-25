import { Scene } from "@babylonjs/core/scene";
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

// Keep the lake outline available to swimming and underwater checks without creating a terrain texture.
export async function loadLakeMask(manifest: GroundManifest): Promise<void> {
  const { url, cells: count } = manifest.lakeMask;
  const cells = new Uint8Array(await (await fetch(url)).arrayBuffer());
  mask = { cells, count, sizeMetres: manifest.sizeMetres };
}

// True when (x, z) world metres falls in a lake cell; false until the mask has loaded.
export function inLake(x: number, z: number): boolean {
  if (!mask) return false;
  const c = Math.floor((x / mask.sizeMetres + 0.5) * mask.count);
  const r = Math.floor((z / mask.sizeMetres + 0.5) * mask.count);
  return c >= 0 && c < mask.count && r >= 0 && r < mask.count && mask.cells[r * mask.count + c] > 0;
}
