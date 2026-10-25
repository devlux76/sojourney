import { Mesh, Vector3, type Scene } from "@babylonjs/core";
import { GroundStream } from "../src/engine/groundStream";

// Exercise the production selector and stock Babylon bounds without moving the
// player or starting pack loads. Empty diagnostic meshes are disposed afterwards.
export function verifyGroundTransitions(stream: GroundStream, scene: Scene): string[] {
  const read = (key: string) => Reflect.get(stream, key);
  const meshes = Array.from({ length: 5 }, (_, i) => new Mesh(`groundProbeLOD${i}`, scene));
  const blockMeshes = [new Mesh("groundProbeBlock3", scene), new Mesh("groundProbeBlock4", scene)];
  const state = () => ({ lower: -1, upper: -1, on: true });
  const leaf = {
    id: 0, info: { x: -1, z: -1, size: 2, centre: [0, 0, 0], lodDistances: [8, 16, 32, 64],
      heightMin: 0, heightScale: 0 },
    level: 0, shown: 0, fadeStart: -1, fade: 1, fogged: false,
    meshes, state: meshes.map(state), near: {}, nearJob: Promise.resolve(),
    body: null, bodyJob: Promise.resolve(), block: null as unknown,
  };
  const block = { leaves: [leaf], meshes: blockMeshes, state: blockMeshes.map(state), tj: [] };
  leaf.block = block;
  const eye = new Vector3(3, 0, 0);
  const probe = Object.create(GroundStream.prototype);
  Object.assign(probe, { scene: { activeCamera: { globalPosition: eye } },
    manifest: { ...read("manifest"), blockLevels: [3, 4] }, material: read("material"),
    fade: read("fade"), leaves: [leaf], blocks: [block], anchor: null, loading: 0,
    rainReach: Infinity, zoom: 1, fades: true });
  const update = () => Reflect.get(probe, "update").call(probe);
  const results: string[] = [];
  const check = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
    results.push(message);
  };
  const startOutwardFade = () => {
    leaf.shown = 0; leaf.level = 1; leaf.fadeStart = performance.now() - 100;
  };
  try {
    startOutwardFade();
    update();
    check(leaf.level === 1 && leaf.shown === 0 && leaf.fadeStart >= 0,
      "Above-water reversal lets the active fade finish");
    probe.fades = false;
    update();
    check(leaf.level === 0 && leaf.shown === 0 && leaf.fadeStart === -1,
      "Underwater reversal selects current distance instead of obsolete fade goal");
    const bounds = { lowerBound: 0, upperBound: 0 };
    read("fade").getFadeBoundsToRef(meshes[0], bounds);
    check(meshes[0].isEnabled() && meshes.slice(1).every(mesh => !mesh.isEnabled()) &&
      bounds.lowerBound === 0 && bounds.upperBound === 1,
      "Cancelled fade leaves one fully covered leaf level");
    startOutwardFade();
    eye.x = 70;
    update();
    check(leaf.level === 4 && leaf.shown === 4 && blockMeshes[1].isEnabled() &&
      meshes.every(mesh => !mesh.isEnabled()) && !blockMeshes[0].isEnabled(),
      "Underwater outward jump transfers full coverage to current block level");
    probe.fades = true;
    eye.x = 3;
    update();
    check(leaf.shown === 4 && leaf.level === 0 && leaf.fadeStart >= 0,
      "Leaving underwater mode resumes timed transitions");
    leaf.fadeStart = performance.now() - 501;
    update();
    check(leaf.shown === 0 && leaf.fadeStart === -1 && meshes[0].isEnabled() &&
      blockMeshes.every(mesh => !mesh.isEnabled()),
      "Leaf/block transition completes with one settled level");
    // Streaming can still be pending at water entry; immediate selection must
    // keep the existing far-level fallback instead of requesting absent meshes.
    probe.fades = false;
    Reflect.set(leaf, "near", null);
    startOutwardFade();
    update();
    check(leaf.shown === 2 && leaf.level === 2 && leaf.fadeStart === -1 &&
      meshes[2].isEnabled() && meshes.filter((_, i) => i !== 2).every(mesh => !mesh.isEnabled()),
      "Missing near file retains the available LOD2 fallback");
    return results;
  } finally {
    for (const mesh of [...meshes, ...blockMeshes]) mesh.dispose();
  }
}
