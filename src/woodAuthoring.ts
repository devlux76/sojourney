// Offline wood-map authoring harness. NOT game runtime: the game never bakes,
// derives or downscales assets at runtime; it only reads the authored KTX2 maps
// through playWoodMaterial. Everything pixel-shaped here comes from Codex's
// native NME ProceduralTexture graphs in tools/materials/wood/ — no custom
// GLSL, noise or normal math in this file. Graph defaults are never changed:
// the normal fixtures load separate authored graphs and never modify the bake.
import {
  ArcRotateCamera,
  Color3,
  DirectionalLight,
  DumpTools,
  Engine,
  HemisphericLight,
  MeshBuilder,
  NodeMaterial,
  RegisterMathColor,
  RegisterMathVector,
  Scene,
  Vector3,
  type Mesh,
} from "@babylonjs/core";
import "./core/ktx2";
import { playWoodMaterial, woodFaceUV } from "./play/materials";

// One 0.5 m square tile at 1024 px, matching the graphs' halfTileMetres 0.25.
export const WOOD_BAKE_SIZE = 1024;
// Fixture probes only need a stable mean normal, so they bake small.
const FIXTURE_SIZE = 64;
// A bake that is not ready or shader-clean within this long is a failure, not a hang.
const BAKE_TIMEOUT_MS = 15000;
const ALBEDO_GRAPH_URL = "tools/materials/wood/albedoBake.json";
const NORMAL_GRAPH_URL = "tools/materials/wood/normalBake.json";

export interface WoodBake {
  albedo: string;
  normal: string;
  width: number;
  height: number;
}

export interface WoodNormalCheck {
  pass: boolean;
  actual: [number, number, number];
  expected: [number, number, number];
  distance: number;
  meanBytes: [number, number, number];
}

export interface WoodPreview {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  log: Mesh;
  stump: Mesh;
  meshCount: number;
  errors: string[];
  textureReady: () => boolean;
  ready: Promise<void>;
  dispose: () => void;
}

// GLSL is mandatory for the bake: the native WebGL Engine is the only backend
// used here. A WebGPU backend test stays out unless an adapter exists.
function bakeEngine(canvas: HTMLCanvasElement, antialias: boolean): Engine {
  return new Engine(canvas, antialias, { preserveDrawingBuffer: true, stencil: false, antialias });
}

async function fetchGraph(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`wood graph fetch failed: ${url} (${response.status})`);
  return response.json();
}

// Builds natively and waits for the native build-completion signal before
// returning, so later connection edits never race an in-flight build (which
// Babylon skips with "Build is already in progress"). Bounded, never a hang.
function buildAndWait(material: NodeMaterial, name: string, errors: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name}: native build did not complete within ${BAKE_TIMEOUT_MS} ms`)), BAKE_TIMEOUT_MS);
    material.onBuildObservable.addOnce(() => {
      clearTimeout(timer);
      if (errors.length) reject(new Error(`${name}: shader errors: ${errors.join("; ")}`));
      else resolve();
    });
    material.build();
    // A synchronously failing build notifies the error observable instead of
    // the build observable; surface it rather than waiting out the timeout.
    if (errors.length) {
      clearTimeout(timer);
      reject(new Error(`${name}: shader errors: ${errors.join("; ")}`));
    }
  });
}

// Loads a native NME graph as a ProceduralTexture-mode material and builds it,
// collecting native shader errors instead of letting them hide in the console.
async function loadBakeMaterial(scene: Scene, graphUrl: string, name: string, errors: string[]): Promise<NodeMaterial> {
  const graph = await fetchGraph(graphUrl);
  // Explicit constructor name: the MCP-exported graphs carry no name, and an
  // unnamed material registers a NaN shader token for its procedural effect.
  const material = new NodeMaterial(name, scene);
  material.onBuildErrorObservable.add(message => { errors.push(`${name}: ${message}`); });
  material.loadFromSerialization(graph);
  await buildAndWait(material, name, errors);
  return material;
}

// Renders one procedural texture natively and returns its raw RGBA bytes
// (GL bottom-up). The bake scene has no camera and needs none: the native
// procedural render draws its own fullscreen quad, while scene.render() throws
// "No camera defined" before any texture is generated. All waits are bounded.
async function renderBytes(scene: Scene, material: NodeMaterial, name: string, errors: string[], size: number): Promise<Uint8Array> {
  const procedural = material.createProceduralTexture(size, scene);
  if (!procedural) throw new Error(`${name}: native createProceduralTexture returned null`);
  try {
    // Finite native readiness: a node-sourced effect exists once the build has
    // completed, and its GL compile finishes asynchronously after that.
    const start = Date.now();
    while (!procedural.isReady()) {
      if (errors.length) throw new Error(`${name}: shader errors: ${errors.join("; ")}`);
      if (Date.now() - start > BAKE_TIMEOUT_MS) throw new Error(`${name}: procedural effect not ready within ${BAKE_TIMEOUT_MS} ms`);
      await new Promise<void>(resolve => { requestAnimationFrame(() => resolve()); });
    }
    if (errors.length) throw new Error(`${name}: shader errors: ${errors.join("; ")}`);
    const generated = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${name}: texture not generated within ${BAKE_TIMEOUT_MS} ms`)), BAKE_TIMEOUT_MS);
      procedural.onGeneratedObservable.addOnce(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    procedural.render();
    await generated;
    const pixels = await procedural.readPixels();
    if (!pixels) throw new Error(`${name}: native readPixels returned null`);
    const raw = pixels instanceof Uint8Array
      ? pixels.slice()
      : new Uint8Array(pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength));
    if (raw.length !== size * size * 4) throw new Error(`${name}: unexpected byte count ${raw.length}`);
    return raw;
  } finally {
    procedural.dispose();
  }
}

// GL readback is bottom-up; PNG is top-down, so rows are reversed offline before
// the native PNG encoder sees them.
function flipRowsBottomUp(bottomUp: Uint8Array, size: number): Uint8Array {
  const rowBytes = size * 4;
  const topDown = new Uint8Array(bottomUp.length);
  for (let row = 0; row < size; row++)
    topDown.set(bottomUp.subarray(row * rowBytes, (row + 1) * rowBytes), (size - 1 - row) * rowBytes);
  return topDown;
}

async function bakeOne(scene: Scene, graphUrl: string, name: string): Promise<string> {
  const errors: string[] = [];
  const material = await loadBakeMaterial(scene, graphUrl, name, errors);
  try {
    const bytes = await renderBytes(scene, material, name, errors, WOOD_BAKE_SIZE);
    const topDown = flipRowsBottomUp(bytes, WOOD_BAKE_SIZE);
    const dataUrl = await DumpTools.DumpDataAsync(WOOD_BAKE_SIZE, WOOD_BAKE_SIZE, topDown, "image/png", undefined, false);
    // Only sizes are logged: the data URL itself is far too large to print.
    console.info(`${name}: baked ${topDown.length} bytes to PNG data URL`);
    return dataUrl;
  } finally {
    material.dispose();
  }
}

export interface WoodBakeOptions {
  albedoGraphUrl?: string;
  normalGraphUrl?: string;
}

// Bakes both wood graphs to PNG data URLs. Call from window.woodAuthoring.
export async function bake(options: WoodBakeOptions = {}): Promise<WoodBake> {
  RegisterMathVector();
  RegisterMathColor();
  const canvas = document.createElement("canvas");
  canvas.width = WOOD_BAKE_SIZE;
  canvas.height = WOOD_BAKE_SIZE;
  const engine = bakeEngine(canvas, false);
  const scene = new Scene(engine);
  try {
    const albedo = await bakeOne(scene, options.albedoGraphUrl ?? ALBEDO_GRAPH_URL, "woodAlbedo");
    const normal = await bakeOne(scene, options.normalGraphUrl ?? NORMAL_GRAPH_URL, "woodNormal");
    return { albedo, normal, width: WOOD_BAKE_SIZE, height: WOOD_BAKE_SIZE };
  } finally {
    scene.dispose();
    engine.dispose();
  }
}

function decodeMeanNormal(bytes: Uint8Array): { actual: [number, number, number]; meanBytes: [number, number, number] } {
  let r = 0, g = 0, b = 0;
  const count = bytes.length / 4;
  for (let i = 0; i < bytes.length; i += 4) {
    r += bytes[i];
    g += bytes[i + 1];
    b += bytes[i + 2];
  }
  const meanBytes: [number, number, number] = [r / count, g / count, b / count];
  const decoded = new Vector3((meanBytes[0] / 255) * 2 - 1, (meanBytes[1] / 255) * 2 - 1, (meanBytes[2] / 255) * 2 - 1);
  decoded.normalize();
  return { actual: [decoded.x, decoded.y, decoded.z], meanBytes };
}

// The native fixture graphs add a known XY ramp to zero-amplitude wood relief.
// Keeping that uniform-connected branch avoids the empty-define procedural
// effect case while leaving the analytical slope unchanged. Fixtures are
// separate authoring graphs, so the actual wood bake is never mutated.
async function checkPlane(scene: Scene, planeBlockName: string, materialName: string, expected: Vector3): Promise<WoodNormalCheck> {
  const errors: string[] = [];
  const source = await fetchGraph(`tools/materials/wood/normalFixture${planeBlockName === "bakePlaneX" ? "X" : "Y"}.json`);
  const material = new NodeMaterial(materialName, scene);
  material.onBuildErrorObservable.add(message => { errors.push(`${materialName}: ${message}`); });
  material.loadFromSerialization(source);
  await buildAndWait(material, materialName, errors);
  try {
    const bytes = await renderBytes(scene, material, materialName, errors, FIXTURE_SIZE);
    const { actual, meanBytes } = decodeMeanNormal(bytes);
    const expectedNormal = expected.clone();
    expectedNormal.normalize();
    const distance = Math.hypot(actual[0] - expectedNormal.x, actual[1] - expectedNormal.y, actual[2] - expectedNormal.z);
    // 8-bit encoding quantises each channel to 1/255; anything an order of
    // magnitude above that is a real convention failure, not precision.
    const pass = distance <= 0.02;
    const check: WoodNormalCheck = {
      pass,
      actual,
      expected: [expectedNormal.x, expectedNormal.y, expectedNormal.z],
      distance,
      meanBytes,
    };
    if (!pass) console.warn(`normal fixture FAILED for ${planeBlockName}`, check);
    else console.info(`normal fixture passed for ${planeBlockName}`, check);
    return check;
  } finally {
    material.dispose();
  }
}

// Runs the slope-1 ramp fixture on both bake planes.
export async function checkNormals(): Promise<{ x: WoodNormalCheck; y: WoodNormalCheck }> {
  RegisterMathVector();
  RegisterMathColor();
  const canvas = document.createElement("canvas");
  canvas.width = WOOD_BAKE_SIZE;
  canvas.height = WOOD_BAKE_SIZE;
  const engine = bakeEngine(canvas, false);
  const scene = new Scene(engine);
  try {
    const x = await checkPlane(scene, "bakePlaneX", "woodNormalCheckX", new Vector3(-1, 0, 1));
    const y = await checkPlane(scene, "bakePlaneY", "woodNormalCheckY", new Vector3(0, -1, 1));
    return { x, y };
  } finally {
    scene.dispose();
    engine.dispose();
  }
}

// Authoring-only preview of the production wood material on a log and a stump
// at production dimensions and tessellation, with the production metric faceUV.
// Reads the installed pack maps, so it shows real wood only after Codex lands
// the KTX2 files; before that the PBR textures simply stay unready. Meshes are
// exposed for assertions; authoring controls live in the harness page.
export function preview(canvas: HTMLCanvasElement): WoodPreview {
  RegisterMathVector();
  RegisterMathColor();
  const engine = bakeEngine(canvas, true);
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera("woodOrbit", Math.PI / 4, Math.PI / 3, 3, new Vector3(0, 0.35, 0), scene);
  camera.attachControl(canvas, true);
  // Authoring rig only: the game lights wood with its sun and atmosphere.
  const sky = new HemisphericLight("woodSky", new Vector3(0, 1, 0), scene);
  sky.intensity = 0.9;
  const sun = new DirectionalLight("woodSun", new Vector3(-0.4, -1, 0.3), scene);
  sun.intensity = 1.6;
  const material = playWoodMaterial("previewWood", scene);
  const log = MeshBuilder.CreateCylinder("previewLog", { height: 0.9, diameter: 0.22, tessellation: 10,
    faceUV: woodFaceUV(Math.PI * 0.22, 0.9) }, scene);
  log.position.set(-0.55, 0.11, 0);
  log.rotation.z = Math.PI / 2;
  log.material = material;
  const stump = MeshBuilder.CreateCylinder("previewStump", { height: 0.5, diameterTop: 0.75, diameterBottom: 0.95, tessellation: 12,
    faceUV: woodFaceUV(Math.PI * (0.75 + 0.95) / 2, 0.5) }, scene);
  stump.position.set(0.55, 0.25, 0);
  stump.material = material;
  const errors: string[] = [];
  const textureReady = (): boolean => {
    const albedo = material.albedoTexture, bump = material.bumpTexture;
    return !!albedo && !!bump && albedo.isReady() && bump.isReady();
  };
  const ready = new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + BAKE_TIMEOUT_MS;
    const poll = (): void => {
      if (textureReady()) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        const message = "preview wood textures not ready within 15 s (pack KTX2 maps may not be installed yet)";
        errors.push(message);
        reject(new Error(message));
        return;
      }
      requestAnimationFrame(poll);
    };
    poll();
  });
  engine.runRenderLoop(() => scene.render());
  return {
    engine,
    scene,
    camera,
    log,
    stump,
    meshCount: scene.meshes.length,
    errors,
    textureReady,
    ready,
    dispose: () => {
      engine.stopRenderLoop();
      scene.dispose();
      engine.dispose();
    },
  };
}

export const woodAuthoring = { bake, checkNormals, preview, WOOD_BAKE_SIZE };
