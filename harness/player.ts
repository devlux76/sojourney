import "@babylonjs/core";
import { Scene } from "@babylonjs/core/scene";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeHeightField, PhysicsShapeCylinder } from "@babylonjs/core/Physics/v2/physicsShape";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { createEngine } from "../src/core/Engine";
import { enablePhysics } from "../src/engine/physics";
import { PlayerController } from "../src/engine/player/PlayerController";
import { GROUND_MASK, OBSTACLE_MASK } from "../src/engine/player/ground";
import { WATER_Y } from "../src/engine/pack";

const SAMPLES = 129;
const SIZE = 128;
const CELL = SIZE / (SAMPLES - 1);
const BASE = 2;

function heightAt(x: number, z: number): number {
  let y = BASE;
  const hill = Math.hypot(x - 20, z - 0);
  if (hill < 16) y += 3 * 0.5 * (1 + Math.cos((Math.PI * hill) / 16));
  if (Math.abs(z) < 25) {
    if (x > -34 && x <= -24) y += (x + 34) * 1.5;
    else if (x > -24 && x < -18) y += 15;
  }
  const basin = Math.hypot(x, z + 30);
  if (basin < 20) y -= 10 * 0.5 * (1 + Math.cos((Math.PI * basin) / 20));
  return y;
}

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const engine = await createEngine(canvas);
const scene = new Scene(engine);
await enablePhysics(scene);

new HemisphericLight("sky", new Vector3(0.2, 1, 0.3), scene);
const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.3), scene);
sun.intensity = 0.6;

const grid = new Float32Array(SAMPLES * SAMPLES);
const worldX = (i: number) => -SIZE / 2 + i * CELL;
const worldZ = (j: number) => -SIZE / 2 + j * CELL;
for (let i = 0; i < SAMPLES; i++) for (let j = 0; j < SAMPLES; j++) grid[i * SAMPLES + j] = heightAt(worldX(i), worldZ(j));

const positions: number[] = [];
const indices: number[] = [];
for (let i = 0; i < SAMPLES; i++) for (let j = 0; j < SAMPLES; j++) positions.push(worldX(i), grid[i * SAMPLES + j], worldZ(j));
for (let i = 0; i < SAMPLES - 1; i++) for (let j = 0; j < SAMPLES - 1; j++) {
  const a = i * SAMPLES + j, b = a + 1, c = a + SAMPLES, d = c + 1;
  indices.push(a, b, c, b, d, c);
}
const normals: number[] = [];
VertexData.ComputeNormals(positions, indices, normals);
const terrain = new Mesh("terrain", scene);
const vd = new VertexData();
vd.positions = positions; vd.indices = indices; vd.normals = normals;
vd.applyToMesh(terrain);
const terrainMat = new StandardMaterial("terrain", scene);
terrainMat.diffuseColor = new Color3(0.4, 0.5, 0.3);
terrainMat.backFaceCulling = false;
terrain.material = terrainMat;

const heightData = new Float32Array(SAMPLES * SAMPLES);
for (let i = 0; i < SAMPLES; i++) for (let j = 0; j < SAMPLES; j++) heightData[(SAMPLES - 1 - j) * SAMPLES + i] = grid[i * SAMPLES + j];
const groundNode = new TransformNode("ground", scene);
const groundShape = new PhysicsShapeHeightField(SIZE, SIZE, SAMPLES, SAMPLES, heightData, scene);
groundShape.filterMembershipMask = GROUND_MASK;
const groundBody = new PhysicsBody(groundNode, PhysicsMotionType.STATIC, false, scene);
groundBody.shape = groundShape;

const water = CreateGround("water", { width: SIZE, height: SIZE }, scene);
water.position.y = WATER_Y;
const waterMat = new StandardMaterial("water", scene);
waterMat.diffuseColor = new Color3(0.1, 0.3, 0.6);
waterMat.alpha = 0.4;
water.material = waterMat;
water.isPickable = false;

const TRUNK_RADIUS = 0.4;
const TRUNK_HEIGHT = 12;
const trunkMat = new StandardMaterial("trunk", scene);
trunkMat.diffuseColor = new Color3(0.4, 0.25, 0.12);
const trunkShape = new PhysicsShapeCylinder(new Vector3(0, 0, 0), new Vector3(0, TRUNK_HEIGHT, 0), TRUNK_RADIUS, scene);
trunkShape.filterMembershipMask = OBSTACLE_MASK;

function trunkSite(x: number, z: number): Matrix {
  return Matrix.Translation(x, heightAt(x, z), z);
}

const plainTrunks: Mesh[] = [];
for (const [x, z] of [[8, 8], [8, -8]] as const) {
  const t = CreateCylinder(`trunk${x},${z}`, { height: TRUNK_HEIGHT, diameter: TRUNK_RADIUS * 2 }, scene);
  t.bakeTransformIntoVertices(Matrix.Translation(0, TRUNK_HEIGHT / 2, 0));
  t.position.set(x, heightAt(x, z), z);
  t.material = trunkMat;
  const body = new PhysicsBody(t, PhysicsMotionType.STATIC, false, scene);
  body.shape = trunkShape;
  plainTrunks.push(t);
}

const instanced = CreateCylinder("trunks", { height: TRUNK_HEIGHT, diameter: TRUNK_RADIUS * 2 }, scene);
instanced.bakeTransformIntoVertices(Matrix.Translation(0, TRUNK_HEIGHT / 2, 0));
instanced.material = trunkMat;
const instancedSites: [number, number][] = [[12, 20], [14, 20], [16, 20], [12, 24]];
for (const [x, z] of instancedSites) instanced.thinInstanceAdd(trunkSite(x, z));
const instancedBody = new PhysicsBody(instanced, PhysicsMotionType.STATIC, false, scene);
instancedBody.shape = trunkShape;

const player = new PlayerController(scene, canvas, {
  spawn: { position: [0, 10, 0], headingDegrees: 0 },
  terrain: { worldSizeMetres: SIZE * 4 },
});
player.spawn();

engine.runRenderLoop(() => {
  scene.render();
  player.update();
});

const handle = {
  player,
  scene,
  grid,
  samples: SAMPLES,
  size: SIZE,
  heightAt,
  worldX,
  worldZ,
  trunks: { plain: [[8, 8], [8, -8]], instanced: instancedSites },
  stick: (x: number, y: number) => player.setTouchStick({ x, y }),
  key: (code: string, down: boolean) => player.setVirtualKey(code, down),
  run: (on: boolean) => player.setVirtualKey("ShiftLeft", on),
  heading: (rad: number) => { player.camera.rotation.y = rad; },
  teleport: (x: number, y: number, z: number) => player.teleport(new Vector3(x, y, z)),
  sit: (x: number, y: number, z: number) => player.sit(new Vector3(x, y, z)),
  lieDown: () => player.tryLieDown(),
  stand: () => player.stand(),
  home: () => player.spawn(),
  state: () => {
    const p = player.position(), v = player.velocity(), c = player.camera.position;
    return { x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, eyeX: c.x, eyeY: c.y, eyeZ: c.z,
      grounded: player.isGrounded(), swimming: player.isSwimming(), pose: player.pose() };
  },
};
(window as unknown as { harness: typeof handle }).harness = handle;
