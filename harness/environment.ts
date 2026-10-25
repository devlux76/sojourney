import "@babylonjs/core";
import "@babylonjs/loaders";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Atmosphere } from "@babylonjs/addons/atmosphere/atmosphere";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { createEngine, describeBackend } from "../src/core/Engine";
import { settings } from "../src/core/Settings";
import { WEATHER_KINDS } from "../src/sky/Weather";
import { WATER_Y } from "../src/engine/pack";
import { createEnvironment, type EnvironmentBiome, type SkyState } from "../src/engine/environment";

if (new URLSearchParams(location.search).has("stocksky")) Atmosphere.IsSupported = () => false;

const biome: EnvironmentBiome = {
  location: { lat: 42.94, lon: -122.11, utcOffsetHours: -7 },
  calendar: { startMonth: 6, startDay: 15, stayLengthDays: 60, startHour: 9.5 },
  climate: { weatherSeed: 20260715 },
};

function groundHeight(x: number, z: number) {
  const r = Math.hypot(x, z);
  const island = r < 900 ? 230 * Math.pow(1 - r / 900, 1.5) - 40 : -1e9;
  const bowl = r < 4500 ? -300 : -300 + 900 * Math.min(1, (r - 4500) / 2500);
  const far = r > 7000 ? -200 * Math.min(1, (r - 7000) / 8000) : 0;
  const ripple = 14 * Math.sin(x * 0.004) * Math.cos(z * 0.0037) + 5 * Math.sin(x * 0.017 + z * 0.011);
  return Math.max(island, bowl) + (r > 600 ? ripple : ripple * 0.2) + far;
}

function pbr(name: string, scene: Scene, colour: Color3, roughness: number) {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = colour;
  m.metallic = 0;
  m.roughness = roughness;
  return m;
}

const SIZE = 30000, CELLS = 600;

async function main() {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const engine = await createEngine(canvas);
  const scene = new Scene(engine);
  scene.clearColor.set(0, 0, 0, 1);

  const start = new Vector3(0, groundHeight(0, -250) + 2, -250);
  const camera = new UniversalCamera("camera", start, scene);
  camera.setTarget(new Vector3(0, 60, 400));
  camera.minZ = 0.1;
  camera.speed = 0.5;
  camera.attachControl(canvas, true);

  const environment = createEnvironment(scene, camera, biome);

  const ground = MeshBuilder.CreateGround("ground", { width: SIZE, height: SIZE, subdivisions: CELLS, updatable: true }, scene);
  const positions = ground.getVerticesData("position")!;
  for (let i = 0; i < positions.length; i += 3) positions[i + 1] = groundHeight(positions[i], positions[i + 2]);
  ground.updateVerticesData("position", positions);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, ground.getIndices()!, normals);
  ground.updateVerticesData("normal", normals);
  ground.material = pbr("groundMat", scene, new Color3(0.2, 0.17, 0.13), 0.9);
  ground.receiveShadows = true;

  const water = MeshBuilder.CreateGround("water", { width: SIZE, height: SIZE }, scene);
  water.position.y = WATER_Y;
  water.material = pbr("waterMat", scene, new Color3(0.02, 0.1, 0.18), 0.05);
  water.receiveShadows = true;

  const treeMat = pbr("treeMat", scene, new Color3(0.05, 0.16, 0.07), 0.8);
  const trunkMat = pbr("trunkMat", scene, new Color3(0.12, 0.08, 0.05), 0.9);
  const rockMat = pbr("rockMat", scene, new Color3(0.28, 0.27, 0.26), 0.85);
  const casters: Mesh[] = [];
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const place = (mesh: Mesh, x: number, z: number, lift: number) => {
    mesh.position.set(x, groundHeight(x, z) + lift, z);
    mesh.receiveShadows = true;
    casters.push(mesh);
  };
  const distances = [60, 90, 130, 180, 250, 350, 500, 700, 1000, 1500, 2200, 3200, 4600, 6500, 9000];
  for (let i = 0; i < 45; i++) {
    const d = distances[i % distances.length] * (0.8 + 0.4 * rand()), a = rand() * Math.PI * 2;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (groundHeight(x, z) < WATER_Y + 1) continue;
    const trunk = MeshBuilder.CreateCylinder(`trunk${i}`, { height: 6, diameter: 0.8 }, scene);
    trunk.material = trunkMat;
    place(trunk, x, z, 3);
    const crown = MeshBuilder.CreateCylinder(`tree${i}`, { height: 14, diameterTop: 0, diameterBottom: 6 }, scene);
    crown.material = treeMat;
    place(crown, x, z, 11);
  }
  for (let i = 0; i < 30; i++) {
    const d = distances[(i * 3) % distances.length] * (0.8 + 0.4 * rand()), a = rand() * Math.PI * 2;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (groundHeight(x, z) < WATER_Y + 0.5) continue;
    const rock = MeshBuilder.CreateIcoSphere(`rock${i}`, { radius: 1.5 + 2 * rand(), subdivisions: 2 }, scene);
    rock.material = rockMat;
    rock.scaling.y = 0.7;
    place(rock, x, z, 0.5);
  }
  for (let i = 0; i < 12; i++) {
    const box = MeshBuilder.CreateBox(`near${i}`, { size: 2 + i * 0.3 }, scene);
    box.material = rockMat;
    place(box, -20 + i * 7, 40 + (i % 3) * 15, 1);
  }

  for (const mesh of casters) environment.shadows.addShadowCaster(mesh);
  ground.receiveShadows = true;

  let last: SkyState | null = null;
  environment.onSky.add(state => { last = state; });
  let paused = true;
  environment.isPaused = () => paused;
  environment.clock.hours = 12;

  engine.runRenderLoop(() => scene.render());

  const handle = {
    backend: describeBackend(engine),
    atmosphere: !!environment.atmosphere,
    environment, scene, camera, settings,
    hour(h: number) { environment.clock.hours = h; },
    weather(kind: string) { settings.weatherOverride = kind === "auto" ? -1 : WEATHER_KINDS.indexOf(kind as never); },
    pause(p: boolean) { paused = p; },
    fps: () => engine.getFps(),
    sky: () => last && { sun: last.sun, moon: last.moon, moonFraction: last.moonFraction, daylight: last.daylight, darkness: last.darkness, weather: last.weather },
    face(which: "sun" | "moon", pitchOffset = 0) {
      if (!last) return;
      const d = which === "sun" ? last.sunDir : last.moonDir;
      const dir = d.clone();
      dir.y += pitchOffset;
      camera.setTarget(camera.position.add(dir.normalize().scale(1000)));
    },
    look(x: number, y: number, z: number, tx: number, ty: number, tz: number) {
      camera.position.set(x, y, z);
      camera.setTarget(new Vector3(tx, ty, tz));
    },
    flags(f: { post?: boolean; shadows?: boolean; particles?: boolean; targets?: boolean; scale?: number }) {
      if (f.post !== undefined) scene.postProcessesEnabled = f.post;
      if (f.shadows !== undefined) scene.shadowsEnabled = f.shadows;
      if (f.particles !== undefined) scene.particlesEnabled = f.particles;
      if (f.targets !== undefined) scene.renderTargetsEnabled = f.targets;
      if (f.scale !== undefined) engine.setHardwareScalingLevel(f.scale);
    },
  };
  Object.assign(window, { env: handle });
}

main();
