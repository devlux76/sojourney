import { DitheredTileFadeMaterialPlugin, Matrix, Mesh, PBRMaterial, Vector3, type Scene } from "@babylonjs/core";
import { Flora } from "../src/engine/flora";

// Exercise actual list builders, sorter and Babylon fade attributes across a
// cell's exit/reentry. Synthetic placements isolate lifecycle from pack loading.
export function verifyFloraReentry(scene: Scene): string[] {
  const material = new PBRMaterial("reentryProbe", scene);
  const plugin = DitheredTileFadeMaterialPlugin.GetOrCreate(material);
  const meshes: Mesh[] = [];
  const draw = (name: string, fading = false) => {
    const mesh = new Mesh(`reentryProbe_${name}`, scene);
    mesh.material = material;
    meshes.push(mesh);
    return { mesh, buffer: new Float32Array(0), fades: new Float32Array(0),
      fade: fading ? [plugin] : [], count: 0, grown: false };
  };
  const cell = { x: 0, z: 0, radius: 1, first: 0, count: 1, minY: -1, maxY: 1 };
  // The second record is a sentinel outside this cell's range. Resetting one
  // cell must leave neighboring records' live transition state untouched.
  const file = { matrices: Float32Array.from([...Matrix.Identity().asArray(), ...Matrix.Identity().asArray()]),
    reach: new Float32Array([1000, 1000]), xz: new Uint32Array(2),
    shown: new Uint8Array([255, 1]), goal: new Uint8Array(2),
    fadeStart: new Float32Array([-1, 900]), cells: [[cell]] };
  const leaf = { near: file, info: { x: -1, z: -1, size: 2, heightMin: -1, heightScale: 0 } };
  const batch = { species: { lodDistances: [8] }, sortReach: 33, boundsRadius: 1,
    levels: [draw("LOD0", true), draw("LOD1", true)], far: draw("far"), beyond: draw("beyond") };
  const probe = Object.create(Flora.prototype);
  Object.assign(probe, { leaves: [leaf], batches: [batch], nearCells: [],
    waterRadius: Infinity, reach: Infinity, zoom: 1, fades: true,
    shadowReach: 100, fadesUntil: 0, fading: false });
  const eye = Vector3.Zero();
  const results: string[] = [];
  const check = (value: boolean, message: string) => {
    if (!value) throw new Error(message);
    results.push(message);
  };
  const reset = () => {
    probe.waterRadius = probe.reach = Infinity;
    file.shown[0] = 255; file.fadeStart[0] = -1;
    eye.set(7, 0, 0); probe.buildFar(eye); probe.sortNear(eye, 1000);
    eye.x = 9; probe.sortNear(eye, 1001);
    check(file.goal[0] === 1 && file.fadeStart[0] >= 0,
      "Fixture begins an outward LOD0/LOD1 fade");
  };
  const reenter = (message: string) => {
    probe.waterRadius = probe.reach = Infinity;
    eye.set(3, 0, 0); probe.buildFar(eye); probe.sortNear(eye, 1100);
    check(file.shown[0] === 0 && file.fadeStart[0] === -1 &&
      batch.levels[0].mesh.thinInstanceCount === 1 && batch.levels[1].count === 0 && !probe.fading,
      message);
    // Babylon retains custom thin-instance attribute data in this storage;
    // inspect it without depending on a nonexistent public buffer getter.
    const storage = Reflect.get(batch.levels[0].mesh, "_userThinInstanceBuffersStorage");
    const bounds = storage?.data[`ditheredTileFade${material.uniqueId}`];
    check(bounds?.[0] === 0 && bounds[1] === 1,
      "Reentered record uploads full coverage through Babylon's fade plugin");
  };
  try {
    reset();
    eye.x = 100; probe.buildFar(eye); probe.sortNear(eye, 1050);
    check(batch.far.count === 1 && batch.levels.every(level => level.count === 0),
      "Far-list ownership removes both near levels");
    reenter("Returning from the far list selects LOD0 immediately instead of resuming the old goal");
    reset();
    probe.waterRadius = 5; eye.y = -40; probe.buildFar(eye); probe.sortNear(eye, 1050);
    reenter("Returning from a depth-hidden cell selects the current LOD without an obsolete fade");
    reset();
    probe.waterRadius = 5; eye.y = -10; probe.sortNear(eye, 1050);
    reenter("Near-sort whole-cell hiding clears the fade even before a far-list rebuild");
    reset();
    probe.reach = 1; eye.x = 1000; probe.buildFar(eye); probe.sortNear(eye, 1050);
    reenter("Returning from a rain-hidden cell selects the current LOD without an obsolete fade");
    check(file.shown[1] === 1 && file.fadeStart[1] === 900,
      "Cell resets preserve neighboring records' transition state");
    // An uninterrupted cell keeps its timed transition and hysteresis.
    reset();
    probe.buildFar(eye); probe.sortNear(eye, 1251);
    check(batch.levels[0].count === 1 && batch.levels[1].count === 1 && file.fadeStart[0] === 1001,
      "Rebuilding a continuously near cell preserves its active fade");
    probe.sortNear(eye, 1502); probe.sortNear(eye, 1503);
    eye.x = 7.8; probe.sortNear(eye, 1504);
    check(file.shown[0] === 1 && file.fadeStart[0] === -1 && !probe.fading,
      "Continuously near records retain settled LOD hysteresis");
    return results;
  } finally {
    for (const mesh of meshes) mesh.dispose();
    material.dispose();
  }
}
