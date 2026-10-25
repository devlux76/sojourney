import "../src/core/startGame";
import { Engine, Scene, FreeCamera, Vector3, DirectionalLight, HemisphericLight,
  ShadowGenerator, MirrorTexture, Plane, MultiMaterial, DitheredTileFadeMaterialPlugin,
  type Mesh, type PBRMaterial } from "@babylonjs/core";
import { Campfire } from "../src/play/Campfire";
import { Rucksack, EASY_START } from "../src/play/rucksack";
import { LOGS_TO_LAY, COOK_SECONDS, type FireState } from "../src/play/fireRules";
import type { Play, ViewRay } from "../src/play/Play";
import type { PlacedProp } from "../src/engine/props";
import { fetchProps } from "../src/engine/props";
import { loadLakeMask, inLake } from "../src/engine/lake";
import type { Particles } from "../src/core/particles";
import craterLake from "../src/biomes/crater-lake";

// Exercise real Campfire loading and public actions, with a small flat-ground
// Play context. Inspect its placed props rather than a duplicate test loader.
const engine = new Engine(document.querySelector("canvas")!, false, { antialias: true });
const scene = new Scene(engine);
const camera = new FreeCamera("eye", new Vector3(0, 3, -3), scene);
new HemisphericLight("sky", Vector3.Up(), scene);
const shadows = new ShadowGenerator(256, new DirectionalLight("sun", new Vector3(0, -1, 1), scene));
const mirror = new MirrorTexture("campfireMirror", 256, scene);
mirror.mirrorPlane = new Plane(0, -1, 0, 0);
mirror.renderList = [];
scene.customRenderTargets.push(mirror);
const manifest = await fetchProps(craterLake.id);
const groundManifest = await (await fetch("packs/crater-lake/ground/ground.json")).json();
await loadLakeMask(scene, groundManifest);
const rucksack = new Rucksack(EASY_START);
rucksack.packLogs(12);
const context = {
  camera, rucksack, darkness: 0, daylight: 1, rain: 0,
  ground: { getHeight: () => 2, getSlope: () => 0, blocked: () => false, onProp: () => false },
  overlay: { say: () => {} }, refresh: () => {},
};
const campfire = await Campfire.load(scene, context as unknown as Play, craterLake, shadows, manifest, mirror);
type LaidFire = { pit: PlacedProp; logs: Mesh; state: FireState; flames: Particles; smoke: Particles };
// This harness reads private state solely to inspect production-created meshes
// and lifecycle bounds; it calls public find/update methods for gameplay actions.
const fires = (campfire as unknown as { fires: LaidFire[] }).fires;
const checks: string[] = [];
const check = (condition: boolean, label: string) => {
  if (!condition) throw new Error(label);
  checks.push(label);
};
const groundRay = (x: number): ViewRay => ({ origin: new Vector3(x, 3, -2), dir: Vector3.Forward(),
  ground: { point: new Vector3(x, 2, 0), distance: 2 } });
const laying = campfire.find(groundRay(0));
check(laying?.target.kind === "ground" && laying.target.fireOk, "public targeting permits flat dry fire site");
laying!.perform("lay fire");
const fire = fires[0];
check(!!fire && rucksack.logs === 12 - LOGS_TO_LAY, "public laying consumes three logs and creates fire");
const { pit } = fire;
const instances = pit.transitions.instances;
check(instances.length === 3 && instances.every(instance => instance.getTotalVertices() > 0), "loads all three actual shipped pit levels");
check(instances.every(instance => instance.sourceMesh.getLODLevels().length === 0 &&
  !instance.sourceMesh.isPickable && instance.sourceMesh.receiveShadows), "prepared dispatch preserves fade levels, picking and shadow reception");
pit.root.computeWorldMatrix(true);
pit.instance.computeWorldMatrix(true);
const centre = pit.instance.getBoundingInfo().boundingSphere.centerWorld.clone();
const eyeAt = (distance: number) => {
  camera.position.copyFrom(centre);
  camera.position.x += distance;
  camera.computeWorldMatrix();
};
const update = (distance: number, now: number, fades = true) => {
  eyeAt(distance);
  pit.transitions.update(scene, fades, now);
};
const visible = () => instances.flatMap((instance, i) => instance.isVisible ? [i] : []);
const bounds = (i: number) => {
  const material = instances[i].material!;
  const materials = material instanceof MultiMaterial ? material.subMaterials : [material];
  return materials.map(material => {
    const plugin = material!.pluginManager!.getPlugin(DitheredTileFadeMaterialPlugin.Name) as DitheredTileFadeMaterialPlugin;
    const result = { lowerBound: -1, upperBound: -1 };
    plugin.getFadeBoundsToRef(instances[i], result);
    return result;
  });
};
update(3, 0);
check(visible().join() === "0", "first laid fire selects LOD0 at full coverage");
update(16, 10);
update(16, 260);
check(visible().join() === "0,1" && bounds(0).every(b => b.lowerBound === 0 && b.upperBound === 0.5)
  && bounds(1).every(b => b.lowerBound === 0.5 && b.upperBound === 1), "15 m transition has complementary midpoint stone coverage");
update(3, 510);
check(visible().join() === "1", "reversal completes outward fade");
update(3, 511);
update(3, 1011);
check(visible().join() === "0", "stationary reversed fire settles at LOD0");
update(16, 1100);
update(16, 1600);
update(14.7, 1601);
check(visible().join() === "1", "five-percent hysteresis prevents resting boundary churn");
update(51, 1700);
update(51, 1950);
check(visible().join() === "1,2" && bounds(1).every(b => b.upperBound === 0.5)
  && bounds(2).every(b => b.lowerBound === 0.5), "50 m transition also fades rather than switches");
update(3, 2000, false);
check(visible().join() === "0" && bounds(0).every(b => b.lowerBound === 0 && b.upperBound === 1), "water cancellation selects current near level");
update(60, 2100, false);
check(visible().join() === "2", "submerged far distance selects current LOD2");
update(3, 2200);
pit.root.setEnabled(false);
pit.transitions.update(scene, true, 2300);
pit.root.setEnabled(true);
update(3, 2400);
check(visible().join() === "0", "hidden root reentry resets obsolete fade");
// Exercise the actual placement observer, not just its controller input: lake
// entry bypasses fading, whereas equally low dry land retains timed transitions.
update(16, 2500);
pit.root.position.x = 1000;
camera.position.set(1060, -1, 0);
camera.computeWorldMatrix();
scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(scene);
check(inLake(1060, 0) && visible().join() === "2", "actual observer instantly selects LOD2 below lake surface");
camera.position.set(1010, -1, 0);
camera.computeWorldMatrix();
scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(scene);
check(visible().join() === "0", "actual submerged observer returns to near level without a stale target");
pit.root.position.set(8500, -10, 8500);
pit.root.computeWorldMatrix(true);
pit.instance.computeWorldMatrix(true);
camera.position.set(8503, -10, 8500);
camera.computeWorldMatrix();
scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(scene);
camera.position.x = 8520;
camera.computeWorldMatrix();
scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(scene);
await new Promise(resolve => setTimeout(resolve, 40));
scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(scene);
check(!inLake(camera.position.x, camera.position.z) && visible().join() === "0,1", "below-water-height dry land retains a timed fade");
pit.root.position.set(0, 2, 0);
update(3, 2700, false);
check(fire.logs.parent === pit.root && fire.logs.position.equals(Vector3.Zero()), "logs remain aligned to laid pit root");
check([...instances, fire.logs].every(mesh => mirror.renderList!.includes(mesh)), "runtime-laid stones and wood join the live mirror list");
check(instances.every(instance => shadows.getShadowMap()!.renderList!.includes(instance)), "each prepared pit level is registered with stock shadows");
campfire.find(groundRay(100))!.perform("lay fire");
const second = fires[1];
second.pit.transitions.update(scene, true, 2800);
check(second.pit.transitions.instances[2].isVisible && instances[0].isVisible,
  "multiple public placements share materials with independent selected levels");
const fireRay: ViewRay = { origin: new Vector3(0, 2, -2), dir: Vector3.Forward(), ground: null };
const targeted = campfire.find(fireRay)!;
check(targeted.target.kind === "fire" && targeted.target.phase === "laid", "existing fire remains targetable after LOD work");
for (let i = 0; i < 3; i++) targeted.perform("strike");
campfire.update(0);
check(fire.state.phase === "burning" && fire.flames.isStarted() && fire.smoke.isStarted(), "lighting still starts flame and smoke systems");
context.darkness = 1;
campfire.update(0);
check(instances.every(instance => (instance.material instanceof MultiMaterial
  ? instance.material.subMaterials : [instance.material]).every(material => (material as PBRMaterial).directIntensity === 0.25)),
  "night dimming reaches every authored stone level");
rucksack.rawFish.push({ species: "trout", lengthCm: 25 });
targeted.perform("cook fish");
const cookingMeshes = scene.meshes.filter(mesh => mesh.name === "cookStick" || mesh.name === "cookFish");
check(cookingMeshes.length === 2 && cookingMeshes.every(mesh => mirror.renderList!.includes(mesh)), "cooking meshes join the same reflection list");
campfire.update(COOK_SECONDS);
check(rucksack.cookedFish.length === 1 && cookingMeshes.every(mesh => mesh.isDisposed() && !mirror.renderList!.includes(mesh)),
  "cooking completes and disposed cooking meshes leave the mirror list");
const observerCount = scene.onBeforeActiveMeshesEvaluationObservable.observers.length;
second.pit.root.dispose();
// Babylon defers physical observer removal to the next task.
await new Promise(resolve => setTimeout(resolve, 0));
check(second.pit.transitions.instances.every(instance => instance.isDisposed() && !mirror.renderList!.includes(instance))
  && scene.onBeforeActiveMeshesEvaluationObservable.observers.length === observerCount - 1, "placement disposal removes mirror membership and frame observer");
context.darkness = 0;
campfire.update(0);
camera.position.set(2, 4, -4);
camera.setTarget(new Vector3(0, 2, 0));
Object.assign(window, { campfireHarness: { scene, engine, camera, checks, fires, campfire, mirror, bounds, update } });
document.getElementById("status")!.textContent = `${checks.length} checks passed — shipped campfire`;
engine.runRenderLoop(() => scene.render());
