import "../src/core/startGame";
import { Engine, Scene, FreeCamera, Vector3, DirectionalLight, ShadowGenerator,
  MultiMaterial, DitheredTileFadeMaterialPlugin } from "@babylonjs/core";
import { fetchProps, loadLevels, placeProp } from "../src/engine/props";

// Load real shipped multimaterial assets and call the same placement controller
// as the world. Explicit wall-clock samples make reversals/rest deterministic.
const canvas = document.querySelector("canvas")!;
const engine = new Engine(canvas, false, { antialias: true });
const scene = new Scene(engine);
const camera = new FreeCamera("eye", new Vector3(0, 5, -20), scene);
const sun = new DirectionalLight("sun", new Vector3(0, -1, 1), scene);
const shadows = new ShadowGenerator(512, sun);
const manifest = await fetchProps("crater-lake");
const checks: string[] = [];
const check = (condition: boolean, label: string) => {
  if (!condition) throw new Error(label);
  checks.push(label);
};
const cases = [];
for (const name of ["dutch_ship_medium", "modular_wooden_pier"]) {
  const entry = manifest.props[name];
  const levels = await loadLevels(scene, "crater-lake", name, entry);
  check(levels.length === 4 && levels.every(level => level.getTotalVertices() > 0), `${name}: four real prepared GLB levels`);
  const prop = placeProp(scene, name, levels[0], shadows);
  const instances = prop.transitions.instances;
  prop.root.position.x = cases.length * 100;
  prop.root.computeWorldMatrix(true);
  for (const [i, instance] of instances.entries()) {
    instance.computeWorldMatrix(true);
    const radius = instance.getBoundingInfo().boundingSphere.radiusWorld;
    const raw = instance.sourceMesh.getRawBoundingInfo().boundingSphere.radius;
    check(Math.abs(radius - raw) < 0.01 && radius > 1,
      `${name}: level ${i} instance keeps its prepared bounds (radius ${radius.toFixed(1)} m), not a culled-as-a-point slave`);
  }
  prop.instance.computeWorldMatrix(true);
  const centre = prop.instance.getBoundingInfo().boundingSphere.centerWorld.clone();
  const eyeAt = (distance: number) => {
    camera.position.copyFrom(centre);
    camera.position.x += distance;
    camera.computeWorldMatrix();
  };
  const update = (distance: number, now: number, fades = true) => {
    eyeAt(distance);
    prop.transitions.update(scene, fades, now);
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
  const threshold = entry.lodDistances[0];
  update(3, 0);
  check(visible().join() === "0", `${name}: first placement selects near level with full coverage`);
  update(threshold + 1, 10);
  update(threshold + 1, 260);
  check(visible().join() === "0,1" && bounds(0).every(b => b.lowerBound === 0 && b.upperBound === 0.5) &&
    bounds(1).every(b => b.lowerBound === 0.5 && b.upperBound === 1), `${name}: midpoint intervals complement across every submaterial`);
  update(3, 510);
  check(visible().join() === "1", `${name}: reversal completes the active outward fade`);
  update(3, 511);
  update(3, 1011);
  check(visible().join() === "0", `${name}: stationary reversal settles back at LOD0`);
  update(threshold + 1, 1100);
  update(threshold + 1, 1600);
  update(threshold * 0.98, 1601);
  check(visible().join() === "1", `${name}: inward hysteresis preserves resting level`);
  update(3, 1700);
  update(entry.lodDistances[2] + 10, 1800, false);
  check(visible().join() === "3" && bounds(3).every(b => b.lowerBound === 0 && b.upperBound === 1),
    `${name}: underwater cancellation chooses current far level`);
  update(3, 1900, false);
  check(visible().join() === "0", `${name}: underwater inward jump chooses current near level`);
  update(threshold + 1, 2000);
  for (const instance of instances) instance.setEnabled(false);
  prop.transitions.update(scene, true, 2100);
  for (const instance of instances) instance.setEnabled(true);
  update(3, 2200);
  check(visible().join() === "0" && bounds(0).every(b => b.lowerBound === 0 && b.upperBound === 1),
    `${name}: hidden reentry discards obsolete fade`);
  check(instances.every(instance => instance.sourceMesh.getLODLevels().length === 0),
    `${name}: native instance dispatch retains each prepared level`);
  const second = placeProp(scene, `${name}_second`, levels[0], shadows);
  second.root.position.x = prop.root.position.x + entry.lodDistances[2] + 50;
  second.transitions.update(scene, true, 2300);
  check(second.transitions.instances.filter(instance => instance.isVisible).length === 1 &&
    second.transitions.instances[3].isVisible && prop.instance.isVisible,
    `${name}: shared materials retain independent placement levels`);
  second.root.dispose();
  cases.push(prop);
}
camera.position.set(45, 25, -65);
camera.setTarget(new Vector3(0, 5, 0));
Object.assign(window, { propHarness: { scene, engine, camera, checks, cases } });
document.getElementById("status")!.textContent = `${checks.length} checks passed — shipped ship and pier`;
engine.runRenderLoop(() => scene.render());
