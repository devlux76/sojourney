import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Observable } from "@babylonjs/core/Misc/observable";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import { CreateGreasedLine } from "@babylonjs/core/Meshes/Builders/greasedLineBuilder";
import { GreasedLineMeshMaterialType } from "@babylonjs/core/Materials/GreasedLine/greasedLineMaterialInterfaces";
import { WATER_Y } from "../pack";
import { SKY_LAYER_GROUP } from "./sky";

// Real seconds between strikes at the height of a storm; a weaker storm strikes less often.
const STRIKE_GAP = [5, 22];
// A strike is one to three flashes, each this long, with this much dark between them.
const FLASHES = [1, 3];
const FLASH_SECONDS = [0.05, 0.14];
const FLICKER_GAP_SECONDS = [0.04, 0.12];
// How far off the strike is, for where the bolt stands and for the thunder that follows it.
const STRIKE_DISTANCE = [400, 6000];
const SPEED_OF_SOUND = 343;
// The bolt runs from the cloud base down to the lake's level, leaning by up to this share of its height.
const BOLT_TOP = 800;
const BOLT_LEAN = 0.25;
// Each half of a stretch is bent sideways by up to this share of the stretch's length, this many times
// over, which gives the bolt its jagged line.
const BOLT_JAG = 0.22;
const BOLT_SPLITS = 6;
// Forks leave the upper part of the bolt, each this share of the bolt's height long and thinner.
const FORKS = [2, 5];
const FORK_LENGTH = [0.15, 0.45];
const FORK_WIDTH = 0.45;
// Width on screen and brightness. The colour is far above white so the pipeline's bloom makes it glow,
// and it is drawn after the rain's veil, which would hide anything that far away.
const BOLT_WIDTH = 5;
const BOLT_COLOUR = new Color3(0.75, 0.8, 1);
const BOLT_RADIANCE = 60;
const BOLT_ORDER = 10;

export interface Strike { distanceMetres: number; thunderDelaySeconds: number; }

const between = ([low, high]: number[]) => low + (high - low) * Math.random();

// A jagged line from a to b: every stretch is split in two and the middle pushed sideways, over and over.
function jagged(a: number[], b: number[], splits: number): number[] {
  let points = [a, b];
  for (let pass = 0; pass < splits; pass++) {
    const next = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const [p, q] = [points[i - 1], points[i]];
      const reach = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) * BOLT_JAG;
      next.push([(p[0] + q[0]) / 2 + (Math.random() - 0.5) * reach, (p[1] + q[1]) / 2 + (Math.random() - 0.5) * reach * 0.4,
        (p[2] + q[2]) / 2 + (Math.random() - 0.5) * reach], q);
    }
    points = next;
  }
  return points.flat();
}

// A storm's lightning. Each strike is a forked bolt somewhere around the player, drawn with Babylon's
// GreasedLine, and a flash: update() returns how bright the flash is this frame, 0 to 1, and the
// environment adds that to the sky light, so the sky, the rain and the ground light up with the bolt.
// onStrike fires at the start of each strike, with the delay after which its thunder should be heard.
export class Lightning {
  readonly onStrike = new Observable<Strike>();
  private nextStrike = between(STRIKE_GAP);
  // The strike under way: seconds of light and of dark in turn, starting with light.
  private phases: number[] = [];
  private phase = -1;
  private phaseLeft = 0;
  private brightness = 0;
  private bolt: Mesh | null = null;
  private colour = new Color3();
  private dim = 1;

  constructor(private scene: Scene, private camera: Camera) {}

  // dim is the day's exposure over the present one: the bolt is drawn that much darker at night, when
  // the exposure is high, so that it is a glowing line then too and not a white blot.
  update(dt: number, storm: number, dim: number): number {
    this.dim = dim;
    if (this.phase < 0) {
      if (storm <= 0) return 0;
      this.nextStrike -= dt * storm;
      if (this.nextStrike > 0) return 0;
      this.nextStrike = between(STRIKE_GAP);
      this.phases.length = 0;
      const flashes = Math.round(between(FLASHES));
      for (let i = 0; i < flashes; i++) {
        if (i > 0) this.phases.push(between(FLICKER_GAP_SECONDS));
        this.phases.push(between(FLASH_SECONDS));
      }
      const distanceMetres = between(STRIKE_DISTANCE);
      this.strike(distanceMetres);
      this.startPhase(0);
      this.onStrike.notifyObservers({ distanceMetres, thunderDelaySeconds: distanceMetres / SPEED_OF_SOUND });
    } else {
      this.phaseLeft -= dt;
      if (this.phaseLeft <= 0) this.startPhase(this.phase + 1);
    }
    // Even phases are light, odd ones the dark between two flashes.
    const lit = this.phase >= 0 && this.phase % 2 === 0;
    this.bolt?.setEnabled(lit);
    return lit ? this.brightness : 0;
  }

  dispose() {
    this.bolt?.dispose(false, true);
    this.onStrike.clear();
  }

  private startPhase(index: number) {
    if (index >= this.phases.length) { this.phase = -1; return; }
    this.phase = index;
    this.phaseLeft = this.phases[index];
    if (index % 2 === 0) this.brightness = 0.5 + 0.5 * Math.random();
  }

  // Builds the bolt for a strike this far from the camera, in a random direction.
  private strike(distance: number) {
    const eye = this.camera.globalPosition, bearing = Math.random() * 2 * Math.PI;
    const x = eye.x + Math.sin(bearing) * distance, z = eye.z + Math.cos(bearing) * distance;
    const lean = () => (Math.random() - 0.5) * 2 * BOLT_LEAN * BOLT_TOP;
    const top = [x, WATER_Y + BOLT_TOP, z], foot = [x + lean(), WATER_Y, z + lean()];
    const trunk = jagged(top, foot, BOLT_SPLITS);
    const lines = [trunk], widths: number[] = new Array((trunk.length / 3) * 2).fill(1);
    const forks = Math.round(between(FORKS));
    for (let i = 0; i < forks; i++) {
      // A fork starts on the trunk's upper two thirds and runs on downward and outward.
      const at = 3 * Math.floor(Math.random() * (trunk.length / 3) * 0.66);
      const from = [trunk[at], trunk[at + 1], trunk[at + 2]], length = between(FORK_LENGTH) * BOLT_TOP;
      const to = [from[0] + (Math.random() - 0.5) * length, Math.max(WATER_Y, from[1] - length * (0.5 + 0.5 * Math.random())), from[2] + (Math.random() - 0.5) * length];
      const fork = jagged(from, to, BOLT_SPLITS - 2);
      lines.push(fork);
      for (let n = 0; n < (fork.length / 3) * 2; n++) widths.push(FORK_WIDTH);
    }

    this.bolt?.dispose(false, true);
    const bolt = CreateGreasedLine("lightningBolt", { points: lines, widths }, {
      materialType: GreasedLineMeshMaterialType.MATERIAL_TYPE_SIMPLE, sizeAttenuation: true, width: BOLT_WIDTH,
      color: BOLT_COLOUR.scaleToRef(BOLT_RADIANCE * this.dim, this.colour),
    }, this.scene) as Mesh;
    const material = bolt.material!;
    material.alphaMode = Constants.ALPHA_ADD;
    material.alpha = 0.99;
    material.disableDepthWrite = true;
    material.fogEnabled = false;
    bolt.isPickable = false;
    bolt.alwaysSelectAsActiveMesh = true;
    bolt.alphaIndex = BOLT_ORDER;
    bolt.renderingGroupId = SKY_LAYER_GROUP;
    this.bolt = bolt;
  }
}
