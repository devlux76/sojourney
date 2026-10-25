import "@babylonjs/core";
import "@babylonjs/loaders";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { createEngine, describeBackend } from "../src/core/Engine";
import { createEnvironment, type EnvironmentBiome } from "../src/engine/environment";
import { groundMaterial } from "../src/engine/ground";
import { WATER_Y, type GroundManifest } from "../src/engine/pack";
import { DynamicTerrain } from "../src/vendor/dynamicTerrain/dynamicTerrain";

const query = new URLSearchParams(location.search);
const mode = query.get("mode") ?? "both";
const innerSub = Number(query.get("sub") ?? 256);
const outerSub = Number(query.get("outerSub") ?? 256);
const treeCount = Number(query.get("trees") ?? 0);
const treePool = Number(query.get("pool") ?? 1500);
const EYE = 1.7;
const limitsFrom = (key: string, fallback: number[]) => query.get(key)?.split(",").map(Number) ?? fallback;
const INNER_LIMITS = limitsFrom("limits", [110, 90, 75, 60, 48, 38, 30, 23, 17, 12, 8, 5, 3, 1]);
const OUTER_LIMITS = limitsFrom("outerLimits", [110, 90, 75, 60, 48, 38, 30, 23, 17, 12, 8, 5, 3, 1]);

const biome: EnvironmentBiome = {
  location: { lat: 42.94, lon: -122.11, utcOffsetHours: -7 },
  calendar: { startMonth: 6, startDay: 15, stayLengthDays: 60, startHour: 9.5 },
  climate: { weatherSeed: 20260715 },
};

const heap = () => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576;
const timings: Record<string, number> = {};
const timed = <T>(name: string, fn: () => T): T => {
  const t = performance.now();
  const r = fn();
  timings[name] = performance.now() - t;
  return r;
};

const manifest: GroundManifest = await (await fetch("packs/crater-lake/ground/ground.json")).json();
const [innerGrid, outerGrid] = await Promise.all(
  manifest.collision.map(async g => new Float32Array(await (await fetch(g.url)).arrayBuffer())),
);
const IN = manifest.collision[0].samples, IS = manifest.collision[0].sizeMetres, ISTEP = IS / (IN - 1);
const ON = manifest.collision[1].samples, OS = manifest.collision[1].sizeMetres, OSTEP = OS / (ON - 1);

function gridHeight(grid: Float32Array, n: number, size: number, x: number, z: number) {
  const step = size / (n - 1);
  const fx = (x + size / 2) / step, fz = (z + size / 2) / step;
  const i = Math.max(0, Math.min(n - 2, Math.floor(fx))), j = Math.max(0, Math.min(n - 2, Math.floor(fz)));
  const tx = fx - i, tz = fz - j;
  const h = (ii: number, jj: number) => grid[(n - 1 - jj) * n + ii];
  return h(i, j) * (1 - tx) * (1 - tz) + h(i + 1, j) * tx * (1 - tz) + h(i, j + 1) * (1 - tx) * tz + h(i + 1, j + 1) * tx * tz;
}
const truth = (x: number, z: number) =>
  Math.abs(x) < IS / 2 - ISTEP && Math.abs(z) < IS / 2 - ISTEP
    ? gridHeight(innerGrid, IN, IS, x, z) : gridHeight(outerGrid, ON, OS, x, z);

function buildInnerMap() {
  const data = new Float32Array(IN * IN * 3);
  for (let j = 0; j < IN; j++) for (let i = 0; i < IN; i++) {
    const k = 3 * (j * IN + i);
    data[k] = -IS / 2 + ISTEP * i;
    data[k + 1] = innerGrid[(IN - 1 - j) * IN + i];
    data[k + 2] = -IS / 2 + ISTEP * j;
  }
  return data;
}

function buildOuterMap() {
  const data = new Float32Array(ON * ON * 3);
  for (let j = 0; j < ON; j++) for (let i = 0; i < ON; i++) {
    const k = 3 * (j * ON + i);
    const x = -OS / 2 + OSTEP * i, z = -OS / 2 + OSTEP * j;
    data[k] = x;
    data[k + 2] = z;
    data[k + 1] = Math.abs(x) < IS / 2 && Math.abs(z) < IS / 2
      ? innerGrid[(IN - 1 - Math.round((z + IS / 2) / ISTEP)) * IN + Math.round((x + IS / 2) / ISTEP)]
      : outerGrid[(ON - 1 - j) * ON + i];
  }
  return data;
}

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const engine = await createEngine(canvas);
const scene = new Scene(engine);
scene.clearColor.set(0, 0, 0, 1);

const camera = new UniversalCamera("camera", new Vector3(0, truth(0, 530) + EYE, 530), scene);
camera.setTarget(new Vector3(0, 60, 2000));
camera.minZ = 0.1;
camera.attachControl(canvas, true);

const environment = createEnvironment(scene, camera, biome);
environment.clock.hours = 12;
let paused = true;
environment.isPaused = () => paused;

const { material, surface } = groundMaterial(scene, manifest);
const outerMaterial = groundMaterial(scene, manifest).material;

const water = MeshBuilder.CreateGround("water", { width: OS, height: OS }, scene);
water.position.y = WATER_Y;
const waterMaterial = new PBRMaterial("waterMaterial", scene);
waterMaterial.albedoColor = new Color3(0.01, 0.06, 0.12);
waterMaterial.metallic = 0;
waterMaterial.roughness = 0.05;
water.material = waterMaterial;
water.receiveShadows = true;

interface Instrument { updates: { ms: number; upload: number; moved: boolean }[]; }
const instruments = new Map<string, Instrument>();

function instrument(name: string, terrain: DynamicTerrain) {
  const rec: Instrument = { updates: [] };
  instruments.set(name, rec);
  const mesh = terrain.mesh;
  const originalUpdate = terrain.update.bind(terrain);
  const originalUpload = mesh.updateVerticesData.bind(mesh);
  let upload = 0;
  mesh.updateVerticesData = ((...args: Parameters<Mesh["updateVerticesData"]>) => {
    const t = performance.now();
    originalUpload(...args);
    upload += performance.now() - t;
  }) as Mesh["updateVerticesData"];
  terrain.update = (force: boolean) => {
    const px = mesh.position.x, pz = mesh.position.z, lod = terrain.LODValue;
    upload = 0;
    const t = performance.now();
    const r = originalUpdate(force);
    const ms = performance.now() - t;
    const moved = mesh.position.x !== px || mesh.position.z !== pz || terrain.LODValue !== lod || !!force;
    if (moved) rec.updates.push({ ms, upload, moved });
    return r;
  };
}

function makeTerrain(name: string, map: Float32Array, sub: number, n: number, limits: number[], tolerance: number) {
  const heapBefore = heap();
  const t = performance.now();
  const terrain = new DynamicTerrain(name, { mapData: map, mapSubX: n, mapSubZ: n, terrainSub: sub, camera }, scene);
  timings[`${name}Construct`] = performance.now() - t;
  timings[`${name}ConstructHeapMB`] = heap() - heapBefore;
  terrain.LODLimits = [...limits];
  terrain.subToleranceX = terrain.subToleranceZ = tolerance;
  terrain.update(true);
  return terrain;
}

const casters: Mesh[] = [];
let trees: { sources: Mesh[]; instanceData: Float32Array[]; lodMeshes: Mesh[][] } | null = null;

function makeTrees(count: number, pool: number) {
  const trunkMat = new PBRMaterial("trunkMat", scene);
  trunkMat.albedoColor = new Color3(0.12, 0.08, 0.05);
  trunkMat.metallic = 0; trunkMat.roughness = 0.9;
  const crownMat = new PBRMaterial("crownMat", scene);
  crownMat.albedoColor = new Color3(0.05, 0.16, 0.07);
  crownMat.metallic = 0; crownMat.roughness = 0.8;
  const make = (name: string, tess: number, trunkTess: number) => {
    const trunk = MeshBuilder.CreateCylinder(`${name}T`, { height: 4, diameter: 0.7, tessellation: trunkTess }, scene);
    trunk.position.y = 2;
    trunk.material = trunkMat;
    const crown = MeshBuilder.CreateCylinder(`${name}C`, { height: 14, diameterTop: 0, diameterBottom: 6, tessellation: tess }, scene);
    crown.position.y = 11;
    crown.material = crownMat;
    const merged = Mesh.MergeMeshes([trunk, crown], true, true, undefined, false, true)!;
    merged.name = name;
    merged.isVisible = false;
    return merged;
  };
  const lod0 = make("treeLOD0", 14, 8);
  const lod1 = make("treeLOD1", 8, 5);
  const lod2 = make("treeLOD2", 4, 3);
  lod0.addLODLevel(200, lod1);
  lod0.addLODLevel(600, lod2);
  lod0.addLODLevel(1500, null);
  for (let i = 0; i < pool; i++) lod0.createInstance(`tree${i}`);
  const data = new Float32Array(count * 9);
  let seed = 11;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let placed = 0;
  while (placed < count) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 900;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = gridHeight(innerGrid, IN, IS, x, z);
    const dx = gridHeight(innerGrid, IN, IS, x + 4, z) - gridHeight(innerGrid, IN, IS, x - 4, z);
    const dz = gridHeight(innerGrid, IN, IS, x, z + 4) - gridHeight(innerGrid, IN, IS, x, z - 4);
    if (y < 3 || y > 200 || Math.hypot(dx, dz) > 4) continue;
    const k = placed * 9, s = 0.7 + 0.8 * rand();
    data.set([x, y, z, 0, rand() * 6.28, 0, s, s, s], k);
    placed++;
  }
  casters.push(lod0);
  return { sources: [lod0], instanceData: [data], lodMeshes: [[lod0, lod1, lod2]] };
}

if (treeCount > 0) trees = makeTrees(treeCount, treePool);
if (query.has("caster")) {
  const boxMaterial = new PBRMaterial("boxMaterial", scene);
  boxMaterial.albedoColor = new Color3(0.6, 0.2, 0.1);
  boxMaterial.metallic = 0;
  boxMaterial.roughness = 0.8;
  const box = MeshBuilder.CreateBox("caster", { width: 6, height: 30, depth: 6 }, scene);
  box.position.set(8, truth(8, 505) + 15, 505);
  box.material = boxMaterial;
  casters.push(box);
}

const innerMap = mode === "outer" ? null : timed("buildInnerMap", buildInnerMap);
const outerMap = mode === "inner" ? null : timed("buildOuterMap", buildOuterMap);
timings.heapAfterMapsMB = heap();

let inner: DynamicTerrain | null = null;
let outer: DynamicTerrain | null = null;

if (outerMap) {
  outer = makeTerrain("outer", outerMap, outerSub, ON, OUTER_LIMITS, 1);
  outer.mesh.material = outerMaterial;
  outer.mesh.receiveShadows = true;
  outer.mesh.isPickable = false;
  outer.mesh.position.y = -(Number(query.get("drop") ?? 2));
  instrument("outer", outer);
}
if (innerMap) {
  const t = performance.now();
  const options = {
    mapData: innerMap, mapSubX: IN, mapSubZ: IN, terrainSub: innerSub, camera,
    ...(trees ? { instanceMapData: trees.instanceData, sourceMeshes: trees.sources, precomputeInstances: true } : {}),
  };
  const heapBefore = heap();
  inner = new DynamicTerrain("inner", options, scene);
  timings.innerConstruct = performance.now() - t;
  timings.innerConstructHeapMB = heap() - heapBefore;
  inner.LODLimits = [...INNER_LIMITS];
  inner.update(true);
  inner.mesh.material = material;
  inner.mesh.receiveShadows = true;
  inner.mesh.isPickable = false;
  instrument("inner", inner);
}
const terrains = () => [inner, outer].filter((t): t is DynamicTerrain => !!t);

for (const mesh of casters) environment.shadows.addShadowCaster(mesh);

scene.onBeforeAnimationsObservable.add(() => {
  const dt = Math.min(engine.getDeltaTime(), 100) / 1000;
  if (motion.speed > 0) {
    const h = motion.heading * Math.PI / 180;
    camera.position.x += Math.sin(h) * motion.speed * dt;
    camera.position.z += Math.cos(h) * motion.speed * dt;
    camera.position.y = groundAt(camera.position.x, camera.position.z) + EYE;
    motion.travelled += motion.speed * dt;
  }
});

function groundAt(x: number, z: number) {
  const terrain = inner && Math.abs(x) < IS / 2 && Math.abs(z) < IS / 2 ? inner : outer ?? inner!;
  return terrain.getHeightFromMap(x, z);
}

const motion = { speed: 0, heading: 0, travelled: 0 };
const frames: { interval: number; cpu: number }[] = [];
let lastFrame = performance.now(), renderStart = 0, recording = false;
scene.onBeforeRenderObservable.add(() => { renderStart = performance.now(); });
scene.onAfterRenderObservable.add(() => {
  const now = performance.now();
  if (recording) frames.push({ interval: now - lastFrame, cpu: now - renderStart });
  lastFrame = now;
});

const quantile = (values: number[], q: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

async function measure(speed: number, seconds: number, heading = motion.heading) {
  const start = camera.position.clone();
  for (const rec of instruments.values()) rec.updates.length = 0;
  frames.length = 0;
  motion.heading = heading;
  motion.speed = speed;
  motion.travelled = 0;
  const t0 = performance.now();
  recording = true;
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  recording = false;
  motion.speed = 0;
  const wall = (performance.now() - t0) / 1000;
  const intervals = frames.map(f => f.interval), cpu = frames.map(f => f.cpu);
  const median = quantile(intervals, 0.5);
  const result: Record<string, unknown> = {
    speed, seconds: round(wall, 1), travelled: round(motion.travelled, 1),
    start: [round(start.x, 0), round(start.z, 0)], end: [round(camera.position.x, 0), round(camera.position.z, 0)],
    frames: frames.length,
    intervalMs: { mean: round(mean(intervals)), median: round(median), p95: round(quantile(intervals, 0.95)), p99: round(quantile(intervals, 0.99)), max: round(Math.max(...intervals, 0)) },
    renderCallMs: { mean: round(mean(cpu)), p95: round(quantile(cpu, 0.95)), max: round(Math.max(...cpu, 0)) },
    hitchesOver1p5xMedian: intervals.filter(v => v > Math.max(1.5 * median, 25)).length,
  };
  for (const [name, rec] of instruments) {
    const ms = rec.updates.map(u => u.ms), up = rec.updates.map(u => u.upload);
    result[`${name}Updates`] = {
      count: ms.length, perSecond: round(ms.length / wall), meanMs: round(mean(ms)), p95Ms: round(quantile(ms, 0.95)),
      maxMs: round(Math.max(...ms, 0)), meanUploadMs: round(mean(up)),
    };
  }
  return result;
}

function describeTerrain(t: DynamicTerrain | null) {
  if (!t) return null;
  return {
    sizeMetres: [round(t.terrainSizeX, 1), round(t.terrainSizeZ, 1)],
    halfSize: round(t.terrainHalfSizeX, 1),
    cell: round(t.averageSubSizeX, 4),
    lod: t.LODValue,
    limits: [...t.LODLimits],
    tolerance: [t.subToleranceX, t.subToleranceZ],
    triangles: t.mesh.getTotalIndices() / 3,
    vertices: t.mesh.getTotalVertices(),
    meshPosition: [round(t.mesh.position.x, 1), round(t.mesh.position.y, 1), round(t.mesh.position.z, 1)],
    computeNormals: t.computeNormals,
  };
}

const handle = {
  backend: describeBackend(engine),
  engine, scene, camera, environment, surface, DynamicTerrain, inner, outer, trees,
  timings,
  heapMB: heap,
  info() {
    return {
      mode, innerSub, outerSub, trees: treeCount, pool: treePool, timings: Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, round(v, 1)])),
      inner: describeTerrain(inner), outer: describeTerrain(outer),
      innerMapMB: innerMap ? innerMap.byteLength / 1048576 : 0, outerMapMB: outerMap ? outerMap.byteLength / 1048576 : 0,
      activeMeshes: scene.getActiveMeshes().length, totalMeshes: scene.meshes.length, activeIndices: scene.getActiveIndices(), totalVertices: scene.getTotalVertices(),
      materialsLoaded: scene.isReady(),
    };
  },
  place(x: number, z: number, headingDeg = 0, pitchDeg = 0) {
    camera.position.set(x, groundAt(x, z) + EYE, z);
    camera.rotation.set(pitchDeg * Math.PI / 180, headingDeg * Math.PI / 180, 0);
    motion.heading = headingDeg;
    for (const t of terrains()) t.update(true);
  },
  look(headingDeg: number, pitchDeg = 0) {
    camera.rotation.set(pitchDeg * Math.PI / 180, headingDeg * Math.PI / 180, 0);
  },
  hour(h: number) { environment.clock.hours = h; },
  pause(p: boolean) { paused = p; },
  stand: (seconds: number) => measure(0, seconds),
  walk: (seconds: number, heading?: number) => measure(2.5, seconds, heading),
  run: (seconds: number, heading?: number) => measure(6, seconds, heading),
  go: measure,
  config(c: { which: "inner" | "outer"; limits?: number[]; initialLOD?: number; tolerance?: number; computeNormals?: boolean; drop?: number }) {
    const t = c.which === "inner" ? inner : outer;
    if (!t) return null;
    if (c.limits) t.LODLimits = [...c.limits];
    if (c.initialLOD !== undefined) t.initialLOD = c.initialLOD;
    if (c.tolerance !== undefined) t.subToleranceX = t.subToleranceZ = c.tolerance;
    if (c.computeNormals !== undefined) t.computeNormals = c.computeNormals;
    if (c.drop !== undefined) t.mesh.position.y = -c.drop;
    t.update(true);
    return describeTerrain(t);
  },
  toggle(which: "inner" | "outer", visible: boolean) { (which === "inner" ? inner : outer)?.mesh.setEnabled(visible); },
  query(x: number, z: number) {
    const normal = Vector3.Zero();
    const out: Record<string, unknown> = { truth: round(truth(x, z), 3) };
    if (inner) out.innerMap = round(inner.getHeightFromMap(x, z, { normal }), 3);
    if (outer) out.outerMap = round(outer.getHeightFromMap(x, z), 3);
    out.normal = [round(normal.x, 3), round(normal.y, 3), round(normal.z, 3)];
    return out;
  },
  meshHeightAt(x: number, z: number, which: "inner" | "outer" = "inner") {
    const t = which === "inner" ? inner : outer;
    if (!t) return null;
    const positions = t.mesh.getVerticesData("position")!;
    const sub = which === "inner" ? innerSub : outerSub, idx = sub + 1;
    let best = Infinity, y = 0, bx = 0, bz = 0;
    for (let k = 0; k < idx * idx; k++) {
      const px = positions[3 * k] + t.mesh.position.x, pz = positions[3 * k + 2] + t.mesh.position.z;
      const d = Math.hypot(px - x, pz - z);
      if (d < best) { best = d; y = positions[3 * k + 1] + t.mesh.position.y; bx = px; bz = pz; }
    }
    return { nearestVertexDistance: round(best, 3), vertexX: round(bx, 3), vertexZ: round(bz, 3), vertexY: round(y, 3), truthAtVertex: round(truth(bx, bz), 3) };
  },
  snapshotMeshY(which: "inner" | "outer" = "inner") {
    const t = which === "inner" ? inner : outer;
    if (!t) return null;
    const p = t.mesh.getVerticesData("position")!;
    const wx = new Float32Array(p.length / 3), wz = new Float32Array(p.length / 3), wy = new Float32Array(p.length / 3);
    for (let k = 0; k < wy.length; k++) { wx[k] = p[3 * k] + t.mesh.position.x; wy[k] = p[3 * k + 1]; wz[k] = p[3 * k + 2] + t.mesh.position.z; }
    return { wx, wy, wz };
  },
  fps: () => engine.getFps(),
  scatterLod() {
    const names = ["treeLOD0", "treeLOD1", "treeLOD2"];
    return { activeIndices: scene.getActiveIndices(), active: scene.getActiveMeshes().data.slice(0, scene.getActiveMeshes().length).map(m => m.name).filter(n => n.startsWith("tree")).length, names };
  },
};
Object.assign(window, { dt: handle });
engine.runRenderLoop(() => scene.render());
