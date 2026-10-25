import { Matrix, Mesh, Vector3, type Scene } from "@babylonjs/core";
import { Flora } from "../src/engine/flora";

// Isolate asynchronous full-file ownership from the remaining load queue. The
// production builders upload to actual Babylon buffers; no pack files are changed.
export async function verifyFloraOwnership(scene: Scene): Promise<string[]> {
  const meshes: Mesh[] = [];
  const draw = (name: string) => {
    const mesh = new Mesh(`ownershipProbe_${name}`, scene);
    meshes.push(mesh);
    return { mesh, buffer: new Float32Array(0), fades: new Float32Array(0),
      fade: [], count: 0, grown: false };
  };
  const cell = { x: 100, z: 0, radius: 1, first: 0, count: 2, minY: -1, maxY: 1 };
  const file = (count: number) => ({
    matrices: Float32Array.from(Array.from({ length: count }, (_, i) =>
      Matrix.Translation(100 + i, 0, 0).asArray()).flat()),
    reach: new Float32Array(count).fill(1000), xz: new Uint32Array(count),
    shown: new Uint8Array(count).fill(255), goal: new Uint8Array(count),
    fadeStart: new Float32Array(count).fill(-1), cells: [[{ ...cell, count }]],
  });
  const near = file(2);
  const leaf = { id: 0, info: { x: 90, z: -10, size: 20, heightMin: 0, heightScale: 0 },
    near: null, mid: file(1), nearJob: null, midJob: null };
  const batch = { species: { lodDistances: [] }, sortReach: 25, boundsRadius: 1,
    levels: [draw("level")], far: draw("far"), beyond: draw("beyond"), mid: draw("mid") };
  const eye = Vector3.Zero();
  const probe = Object.create(Flora.prototype);
  Object.assign(probe, { scene: { activeCamera: { globalPosition: eye } },
    manifest: { leaves: [[2, 1]], leavesUrl: "probe/", cellMetres: 20, midMetres: 2000 },
    leaves: [leaf], batches: [batch], standing: new Map(), felled: new Map(),
    waterRadius: Infinity, waterRadiusSeen: Infinity, rainReach: Infinity,
    reach: Infinity, reachBuilt: Infinity, zoom: 1, zoomSeen: 1, fades: true, fadesSeen: true,
    fadesUntil: 0, fading: false, shadowReach: 0, loading: 1, changed: false,
    builtAt: performance.now(), farAt: null, midAt: null, sortedAt: null, nearbyAt: null,
    stream: () => {}, findNearby: () => {}, decode: async () => near });
  const results: string[] = [];
  const check = (value: boolean, message: string) => {
    if (!value) throw new Error(message);
    results.push(message);
  };
  try {
    probe.update();
    check(batch.mid.mesh.thinInstanceCount === 1 && batch.beyond.count === 0,
      "Unloaded full file leaves the middle card as sole owner");
    await probe.loadNear(leaf);
    eye.x = 30;
    probe.update();
    check(batch.mid.count === 0 && !batch.mid.mesh.isEnabled() && batch.beyond.mesh.thinInstanceCount === 2,
      "Arrival plus travel transfers ownership without duplicate middle cards while other loads remain");
    probe.unloadNear(leaf);
    probe.update();
    check(batch.mid.mesh.thinInstanceCount === 1 && batch.beyond.count === 0 && !batch.beyond.mesh.isEnabled(),
      "Release restores middle cards in the same update without an empty ownership interval");
    await probe.loadNear(leaf);
    probe.update();
    check(batch.mid.count === 1 && batch.beyond.count === 0 && probe.changed,
      "Stationary arrival keeps its existing sole owner while uploads are batched");
    probe.builtAt = performance.now() - 1001;
    probe.update();
    check(batch.mid.count === 0 && batch.beyond.count === 2,
      "Arrival throttle expiry transfers both stationary lists together");
    const midAt = probe.midAt;
    await probe.loadNear(leaf);
    probe.update();
    check(probe.midAt === midAt, "Already-loaded preparation keeps stationary middle buffers cached");
    probe.unloadNear(leaf);
    probe.changed = true;
    probe.update();
    check(batch.mid.count === 1 && !probe.changed,
      "Forced publication includes pending middle-file arrivals without a redundant rebuild");
    probe.loading = 0;
    probe.update();
    check(!probe.changed && batch.mid.count === 1 && batch.beyond.count === 0,
      "Queue completion settles with exactly one owner and no pending rebuild");
    return results;
  } finally {
    for (const mesh of meshes) mesh.dispose();
  }
}
