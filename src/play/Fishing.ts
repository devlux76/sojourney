import { playMaterial, playShadows } from "./materials";
import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Play, Activity, ViewRay, Found, CAST_REACH } from "./Play";
import { FishingLine, Fight, Fish, castPower, castDistance } from "./fish";
import { rayWater, castLanding, V3 } from "./targeting";
import { sounds, fishingSounds, type FishingSounds } from "./sounds";
import { WATER_Y } from "../engine/pack";
import { inLake } from "../engine/lake";
import type { Biome } from "../biomes/Biome";

const MIN_DEPTH = 0.2;
const LINE_LENGTH = 50;
const flightSeconds = (d: number) => 0.5 + 0.035 * d;
const arcHeight = (d: number) => 1 + 0.15 * d;
const HOOKED_DIP = 0.12;
const RATCHET_SECONDS = 0.07;
const DRAG_SECONDS = 0.035;
const RIPPLE_SECONDS = 1;

export class Fishing implements Activity {
  private line: FishingLine;
  private fx: FishingSounds;
  private bobber: Mesh;
  private ripple: Mesh;
  private rippleMaterial: StandardMaterial;
  private lineMesh: LinesMesh | null = null;
  private castFrom = Vector3.Zero();
  private castTo = Vector3.Zero();
  private castStart = 0;
  private castSeconds = 1;
  private castArc = 1;
  private landed = true;
  private windStart: number | null = null;
  private nextTick = 0;
  private rippleStart = -Infinity;

  constructor(private scene: Scene, private play: Play, biome: Biome) {
    this.line = new FishingLine(biome.fish);
    this.fx = fishingSounds(biome.fishingAudio);
    this.bobber = MeshBuilder.CreateSphere("bobber", { diameter: 0.08, segments: 8 }, scene);
    // A coloured dielectric bobber follows the same atmosphere lighting as the shore.
    const red = playMaterial("bobberMat", scene, new Color3(0.85, 0.12, 0.1), 0, 0.6);
    this.bobber.material = red;
    this.bobber.isPickable = false;
    playShadows(this.bobber);
    this.bobber.setEnabled(false);

    this.ripple = MeshBuilder.CreateTorus("biteRipple", { diameter: 1, thickness: 0.02, tessellation: 32 }, scene);
    this.rippleMaterial = new StandardMaterial("biteRippleMat", scene);
    this.rippleMaterial.disableLighting = true;
    this.rippleMaterial.emissiveColor = new Color3(0.8, 0.85, 0.9);
    this.ripple.material = this.rippleMaterial;
    this.ripple.isPickable = false;
    this.ripple.setEnabled(false);

    play.lineState = () => this.line.state.kind;
    play.reel = () => this.drop();
    play.fight = () => this.line.state.kind === "hooked" ? this.line.state.fight : null;
    play.windUp = () => this.windStart === null ? null : castPower(performance.now() / 1000 - this.windStart);
    play.releaseCast = () => this.release();
    play.refresh();
  }

  find(ray: ViewRay): Found | null {
    if (this.line.state.kind !== "idle") return null;
    const water = rayWater(ray.origin, ray.dir, WATER_Y, CAST_REACH);
    if (!water) return null;
    if (ray.ground && ray.ground.distance < water.distance) return null;
    if (!inLake(water.point.x, water.point.z) || this.play.ground.getHeight(water.point.x, water.point.z) > WATER_Y - MIN_DEPTH) return null;
    return { target: { kind: "water" }, distance: water.distance, perform: () => { this.windStart = performance.now() / 1000; } };
  }

  update(dt: number) {
    if (this.line.state.kind === "idle") return;
    const now = performance.now() / 1000;
    const eye = this.play.camera.globalPosition;
    // Fishing from the boat, the bait and the line's flight travel with it, so the line does not
    // stretch away astern.
    const carried = this.play.vesselStep();
    if (carried) {
      Vector3.TransformCoordinatesToRef(this.castTo, carried, this.castTo);
      Vector3.TransformCoordinatesToRef(this.castFrom, carried, this.castFrom);
    }
    // The fight starts on the bite itself, from where the bait lies; the player is not asked to answer first.
    if (this.line.update(now, Math.random, Math.hypot(this.castTo.x - eye.x, this.castTo.z - eye.z)) === "bite") {
      sounds.splash();
      this.play.refresh();
    }
    const fight = this.line.state.kind === "hooked" ? this.line.state.fight : null;
    if (fight && this.fightStep(fight, dt, now)) return;
    if (fight && now - this.rippleStart >= RIPPLE_SECONDS) this.rippleStart = now;
    const t = (now - this.castStart) / this.castSeconds;
    if (t < 1) {
      Vector3.LerpToRef(this.castFrom, this.castTo, t, this.bobber.position);
      this.bobber.position.y += this.castArc * 4 * t * (1 - t);
    } else {
      if (!this.landed) {
        this.landed = true;
        this.fx.plop();
        const out = Math.hypot(this.castTo.x - this.play.camera.globalPosition.x, this.castTo.z - this.play.camera.globalPosition.z);
        this.play.overlay.say(`${Math.round(out)} m out`, 2);
      }
      const tug = fight ? HOOKED_DIP * fight.tension : 0;
      this.bobber.position.copyFrom(this.castTo);
      this.bobber.position.y = WATER_Y + 0.02 + 0.01 * Math.sin(now * 2) - tug;
    }
    this.updateRipple(now);
    this.lineMesh = MeshBuilder.CreateLines("fishingLine",
      { points: [this.play.rodTip(), this.bobber.position.clone()], instance: this.lineMesh ?? undefined, updatable: true }, this.scene);
    this.lineMesh.color = new Color3(0.85, 0.85, 0.8);
    if (Vector3.Distance(this.play.camera.globalPosition, this.castTo) > LINE_LENGTH) this.drop();
  }

  private release() {
    if (this.windStart === null) return;
    const distance = castDistance(castPower(performance.now() / 1000 - this.windStart));
    this.windStart = null;
    const eye = this.play.camera.globalPosition;
    const view = this.play.camera.getDirection(Vector3.Forward());
    const heading = new Vector3(view.x, 0, view.z).normalize();
    // Low land outside the caldera is below lake level too, so deep water also needs to be inside the lake mask.
    const deep = (x: number, z: number) => inLake(x, z) && this.play.ground.getHeight(x, z) <= WATER_Y - MIN_DEPTH;
    const landing = castLanding(eye, heading, distance, deep);
    if (landing) this.cast(landing);
    else this.play.overlay.say("No water that way.", 2);
  }

  private cast(point: V3) {
    this.castFrom = this.play.rodTip();
    this.castTo = new Vector3(point.x, WATER_Y, point.z);
    const distance = Math.hypot(point.x - this.castFrom.x, point.z - this.castFrom.z);
    this.castSeconds = flightSeconds(distance);
    this.castArc = arcHeight(distance);
    this.castStart = performance.now() / 1000;
    this.landed = false;
    this.line.cast(this.castStart + this.castSeconds, Math.random);
    this.bobber.position.copyFrom(this.castFrom);
    this.bobber.setEnabled(true);
    sounds.cast();
    sounds.spool(this.castSeconds);
  }

  private drop() {
    this.windStart = null;
    if (this.line.state.kind === "idle") return;
    if (this.line.state.kind === "hooked") this.play.overlay.say("The fish got away.", 3);
    this.lineIn(null);
  }

  private fightStep(fight: Fight, dt: number, now: number): boolean {
    const reeling = this.play.enterDown;
    const end = fight.update(dt, reeling, Math.random);
    const eye = this.play.camera.globalPosition;
    const away = new Vector3(this.castTo.x - eye.x, 0, this.castTo.z - eye.z).normalize();
    this.castTo.set(eye.x + away.x * fight.distance, WATER_Y, eye.z + away.z * fight.distance);
    // With recordings the reel and the fish sound while reeling; the ticks are left for the drag.
    const recorded = this.fx.reeling(reeling);
    if (now >= this.nextTick && (reeling ? !recorded : fight.tension > 0)) {
      this.nextTick = now + (reeling ? RATCHET_SECONDS : DRAG_SECONDS);
      sounds.tick(reeling ? 3000 : 5000, reeling ? 0.2 : 0.1);
    }
    if (!end) return false;
    if (end === "snapped") this.play.overlay.say("Snap! The line broke.", 3);
    if (end === "lost") this.play.overlay.say("Too much slack: it threw the hook.", 3);
    this.lineIn(end === "landed" ? fight.fish : null);
    return true;
  }

  private lineIn(fish: Fish | null) {
    this.line.reel();
    this.fx.reeling(false);
    this.bobber.setEnabled(false);
    this.ripple.setEnabled(false);
    this.lineMesh?.dispose();
    this.lineMesh = null;
    sounds.reel();
    if (fish) {
      sounds.splash();
      this.play.rucksack.rawFish.push(fish);
      const species = fish.species[0].toUpperCase() + fish.species.slice(1);
      this.play.overlay.showCard(species, `${fish.lengthCm} cm`);
    }
    this.play.refresh();
  }

  private updateRipple(now: number) {
    const t = (now - this.rippleStart) / RIPPLE_SECONDS;
    const on = t >= 0 && t < 1;
    this.ripple.setEnabled(on);
    if (!on) return;
    this.ripple.position.set(this.castTo.x, WATER_Y + 0.01, this.castTo.z);
    this.ripple.scaling.setAll(0.2 + 1.3 * t);
    this.rippleMaterial.alpha = 1 - t;
  }
}
