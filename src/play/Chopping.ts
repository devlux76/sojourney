import { Scene, Mesh, InstancedMesh, MeshBuilder, Vector3, TransformNode, type AbstractMesh } from "@babylonjs/core";
import { playWoodMaterial, woodFaceUV, playShadows } from "./materials";
import { Play, Activity, ViewRay, Found, REACH } from "./Play";
import { rayTrunk, rayNear } from "./targeting";
import { sounds } from "./sounds";
import type { Flora } from "../engine/flora";

export const SWINGS_TO_FELL = 5;
const LOGS_PER_TREE = 3;
const LOG_LENGTH = 0.9;
const LOG_DIAMETER = 0.22;
const PICKUP_RADIUS = 1.2;
const LOG_TARGET_RADIUS = 0.45;
const SHUDDER_SECONDS = 0.3;
const FALL_SECONDS = 1.6;
const SINK_SECONDS = 1.5;
const SINK_DEPTH = 4;
const SEAT_HEIGHT = 0.4;
const STUMP_TARGET_RADIUS = 0.45;

export class Chopping implements Activity {
  private swings = new Map<string, number>();
  private logs: InstancedMesh[] = [];
  private logSource: Mesh;
  private stumpSource: Mesh;
  private stumps: Vector3[] = [];
  private animations: ((now: number) => boolean)[] = [];

  constructor(scene: Scene, private play: Play, private bio: Flora) {
    // Chopped wood reads the authored 0.5 m wood tile through the same
    // atmosphere-lit PBR contract as everything else in play. Metric side UVs
    // keep grain density at the bake's texel density; tessellation, collisions,
    // instances, shadows and pickup are unchanged.
    const bark = playWoodMaterial("barkMat", scene);
    this.logSource = MeshBuilder.CreateCylinder("log", { height: LOG_LENGTH, diameter: LOG_DIAMETER, tessellation: 10,
      faceUV: woodFaceUV(Math.PI * LOG_DIAMETER, LOG_LENGTH) }, scene);
    this.stumpSource = MeshBuilder.CreateCylinder("stump", { height: 0.5, diameterTop: 0.75, diameterBottom: 0.95, tessellation: 12,
      faceUV: woodFaceUV(Math.PI * (0.75 + 0.95) / 2, 0.5) }, scene);
    for (const m of [this.logSource, this.stumpSource]) {
      m.material = bark;
      m.isVisible = false;
      m.isPickable = false;
      m.receiveShadows = true;
    }
  }

  find(ray: ViewRay): Found | null {
    const { origin, dir } = ray;
    let best: Found | null = null;
    for (const log of this.logs) {
      const d = rayNear(origin, dir, log.position, LOG_TARGET_RADIUS, REACH);
      if (d !== null && (!best || d < best.distance)) best = { target: { kind: "log" }, distance: d, perform: () => this.pack(log) };
    }
    const hit = rayTrunk(origin, dir, this.bio.trunks.within(origin.x, origin.z, REACH + 1), REACH);
    if (hit && (!best || hit.distance < best.distance))
      best = { target: { kind: "tree" }, distance: hit.distance, perform: () => this.chop(hit.trunk) };
    for (const seat of this.stumps) {
      const d = rayNear(origin, dir, seat, STUMP_TARGET_RADIUS, REACH);
      if (d !== null && (!best || d < best.distance)) best = { target: { kind: "seat" }, distance: d, perform: () => this.play.sit(seat) };
    }
    return best;
  }

  update() {
    const now = performance.now() / 1000;
    this.animations = this.animations.filter(step => !step(now));
    const me = this.play.camera.globalPosition;
    for (const log of [...this.logs])
      if (Math.hypot(log.position.x - me.x, log.position.z - me.z) < PICKUP_RADIUS && Math.abs(log.position.y - me.y) < 2.5)
        this.pack(log);
  }

  private pack(log: InstancedMesh) {
    if (this.play.rucksack.packLogs(1) === 0) return;
    log.dispose();
    this.logs.splice(this.logs.indexOf(log), 1);
    sounds.pack();
    this.play.refresh();
  }

  private chop([x, z]: [number, number]) {
    const key = `${x},${z}`, swings = (this.swings.get(key) ?? 0) + 1;
    sounds.thunk();
    if (swings < SWINGS_TO_FELL) {
      this.swings.set(key, swings);
      const model = this.bio.nearModelAt(x, z);
      if (model) this.shudder(model);
      return;
    }
    this.swings.delete(key);
    const felled = this.bio.fellTree(x, z);
    if (!felled) return;
    sounds.treeFall();
    const me = this.play.camera.globalPosition;
    const yaw = Math.atan2(x - me.x, z - me.z);
    const stump = this.stumpSource.createInstance("stump");
    const ground = this.play.ground.getHeight(x, z);
    stump.position.set(x, ground + 0.15, z);
    playShadows(stump);
    this.stumps.push(new Vector3(x, ground + SEAT_HEIGHT, z));
    const dropLogs = () => this.dropLogs(x, z, yaw);
    if (felled.model) this.fall(felled.model, yaw, dropLogs);
    else dropLogs();
  }

  private dropLogs(x: number, z: number, yaw: number) {
    for (let i = 0; i < LOGS_PER_TREE; i++) {
      const along = 1.6 + i * 1.3, side = (Math.random() - 0.5) * 0.8;
      const lx = x + Math.sin(yaw) * along + Math.cos(yaw) * side;
      const lz = z + Math.cos(yaw) * along - Math.sin(yaw) * side;
      const log = this.logSource.createInstance("log");
      log.position.set(lx, this.play.ground.getHeight(lx, lz) + LOG_DIAMETER / 2, lz);
      log.rotation.set(0, yaw - Math.PI / 2 + (Math.random() - 0.5) * 0.4, Math.PI / 2);
      playShadows(log);
      this.logs.push(log);
    }
  }

  private shudder(model: AbstractMesh) {
    const start = performance.now() / 1000, baseX = model.rotation.x;
    this.animations.push(now => {
      if (model.isDisposed()) return true;
      const t = (now - start) / SHUDDER_SECONDS;
      model.rotation.x = t < 1 ? baseX + Math.sin(t * Math.PI * 6) * 0.02 * (1 - t) : baseX;
      return t >= 1;
    });
  }

  private fall(model: AbstractMesh, yaw: number, landed: () => void) {
    const pivot = new TransformNode("fallingTree", model.getScene());
    pivot.position.copyFrom(model.position);
    pivot.rotation.y = yaw;
    model.parent = pivot;
    model.position.setAll(0);
    model.rotation.y -= yaw;
    const start = performance.now() / 1000, baseY = pivot.position.y;
    let down = false;
    this.animations.push(now => {
      const t = (now - start) / FALL_SECONDS;
      pivot.rotation.x = (Math.PI / 2) * Math.min(1, t * t);
      if (t < 1) return false;
      if (!down) {
        down = true;
        landed();
      }
      const s = ((t - 1) * FALL_SECONDS) / SINK_SECONDS;
      pivot.position.y = baseY - SINK_DEPTH * Math.min(1, s);
      if (s < 1) return false;
      pivot.dispose();
      return true;
    });
  }
}
