import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { createParticles, Particles } from "../core/particles";
import { Play, Activity, ViewRay, Found, REACH } from "./Play";
import type { Action } from "./actions";
import { FireState, LOGS_TO_LAY, COOK_SECONDS } from "./fireRules";
import { rayNear, canLayFire } from "./targeting";
import { sounds, Crackle } from "./sounds";
import type { Fish } from "./fish";
import { WATER_Y } from "../engine/pack";
import { inLake } from "../engine/lake";
import type { Biome } from "../biomes/Biome";
import "../core/ktx2";
import "../engine/meshopt";
import { mergeLevel } from "../engine/flora";

const PIT_LOD_DISTANCES = [15, 50];
const PIT_NIGHT_DIM = 0.75;
const PIT_LEVEL = /^stone_fire_pit_LOD(\d+)$/;
const FIRE_TARGET_RADIUS = 0.8;
const FIRE_LIGHT = 6;
const EMBER_LIGHT = 1.5;
const FIRE_LIGHT_RANGE = 18;
const FIRE_COLOUR = new Color3(1, 0.55, 0.2);
const EMBER_COLOUR = new Color3(0.7, 0.15, 0.02);
const BARK = new Color3(0.3, 0.2, 0.13);
const ASH = new Color3(0.35, 0.34, 0.33);
const CRACKLE_RANGE = 25;
const FLAME_RATE = 80;

interface Fire {
  state: FireState;
  position: Vector3;
  pit: InstancedMesh;
  logs: Mesh;
  logMaterial: StandardMaterial;
  flames: Particles;
  smoke: Particles;
}

interface Cooking { fire: Fire; fish: Fish; left: number; stick: Mesh; fishMesh: Mesh; fishMaterial: StandardMaterial }

const SMOKE_COLOUR_1 = new Color4(0.66, 0.7, 0.76, 0.3);
const SMOKE_COLOUR_2 = new Color4(0.58, 0.62, 0.68, 0.24);
const SMOKE_DEAD_COLOUR = new Color4(0.6, 0.64, 0.7, 0);
const SMOKE_CLOSE_THICKNESS = 0.2;
const SMOKE_THIN_NEAR = 2;
const SMOKE_THIN_FAR = 6;

export class Campfire implements Activity {
  private fires: Fire[] = [];
  private flare: Texture;
  private puff: DynamicTexture;
  private light: PointLight;
  private crackle: Crackle;
  private cooking: Cooking | null = null;

  static async load(scene: Scene, play: Play, biome: Biome, shadows: ShadowGenerator): Promise<Campfire> {
    const container = await LoadAssetContainerAsync(`packs/${biome.id}/props/stone_fire_pit.glb`, scene);
    container.addAllToScene();
    const stone = container.materials.find((material): material is PBRMaterial => material instanceof PBRMaterial)!;
    stone.usePhysicalLightFalloff = false;
    const levels: Mesh[] = [];
    for (const mesh of container.meshes) {
      const level = PIT_LEVEL.exec(mesh.name);
      if (level && mesh instanceof Mesh && mesh.getTotalVertices() > 0) {
        mesh.computeWorldMatrix(true);
        levels[Number(level[1])] = mergeLevel([mesh]);
      }
      mesh.setEnabled(false);
    }
    levels.slice(1).forEach((level, i) => levels[0].addLODLevel(PIT_LOD_DISTANCES[i], level));
    for (const level of levels) {
      level.setEnabled(false);
      level.isPickable = false;
      level.receiveShadows = true;
    }
    return new Campfire(scene, play, levels[0], stone, shadows, biome.campfireRainAudio);
  }

  private constructor(private scene: Scene, private play: Play, private pitSource: Mesh, private pitMaterial: PBRMaterial, private shadows: ShadowGenerator,
    rainHiss: Biome["campfireRainAudio"]) {
    this.crackle = new Crackle(rainHiss);
    this.flare = new Texture("textures/flare.png", scene);
    this.puff = softPuff(scene);
    this.light = new PointLight("campfireLight", Vector3.Zero(), scene);
    this.light.diffuse = FIRE_COLOUR;
    this.light.specular = FIRE_COLOUR.scale(0.2);
    this.light.range = FIRE_LIGHT_RANGE;
    this.light.intensity = 0;
  }

  find(ray: ViewRay): Found | null {
    let best: Found | null = null;
    for (const fire of this.fires) {
      const d = rayNear(ray.origin, ray.dir, fire.position, FIRE_TARGET_RADIUS, REACH);
      if (d === null || (best && d >= best.distance)) continue;
      best = {
        target: { kind: "fire", phase: fire.state.phase, canAddLog: fire.state.canAddLog(), cooking: !!this.cooking },
        distance: d,
        perform: action => this.act(fire, action),
      };
    }
    if (best) return best;
    const g = ray.ground;
    if (!g || g.distance > REACH) return null;
    // The water margin only applies in the lake; dry land below lake level is fine for a fire.
    // No fire can be laid from a deck either, even onto the shore beside it.
    const fireOk = !this.play.ground.onProp(ray.origin.x, ray.origin.z)
      && canLayFire(g.point, this.play.ground, inLake(g.point.x, g.point.z) ? WATER_Y : -Infinity, this.fires.map(f => f.position));
    return { target: { kind: "ground", fireOk }, distance: g.distance, perform: () => this.lay(g.point) };
  }

  update(dt: number) {
    this.pitMaterial.directIntensity = 1 - PIT_NIGHT_DIM * this.play.darkness;
    const now = performance.now() / 1000, me = this.play.camera.globalPosition;
    let nearest: Fire | null = null, nearestDistance = Infinity;
    for (const fire of this.fires) {
      fire.state.tick(dt);
      this.show(fire);
      const d = Vector3.Distance(me, fire.position);
      this.shadeSmoke(fire.smoke, d);
      if ((fire.state.phase === "burning" || fire.state.phase === "embers") && d < nearestDistance) {
        nearest = fire;
        nearestDistance = d;
      }
    }
    const burning = nearest?.state.phase === "burning";
    if (nearest) {
      this.light.position.set(nearest.position.x, nearest.position.y + 0.7, nearest.position.z);
      const flicker = 0.85 + 0.1 * Math.sin(now * 13) + 0.05 * Math.sin(now * 29.7);
      const strength = burning ? FIRE_LIGHT * nearest.state.flame() * flicker : EMBER_LIGHT * nearest.state.glow();
      this.light.intensity = strength * (1 / 3 + (2 / 3) * this.play.darkness);
    } else {
      this.light.intensity = 0;
    }
    this.crackle.setLevel(nearest ? (burning ? 1 : 0.3) * Math.max(0, 1 - nearestDistance / CRACKLE_RANGE) : 0, this.play.rain);
    this.crackle.update(now);
    this.updateCooking(dt);
  }

  private act(fire: Fire, action: Action) {
    const r = this.play.rucksack;
    if (action === "strike") {
      sounds.spark();
      fire.state.strike();
    } else if (action === "add log" && r.takeLogs(1)) {
      fire.state.addLog();
      sounds.pack();
    } else if (action === "cook fish") {
      this.cook(fire);
    }
  }

  private lay(p: { x: number; z: number }) {
    if (!this.play.rucksack.takeLogs(LOGS_TO_LAY)) return;
    const position = new Vector3(p.x, this.play.ground.getHeight(p.x, p.z), p.z);
    const pit = this.pitSource.createInstance("fireStones");
    pit.position.copyFrom(position);
    this.shadows.addShadowCaster(pit);
    const sticks = [0, 1, 2].map(i => {
      const a = (i / 3) * Math.PI * 2;
      const s = MeshBuilder.CreateCylinder("fireLog", { height: 0.8, diameter: 0.12, tessellation: 8 }, this.scene);
      s.position.set(Math.sin(a) * 0.14, 0.3, Math.cos(a) * 0.14);
      s.rotation.set(-0.45, a, 0);
      return s;
    });
    const logs = Mesh.MergeMeshes(sticks, true)!;
    logs.position.copyFrom(position);
    const logMaterial = new StandardMaterial("fireLogMat", this.scene);
    logMaterial.diffuseColor = BARK.clone();
    logMaterial.specularColor = Color3.Black();
    logs.material = logMaterial;
    const fire: Fire = {
      state: new FireState(Math.random()), position, pit, logs, logMaterial,
      flames: this.flames(position), smoke: this.smoke(position),
    };
    this.fires.push(fire);
    sounds.pack();
  }

  private flames(at: Vector3): Particles {
    const ps = createParticles("flames", 150, this.scene);
    ps.particleTexture = this.flare;
    ps.emitter = at.add(new Vector3(0, 0.1, 0));
    ps.minEmitBox = new Vector3(-0.2, 0, -0.2);
    ps.maxEmitBox = new Vector3(0.2, 0.1, 0.2);
    ps.color1 = new Color4(1, 0.6, 0.2, 1);
    ps.color2 = new Color4(1, 0.3, 0.05, 1);
    ps.colorDead = new Color4(0.2, 0.05, 0, 0);
    ps.minSize = 0.15;
    ps.maxSize = 0.35;
    ps.minLifeTime = 0.3;
    ps.maxLifeTime = 0.7;
    ps.direction1 = new Vector3(-0.1, 1, -0.1);
    ps.direction2 = new Vector3(0.1, 1.5, 0.1);
    ps.minEmitPower = 0.5;
    ps.maxEmitPower = 1;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.emitRate = FLAME_RATE;
    return ps;
  }

  private smoke(at: Vector3): Particles {
    const ps = createParticles("smoke", 80, this.scene);
    ps.particleTexture = this.puff;
    ps.emitter = at.add(new Vector3(0, 0.6, 0));
    ps.minEmitBox = new Vector3(-0.1, 0, -0.1);
    ps.maxEmitBox = new Vector3(0.1, 0, 0.1);
    ps.color1 = SMOKE_COLOUR_1.clone();
    ps.color2 = SMOKE_COLOUR_2.clone();
    ps.colorDead = SMOKE_DEAD_COLOUR.clone();
    ps.minSize = 0.15;
    ps.maxSize = 0.3;
    ps.addSizeGradient(0, 1);
    ps.addSizeGradient(1, 3.5);
    ps.minInitialRotation = 0;
    ps.maxInitialRotation = Math.PI * 2;
    ps.minAngularSpeed = -0.3;
    ps.maxAngularSpeed = 0.3;
    ps.minLifeTime = 3;
    ps.maxLifeTime = 5;
    ps.direction1 = new Vector3(-0.2, 1, -0.2);
    ps.direction2 = new Vector3(0.2, 1.2, 0.2);
    ps.minEmitPower = 0.3;
    ps.maxEmitPower = 0.6;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitRate = 10;
    return ps;
  }

  private shadeSmoke(smoke: Particles, distance: number) {
    const light = Math.pow(this.play.daylight, 1 / 2.2);
    const t = Math.min(1, Math.max(0, (distance - SMOKE_THIN_NEAR) / (SMOKE_THIN_FAR - SMOKE_THIN_NEAR)));
    const thickness = SMOKE_CLOSE_THICKNESS + (1 - SMOKE_CLOSE_THICKNESS) * t * t * (3 - 2 * t);
    for (const [colour, base] of [[smoke.color1, SMOKE_COLOUR_1], [smoke.color2, SMOKE_COLOUR_2], [smoke.colorDead, SMOKE_DEAD_COLOUR]] as const)
      colour.set(base.r * light, base.g * light, base.b * light, base.a * thickness);
  }

  private show(fire: Fire) {
    const { state, flames, smoke, logMaterial } = fire;
    const lit = state.phase === "burning", glowing = state.phase === "embers";
    if (lit !== flames.isStarted()) lit ? flames.start() : flames.stop();
    if ((lit || glowing) !== smoke.isStarted()) lit || glowing ? smoke.start() : smoke.stop();
    flames.emitRate = FLAME_RATE * state.flame();
    smoke.emitRate = lit ? 10 : 3;
    logMaterial.diffuseColor.copyFrom(state.phase === "ash" ? ASH : BARK);
    if (lit) FIRE_COLOUR.scaleToRef(0.6, logMaterial.emissiveColor);
    else EMBER_COLOUR.scaleToRef(state.glow(), logMaterial.emissiveColor);
  }

  private cook(fire: Fire) {
    if (this.cooking) return;
    const fish = this.play.rucksack.rawFish.shift();
    if (!fish) return;
    const stick = MeshBuilder.CreateCylinder("cookStick", { height: 1.3, diameter: 0.02 }, this.scene);
    stick.position = fire.position.add(new Vector3(0.45, 0.55, 0));
    stick.rotation.z = 1.1;
    stick.material = fire.logMaterial;
    const fishMesh = MeshBuilder.CreateSphere("cookFish", { diameter: 1, segments: 8 }, this.scene);
    fishMesh.scaling.set(fish.lengthCm / 100, 0.05, 0.08);
    fishMesh.position = fire.position.add(new Vector3(0, 0.75, 0));
    const fishMaterial = new StandardMaterial("cookFishMat", this.scene);
    fishMaterial.diffuseColor = new Color3(0.7, 0.72, 0.7);
    fishMesh.material = fishMaterial;
    this.cooking = { fire, fish, left: COOK_SECONDS, stick, fishMesh, fishMaterial };
    this.play.overlay.say(`Cooking your ${fish.species}...`, 3);
    this.play.refresh();
  }

  private updateCooking(dt: number) {
    const c = this.cooking;
    if (!c) return;
    c.left -= dt;
    const done = 1 - Math.max(0, c.left) / COOK_SECONDS;
    Color3.LerpToRef(new Color3(0.7, 0.72, 0.7), new Color3(0.55, 0.33, 0.12), done, c.fishMaterial.diffuseColor);
    if (c.left > 0) return;
    c.stick.dispose();
    c.fishMesh.dispose();
    c.fishMaterial.dispose();
    this.play.rucksack.cookedFish.push(c.fish);
    this.play.overlay.say(`Your ${c.fish.species} is cooked.`);
    this.play.refresh();
    this.cooking = null;
  }
}

function softPuff(scene: Scene): DynamicTexture {
  const size = 64;
  const texture = new DynamicTexture("smokePuff", size, scene, false);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.45)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  texture.hasAlpha = true;
  texture.update();
  return texture;
}
