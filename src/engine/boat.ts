import { Scene } from "@babylonjs/core/scene";
import { Observable } from "@babylonjs/core/Misc/observable";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Path3D } from "@babylonjs/core/Maths/math.path";
import type { Biome } from "../biomes/Biome";
import { settings } from "../core/Settings";
import { GROUND_MASK, OBSTACLE_MASK } from "./player/ground";
import type { PropBlocker, PropEntry, PropsManifest, RouteManifest } from "./pack";
import { loadLevels, placeProp, solidBox, solidBoxes } from "./props";

// The boarding place, in the ship's frame: the waist, where the rail is lowest (2.64 m above the water)
// and each pier's end ramp comes down onto it. Steps inside the rail take the player down to the deck.
const GANGWAY_Z: [number, number] = [-0.3, 2.1];
const RAIL_X = 2.5;
const RAIL_TOP = 2.64;
const STEPS_FOOT_X = 1.0;
const STEPS = 4;
// While the ship is under way the gap in the rail is closed by a gate this tall, taller than a jump.
const GATE_TOP = 4.2;
const GATE_THICKNESS = 0.25;
// Far enough down to be out of reach of every ground query.
const HIDDEN_BELOW = 5000;
// The ship slows to a crawl within this distance of a stop, and never goes slower than this share of
// its cruising speed, so it always arrives.
const EASE_METRES = 250;
const SLOWEST = 0.04;
// Within this distance of a dock the ship's heading is drawn to the heading it lies at when docked.
const SQUARE_UP_METRES = 40;
// The bell is rung this long before the ship casts off and before she arrives, as well as at both.
const BELL_WARNING_SECONDS = 30;
const smoothstep = (t: number) => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };

// The tour boat: it goes round the route for ever, waiting at each stop. A stop is a dock or a sight;
// at a sight she lies out on the water with the gangway shut. It is moved by setting where
// it is, not by forces, and step is the rigid move it made this frame, so whatever rides on it (the
// player, a seat, a cast line) can be moved by exactly the same amount whatever the frame rate.
export class Boat {
  readonly step = Matrix.Identity();
  yawStep = 0;
  // Metres along the route, and the seconds left to wait at a stop (zero while under way).
  distance: number;
  dwellLeft: number;
  dwellSeconds: number;
  // Told each time the bell is rung: BELL_WARNING_SECONDS before the ship casts off, as she casts off,
  // as she first slows for a stop, and as she comes to it.
  readonly onBell = new Observable<void>();
  // Told the name of the stop the ship has just come to, and, as she casts off, of the one she leaves
  // and the one she makes for.
  readonly onArrive = new Observable<string>();
  readonly onDepart = new Observable<{ from: string; to: string }>();
  private arrivalRung = false;
  private path: Path3D;
  private yaw = 0;
  private timeFactor = 0;
  private readonly before = new Matrix();
  private readonly gates: TransformNode[];
  private gateY = 0;
  private readonly docks: { distance: number; position: Vector3; heading: number }[];
  // Every stop in the order the ship comes to it, and the one she lies at or last left.
  // Each stop carries the cutscene look target the guide's voice turns the player to.
  private readonly stops: { name: string; distance: number; dock: boolean; lookAt: Vector3 }[];
  private stop = 0;

  static async load(scene: Scene, biome: Biome, manifest: PropsManifest, shadows: ShadowGenerator): Promise<Boat | null> {
    if (!biome.boat) return null;
    const entry = manifest.props[biome.boat.prop];
    const [levels, route] = await Promise.all([
      loadLevels(scene, biome.id, biome.boat.prop, entry),
      fetch(biome.boat.routeUrl).then(response => response.json() as Promise<RouteManifest>),
    ]);
    const { root, instance } = placeProp(scene, biome.boat.prop, levels[0], shadows);
    return new Boat(scene, root, instance, entry, route, biome.boat.dwellSeconds, shadows);
  }

  private constructor(scene: Scene, readonly root: TransformNode, readonly instance: InstancedMesh, entry: PropEntry,
    private route: RouteManifest, dwellSeconds: number, shadows: ShadowGenerator) {
    // The ship is put at its first dock before its collision is made, so the decks are already there
    // when the player is set down on them, before the first physics step.
    const [first] = route.docks;
    root.position.set(first.position[0], 0, first.position[1]);
    root.rotationQuaternion = Quaternion.RotationYawPitchRoll((first.headingDegrees * Math.PI) / 180, 0, 0);
    root.computeWorldMatrix(true);
    solidBoxes(scene, root, "boat", entry, openRail(entry.blockers ?? []), true);
    const deck = entry.walk!.reduce((y, walk) => Math.min(y, walk.kind === undefined ? walk.y : y), Infinity);
    this.gates = [];
    const wood = new PBRMaterial("boatSteps", scene);
    wood.albedoColor = new Color3(0.3, 0.2, 0.12);
    wood.metallic = 0;
    wood.roughness = 0.85;
    const zMid = (GANGWAY_Z[0] + GANGWAY_Z[1]) / 2, width = GANGWAY_Z[1] - GANGWAY_Z[0];
    const run = RAIL_X - STEPS_FOOT_X, rise = RAIL_TOP - deck;
    for (const side of [-1, 1]) {
      // The steps are walked as one slope from the deck up to the rail top, so no step is too high.
      solidBox(scene, root, "boat_steps", new Vector3(side * (STEPS_FOOT_X + run / 2), deck + rise / 2 - 0.08, zMid),
        Quaternion.RotationAxis(Vector3.Forward(), side * Math.atan2(rise, run)),
        new Vector3(Math.hypot(run, rise), 0.15, width), GROUND_MASK, true);
      for (let i = 0; i < STEPS; i++) {
        const height = (rise * (i + 1)) / STEPS;
        const tread = MeshBuilder.CreateBox("boatStep", { width: run / STEPS, height, depth: width }, scene);
        tread.parent = root;
        tread.position.set(side * (STEPS_FOOT_X + (run * (i + 0.5)) / STEPS), deck + height / 2, zMid);
        tread.material = wood;
        tread.isPickable = false;
        tread.receiveShadows = true;
        shadows.addShadowCaster(tread);
      }
      this.gates.push(solidBox(scene, root, "boat_gate",
        new Vector3(side * (RAIL_X + GATE_THICKNESS / 2), (deck + GATE_TOP) / 2, zMid), Quaternion.Identity(),
        new Vector3(GATE_THICKNESS, GATE_TOP - deck, width), OBSTACLE_MASK, true));
    }

    this.gateY = (deck + GATE_TOP) / 2;

    const points = route.points.map(([x, z]) => new Vector3(x, 0, z));
    this.path = new Path3D([...points, points[0]]);
    this.docks = route.docks.map(dock => ({
      distance: dock.distance, position: new Vector3(dock.position[0], 0, dock.position[1]),
      heading: (dock.headingDegrees * Math.PI) / 180,
    }));
    this.stops = [...route.docks.map(dock => ({ name: dock.name, distance: dock.distance, dock: true, lookAt: new Vector3(...dock.lookAt) })),
      ...route.sights.map(sight => ({ ...sight, dock: false, lookAt: new Vector3(...sight.lookAt) }))].sort((a, b) => a.distance - b.distance);
    this.stop = this.stops.findIndex(stop => stop.distance === this.docks[0].distance);
    // The time a loop takes at a cruising speed of 1 m/s, slow stretches included, so the cruising
    // speed can be set to make the whole loop take the time the day length asks for.
    for (let s = 5; s < route.length; s += 10) this.timeFactor += 10 / this.pace(s);
    this.distance = this.docks[0].distance;
    this.dwellLeft = this.dwellSeconds = dwellSeconds;
    this.pose();
    root.computeWorldMatrix(true);
  }

  // Lying at a dock or not; the gates ask. Waiting at a sight is not docked.
  get docked(): boolean {
    return this.dwellLeft > 0 && this.stops[this.stop].dock;
  }

  // A point given in the ship's frame, in the world.
  toWorld(local: Vector3): Vector3 {
    return Vector3.TransformCoordinates(local, this.root.getWorldMatrix());
  }

  // The stop she lies at, or the one she last left.
  get stopName(): string {
    return this.stops[this.stop].name;
  }

  // The cutscene look target for a stop, in world metres: where the guide's voice turns the player.
  lookAt(stopName: string): Vector3 | null {
    return this.stops.find(stop => stop.name === stopName)?.lookAt ?? null;
  }

  get heading(): number {
    return this.yaw;
  }

  // Move the ship on by dt seconds of real time and record the rigid step it made.
  update(dt: number) {
    this.root.getWorldMatrix().invertToRef(this.before);
    const yawBefore = this.yaw;
    if (this.dwellLeft > 0) {
      const before = this.dwellLeft;
      this.dwellLeft = Math.max(0, this.dwellLeft - dt);
      if (this.dwellLeft === 0 || (before > BELL_WARNING_SECONDS && this.dwellLeft <= BELL_WARNING_SECONDS)) this.onBell.notifyObservers();
      if (this.dwellLeft === 0) this.onDepart.notifyObservers({ from: this.stops[this.stop].name, to: this.stops[(this.stop + 1) % this.stops.length].name });
    } else {
      // The loop under way takes a quarter of the day length, whatever that is set to.
      const cruise = this.timeFactor / (settings.dayLengthMinutes * 15);
      const move = cruise * this.pace(this.distance) * dt;
      const next = this.stops.map(stop => (stop.distance - this.distance + this.route.length) % this.route.length || this.route.length);
      const ahead = Math.min(...next);
      if (move >= ahead) {
        this.stop = next.indexOf(ahead);
        this.distance = this.stops[this.stop].distance;
        this.dwellLeft = this.dwellSeconds;
        this.arrivalRung = false;
        this.onBell.notifyObservers();
        this.onArrive.notifyObservers(this.stops[this.stop].name);
      } else {
        this.distance = (this.distance + move) % this.route.length;
        // The approach bell rings as she first starts to slow for the stop, on entering its
        // ease stretch — not on a seconds estimate, which drifted with cruising speed.
        if (!this.arrivalRung && ahead - move <= EASE_METRES) {
          this.arrivalRung = true;
          this.onBell.notifyObservers();
        }
      }
    }
    this.pose();
    this.root.computeWorldMatrix(true);
    this.before.multiplyToRef(this.root.getWorldMatrix(), this.step);
    this.yawStep = Math.atan2(Math.sin(this.yaw - yawBefore), Math.cos(this.yaw - yawBefore));
  }

  // Share of cruising speed at a place on the route: slow near the stops, never quite stopped.
  private pace(distance: number): number {
    return Math.max(SLOWEST, smoothstep(Math.min(...this.stops.map(stop => this.around(stop.distance, distance))) / EASE_METRES));
  }

  // Metres between two places on the route, the short way round the loop.
  private around(a: number, b: number): number {
    const d = Math.abs(a - b);
    return Math.min(d, this.route.length - d);
  }

  private toDock(distance: number) {
    let best = this.docks[0], metres = Infinity;
    for (const dock of this.docks) {
      const around = this.around(dock.distance, distance);
      if (around < metres) { metres = around; best = dock; }
    }
    return { dock: best, metres };
  }

  // Put the ship where its distance along the route says, facing along the route; near a dock it
  // squares up to the dock's heading, and at the dock it lies exactly where the pier expects it.
  private pose() {
    const { dock, metres } = this.toDock(this.distance);
    const at = this.distance / this.route.length;
    const tangent = this.path.getTangentAt(at, true);
    const along = Math.atan2(tangent.x, tangent.z);
    const pull = 1 - smoothstep(metres / SQUARE_UP_METRES);
    this.yaw = along + Math.atan2(Math.sin(dock.heading - along), Math.cos(dock.heading - along)) * pull;
    Vector3.LerpToRef(this.path.getPointAt(at), dock.position, metres < 1 ? 1 - metres : 0, this.root.position);
    Quaternion.RotationYawPitchRollToRef(this.yaw, 0, 0, this.root.rotationQuaternion!);
    // Docked, the gates sink out of the way so the player can cross the rail; under way they close it.
    for (const gate of this.gates) gate.position.y = this.docked ? this.gateY - HIDDEN_BELOW : this.gateY;
  }
}

// The rail blockers with the gangway left open on both sides; the gates close it under way.
function openRail(blockers: PropBlocker[]): PropBlocker[] {
  const [from, to] = GANGWAY_Z;
  return blockers.flatMap(blocker => {
    if (blocker.kind === "step" || blocker.z[1] <= from || blocker.z[0] >= to) return [blocker];
    const kept: PropBlocker[] = [];
    if (blocker.z[0] < from) kept.push({ ...blocker, z: [blocker.z[0], from] });
    if (blocker.z[1] > to) kept.push({ ...blocker, z: [to, blocker.z[1]] });
    return kept;
  });
}
