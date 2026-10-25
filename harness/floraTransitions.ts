import type { Flora } from "../src/engine/flora";

// Development-only regression probe: exercise the production sorter and Babylon
// instance buffers on one loaded tree, then let the world rebuild its draw lists.
// Private fields are read through Reflect because this is diagnostic code, not a
// gameplay API. Nothing here adds shipped settings or replaces Babylon fading.
export function verifyFloraTransitions(flora: Flora): string[] {
  const read = (key: string) => Reflect.get(flora, key);
  const write = (key: string, value: unknown) => Reflect.set(flora, key, value);
  const cells = read("nearCells");
  const candidate = cells.find((entry: any) => entry.batch.species.kind === "tree" && entry.leaf.near);
  if (!candidate) throw new Error("Visit a forested location before running the LOD probe.");
  const { leaf, batch, cell } = candidate;
  const file = leaf.near, index = cell.first, offset = index * 16;
  const savedRecord = [file.shown[index], file.fadeStart[index], file.goal[index]];
  const keys = ["nearCells", "fading", "fadesUntil", "fades", "fadesSeen", "sortedAt", "farAt", "nearbyAt",
    "changed", "reachBuilt", "reach", "rainReach", "zoomSeen", "stream", "sortNear"];
  const saved = new Map(keys.map(key => [key, read(key)]));
  const scene = read("scene"), eye = scene.activeCamera.globalPosition.clone();
  const sort = read("sortNear").bind(flora);
  const now = performance.now();
  const results: string[] = [];
  const check = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
    results.push(message);
  };
  const step = (distance: number, elapsed: number) => {
    eye.set(file.matrices[offset + 12] + distance, file.matrices[offset + 13], file.matrices[offset + 14]);
    sort(eye, now + elapsed);
  };
  const reset = () => {
    file.shown[index] = 255;
    file.fadeStart[index] = -1;
    write("fadesUntil", 0);
    write("fades", true);
  };
  try {
    write("nearCells", [{ leaf, batch, cell: { ...cell, first: index, count: 1 } }]);
    reset();
    step(7, 0);
    step(9, 1);
    check(file.goal[index] === 1 && batch.levels[0].count === 1 && batch.levels[1].count === 1,
      "Outward transition draws complementary LOD0/LOD1 instances");
    step(3, 100);
    step(3, 502);
    check(read("fading") === true, "Completed fade schedules a distance recheck while stationary");
    step(3, 503);
    step(3, 1005);
    step(3, 1006);
    check(file.shown[index] === 0 && file.fadeStart[index] === -1 && !read("fading") &&
      batch.levels[0].count === 1 && batch.levels.slice(1).every((draw: any) => draw.count === 0),
      "Reversal to 3 m settles at LOD0 and the sorter rests");
    check(batch.levels[0].fades[0] === 0 && batch.levels[0].fades[1] === 1,
      "Settled instance has full coverage without dither");
    reset();
    step(7, 2000);
    step(9, 2001);
    write("fades", false);
    step(3, 2100);
    check(file.shown[index] === 0 && file.fadeStart[index] === -1 && batch.levels[1].count === 0,
      "Underwater immediate selection ignores an obsolete fade goal");

    // Isolate update's invalidation gate from streaming and camera movement. The
    // real sorter was exercised above; this checks that a mode change invokes it.
    const cameraEye = scene.activeCamera.globalPosition;
    write("stream", () => {});
    write("changed", false);
    write("farAt", cameraEye.clone());
    write("sortedAt", cameraEye.clone());
    write("nearbyAt", cameraEye.clone());
    write("reachBuilt", Infinity);
    write("rainReach", Infinity);
    write("zoomSeen", read("zoom"));
    write("fading", false);
    write("fadesUntil", 0);
    let calls = 0;
    write("sortNear", () => { calls++; });
    write("fadesSeen", true);
    write("fades", true);
    read("update").call(flora);
    check(calls === 0, "Stationary settled forest does not sort unnecessarily");
    write("fades", false);
    read("update").call(flora);
    check(calls === 1, "Changing fade mode invalidates sorting with a stationary camera");
    return results;
  } finally {
    [file.shown[index], file.fadeStart[index], file.goal[index]] = savedRecord;
    for (const [key, value] of saved) write(key, value);
    // Draw buffers were exercised for one record; rebuild before the next render.
    write("farAt", null);
    write("sortedAt", null);
    write("nearbyAt", null);
  }
}
