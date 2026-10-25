import { Scene, Mesh, MeshBuilder, MultiMaterial, PBRMaterial, Color3, Color4, Vector3,
  ParticleSystem, Texture, PointLight, DynamicTexture, type AbstractMesh, type BaseTexture, type MirrorTexture, type ShadowGenerator } from "@babylonjs/core";
import { playMaterial, playWoodMaterial, woodFaceUV, playShadows, compensateEmission } from "./materials";
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
import { loadLevels, placeProp, type PlacedProp } from "../engine/props";
import type { PropsManifest } from "../engine/pack";

const PIT_NIGHT_DIM = 0.75;
const FIRE_TARGET_RADIUS = 0.8;
const FIRE_LIGHT = 6;
const EMBER_LIGHT = 1.5;
const FIRE_LIGHT_RANGE = 18;
const FIRE_COLOUR = new Color3(1, 0.55, 0.2);
const EMBER_COLOUR = new Color3(0.7, 0.15, 0.02);
// Uncharred albedo factor: the authored wood map carries the brown, so the PBR
// factor stays White. Ash keeps its grey tint factor; both are module constants
// copied per frame, never allocated per frame.
const WOOD = new Color3(1, 1, 1);
const ASH = new Color3(0.35, 0.34, 0.33);
const CRACKLE_RANGE = 25;
const FLAME_RATE = 80;

interface Fire {
  state: FireState;
  position: Vector3;
  pit: PlacedProp;
  logs: Mesh;
  logMaterial: PBRMaterial;
  // Preserve the shared wood albedo for burning; ash is an untinted grey surface.
  logAlbedo: BaseTexture | null;
  flames: Particles;
  smoke: Particles;
}

interface Cooking { fire: Fire; fish: Fish; left: number; stick: Mesh; fishMesh: Mesh; fishMaterial: PBRMaterial }

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

  static async load(scene: Scene, play: Play, biome: Biome, shadows: ShadowGenerator,
    manifest: PropsManifest, mirror: MirrorTexture): Promise<Campfire> {
    // The authored manifest and shared prop loader now own the pit's levels too;
    // an automatic source LOD chain would bypass its half-second placed fade.
    const levels = await loadLevels(scene, biome.id, "stone_fire_pit", manifest.props.stone_fire_pit);
    const stones = [...new Set(levels.flatMap(level => level.material instanceof MultiMaterial
      ? level.material.subMaterials : [level.material]))];
    if (!stones.every((material): material is PBRMaterial => material instanceof PBRMaterial))
      throw new Error("Fire pit requires PBR stone materials");
    for (const stone of stones) stone.usePhysicalLightFalloff = false;
    return new Campfire(scene, play, levels[0], stones, shadows, mirror, biome.campfireRainAudio);
  }

  private constructor(private scene: Scene, private play: Play, private pitSource: Mesh, private pitMaterials: PBRMaterial[], private shadows: ShadowGenerator,
    private mirror: MirrorTexture,
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
    for (const material of this.pitMaterials) material.directIntensity = 1 - PIT_NIGHT_DIM * this.play.darkness;
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
    // Every laid fire has independent coverage on shared stone materials. The
    // placement observer updates before active-list and mirror evaluation, and
    // discards obsolete fades after hiding or submerged lake entry.
    const pit = placeProp(this.scene, "fireStones", this.pitSource, this.shadows);
    pit.root.position.copyFrom(position);
    const sticks = [0, 1, 2].map(i => {
      const a = (i / 3) * Math.PI * 2;
      // Fire logs read the same authored wood maps as chopped logs, with metric
      // side UVs at the bake's texel density. Tessellation and placement stay.
      const s = MeshBuilder.CreateCylinder("fireLog", { height: 0.8, diameter: 0.12, tessellation: 8,
        faceUV: woodFaceUV(Math.PI * 0.12, 0.8) }, this.scene);
      s.position.set(Math.sin(a) * 0.14, 0.3, Math.cos(a) * 0.14);
      s.rotation.set(-0.45, a, 0);
      return s;
    });
    const logs = Mesh.MergeMeshes(sticks, true)!;
    logs.parent = pit.root;
    const logMaterial = playWoodMaterial("fireLogMat", this.scene);
    playShadows(logs);
    // The light sits very close to the log tops: let their controlled ember emission
    // light the wood itself, while the point light illuminates the surrounding scene.
    this.light.excludedMeshes.push(logs);
    logs.material = logMaterial;
    const fire: Fire = {
      state: new FireState(Math.random()), position, pit, logs, logMaterial, logAlbedo: logMaterial.albedoTexture,
      flames: this.flames(position), smoke: this.smoke(position),
    };
    // Fires arrive after the world's reflection list is built. Register each
    // authored level, plus its wood, rather than leaving only LOD0 reflected.
    this.reflect([...pit.transitions.instances, logs]);
    this.fires.push(fire);
    sounds.pack();
  }

  private reflect(meshes: AbstractMesh[]) {
    this.mirror.renderList ??= [];
    this.mirror.renderList.push(...meshes);
    for (const mesh of meshes) mesh.onDisposeObservable.add(() => {
      const list = this.mirror.renderList;
      const index = list?.indexOf(mesh) ?? -1;
      if (index >= 0) list!.splice(index, 1);
    });
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
    // Ash must not multiply its grey tint by the brown wood image.
    logMaterial.albedoTexture = state.phase === "ash" ? null : fire.logAlbedo;
    logMaterial.albedoColor.copyFrom(state.phase === "ash" ? ASH : WOOD);
    compensateEmission(logMaterial);
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
    playShadows(stick);
    const fishMesh = MeshBuilder.CreateSphere("cookFish", { diameter: 1, segments: 8 }, this.scene);
    fishMesh.scaling.set(fish.lengthCm / 100, 0.05, 0.08);
    fishMesh.position = fire.position.add(new Vector3(0, 0.75, 0));
    const fishMaterial = playMaterial("cookFishMat", this.scene, new Color3(0.7, 0.72, 0.7), 0, 0.55);
    fishMesh.material = fishMaterial;
    playShadows(fishMesh);
    this.reflect([stick, fishMesh]);
    this.cooking = { fire, fish, left: COOK_SECONDS, stick, fishMesh, fishMaterial };
    this.play.overlay.say(`Cooking your ${fish.species}...`, 3);
    this.play.refresh();
  }

  private updateCooking(dt: number) {
    const c = this.cooking;
    if (!c) return;
    c.left -= dt;
    const done = 1 - Math.max(0, c.left) / COOK_SECONDS;
    Color3.LerpToRef(new Color3(0.7, 0.72, 0.7), new Color3(0.55, 0.33, 0.12), done, c.fishMaterial.albedoColor);
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
