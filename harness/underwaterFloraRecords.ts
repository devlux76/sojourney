import { Matrix, Mesh, Vector3, type Scene } from "@babylonjs/core";
import { Flora } from "../src/engine/flora";

// Exercise production record selection with mixed-height placements in one cell.
// Real Babylon buffers verify compacted ordering and immediate LOD restoration.
export function verifyUnderwaterFloraRecords(scene: Scene): string[] {
  const mesh = new Mesh("underwaterRecordProbe", scene);
  const draw = { mesh, buffer: new Float32Array(0), fades: new Float32Array(0),
    fade: [], count: 0, grown: false };
  const heights = [100, 0, 8, -100, 32, 33, -32, -33, 100];
  const matrices = new Float32Array(heights.length * 16);
  heights.forEach((height, i) => matrices.set(Matrix.Translation(i, height, 0).asArray(), i * 16));
  const batch = { boundsRadius: 2, levels: [draw], species: { lodDistances: [] } };
  const file = { matrices, reach: new Float32Array(heights.length).fill(1000),
    shown: new Uint8Array(heights.length), goal: new Uint8Array(heights.length),
    fadeStart: new Float32Array(heights.length).fill(1) };
  const cell = { first: 0, count: heights.length, minY: -102, maxY: 102 };
  const probe = Object.create(Flora.prototype);
  Object.assign(probe, { waterRadius: 5, batches: [batch], fades: false, zoom: 1,
    fadesUntil: 0, nearCells: [{ leaf: { near: file }, batch, cell }] });
  const eye = Vector3.Zero();
  const results: string[] = [];
  const check = (value: boolean, message: string) => {
    if (!value) throw new Error(message);
    results.push(message);
  };
  const append = () => {
    draw.count = 0;
    probe.appendWaterVisible(draw, batch, matrices, 0, heights.length, eye);
    return Array.from({ length: draw.count }, (_, i) => draw.buffer[i * 16 + 12]);
  };
  try {
    check(!probe.waterHides(cell, eye), "Mixed-height cell survives whole-cell culling");
    check(JSON.stringify(append()) === JSON.stringify([1, 2, 4, 6]),
      "Far/middle compaction preserves order, touching bounds and 25 m travel margin");
    const scaled = Float32Array.from(Matrix.Scaling(3, 3, 3).asArray());
    scaled[13] = 11.25;
    check(!probe.waterHidesRecord(batch, scaled, 0, eye, 0.25),
      "Scaled enclosure touching the near volume remains drawn");
    scaled[13] = 11.5;
    check(probe.waterHidesRecord(batch, scaled, 0, eye, 0.25),
      "Scaled enclosure outside the travel margin is skipped");
    probe.sortNear(eye, 10);
    check(draw.count === 1 && draw.buffer[12] === 1 && file.shown[2] === 255 && file.fadeStart[2] === -1,
      "Near sort skips hidden records and clears obsolete fades");
    probe.waterRadius = Infinity;
    probe.sortNear(eye, 11);
    check(draw.count === heights.length && mesh.isEnabled() && mesh.thinInstanceCount === heights.length &&
      Array.from(file.fadeStart).every(start => start === -1),
      "Resurfacing restores all records at a settled LOD through Babylon buffers");
    check(append().length === heights.length, "Above-water bulk append restores the complete range");

    // Isolate update's middle-band invalidation from pack loads and other lists.
    Object.assign(probe, { scene: { activeCamera: { globalPosition: eye } }, manifest: { midMetres: 600 },
      waterRadiusSeen: Infinity, fadesSeen: false, zoomSeen: 1, stream: () => {}, changed: false,
      farAt: eye.clone(), midAt: eye.clone(), sortedAt: eye.clone(), nearbyAt: eye.clone(),
      rainReach: Infinity, reachBuilt: Infinity, fading: false });
    let middleBuilds = 0;
    probe.buildMid = () => { middleBuilds++; probe.midAt = eye.clone(); };
    probe.buildFar = () => { probe.farAt = eye.clone(); };
    probe.sortNear = probe.findNearby = () => {};
    probe.update();
    check(middleBuilds === 0, "Clear-air stationary lists stay cached");
    probe.waterRadius = 5;
    probe.update();
    check(middleBuilds === 1, "Water-radius change rebuilds middle lists without rain");
    eye.y = 26;
    probe.update();
    check(middleBuilds === 2, "Submerged vertical travel rebuilds middle lists without rain");
    probe.waterRadius = Infinity;
    probe.update();
    check(middleBuilds === 3, "Resurfacing rebuilds middle lists without rain");
    return results;
  } finally {
    mesh.dispose();
  }
}
