import type { Scene } from "@babylonjs/core/scene";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { GroundManifest } from "./pack";

// The sun's disc is half a degree across: a light this far below the rim's line is fully hidden, this
// far above it fully seen, and the share between is the part of the disc that shows.
const DISC_DEGREES = 0.53;
// Skip the recompute until a light has moved this far.
const MOVE_DEGREES = 0.02;

export interface LakeHorizon {
  layers: Uint8Array;
  cols: number;
  rows: number;
  azimuths: number;
  unitDegrees: number;
  rect: [number, number, number, number];
}

export async function loadLakeHorizon(manifest: Pick<GroundManifest, "lakeHorizon">): Promise<LakeHorizon | null> {
  const horizon = manifest.lakeHorizon;
  if (!horizon) return null;
  const layers = new Uint8Array(await (await fetch(horizon.url)).arrayBuffer());
  return { layers, cols: horizon.cols, rows: horizon.rows, azimuths: horizon.azimuths, unitDegrees: horizon.unitDegrees, rect: horizon.rect };
}

// Whether the sun and the moon stand above the caldera rim, seen from each cell of the lake (E11):
// an RG texture over the horizon map's rect, red for the sun and green for the moon, 1 where the
// light is seen whole. The lake surface dims each light's direct share by it, so the glint goes
// when the sun sinks behind the rim. Recomputed on the CPU only when a light moves.
export class LakeLight {
  readonly texture: RawTexture;
  readonly rect: [number, number, number, number];
  private readonly data: Uint8Array;
  private readonly last = [NaN, NaN, NaN, NaN];

  constructor(scene: Scene, private horizon: LakeHorizon) {
    this.rect = horizon.rect;
    this.data = new Uint8Array(horizon.cols * horizon.rows * 2).fill(255);
    this.texture = new RawTexture(this.data, horizon.cols, horizon.rows, Constants.TEXTUREFORMAT_RG, scene, false, false,
      Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    this.texture.wrapU = this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  }

  // Directions are the way each light travels (DirectionalLight.direction).
  update(sun: Vector3, moon: Vector3) {
    let changed = false;
    [sun, moon].forEach((direction, light) => {
      const [elevation, bearing] = elevationAndBearing(direction);
      if (Math.abs(elevation - this.last[2 * light]) < MOVE_DEGREES
        && Math.abs(bearing - this.last[2 * light + 1]) < MOVE_DEGREES) return;
      this.last[2 * light] = elevation;
      this.last[2 * light + 1] = bearing;
      fillVisibility(this.horizon, elevation, bearing, this.data, light);
      changed = true;
    });
    if (changed) this.texture.update(this.data);
  }

  dispose() { this.texture.dispose(); }
}

// Degrees above the horizon and compass bearing (clockwise from north, +z) of the light's position.
export function elevationAndBearing(direction: { x: number; y: number; z: number }): [number, number] {
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const elevation = Math.asin(Math.max(-1, Math.min(1, -direction.y / length))) * 180 / Math.PI;
  const bearing = (Math.atan2(-direction.x, -direction.z) * 180 / Math.PI + 360) % 360;
  return [elevation, bearing];
}

// Writes channel `channel` of the RG data: how much of a light at this elevation and bearing shows
// over each cell's horizon, interpolated between the two nearest baked bearings.
export function fillVisibility(horizon: LakeHorizon, elevation: number, bearing: number, data: Uint8Array, channel: number) {
  const cells = horizon.cols * horizon.rows;
  const at = bearing / 360 * horizon.azimuths;
  const k0 = Math.floor(at) % horizon.azimuths;
  const k1 = (k0 + 1) % horizon.azimuths;
  const t = at - Math.floor(at);
  const a = k0 * cells, b = k1 * cells;
  for (let i = 0; i < cells; i++) {
    const rim = (horizon.layers[a + i] * (1 - t) + horizon.layers[b + i] * t) * horizon.unitDegrees;
    const seen = Math.min(1, Math.max(0, (elevation - rim) / DISC_DEGREES + 0.5));
    data[2 * i + channel] = Math.round(seen * 255);
  }
}
