import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox } from "@babylonjs/core/Physics/v2/physicsShape";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import type { Biome } from "../biomes/Biome";
import "../core/ktx2";
import "./meshopt";
import { mergeLevel } from "./flora";
import { GROUND_MASK, OBSTACLE_MASK } from "./player/ground";
import type { PropBlocker, PropEntry, PropsManifest } from "./pack";
import { PropTransitions } from "./propTransitions";
import { WATER_Y } from "./pack";
import { inLake } from "./lake";

// Merged levels per prop type, with the authored distances at which each higher-numbered
// level takes over. The levels are never registered as anyone's LOD slaves: Babylon lends
// a master's bounds and transform to its LOD levels, which would collapse the bounds of
// instances created from them (see propTransitions.ts).
const preparedLevels = new WeakMap<Mesh, { levels: Mesh[]; distances: number[] }>();

// A prop standing in the world: everything it is made of (the drawn instance and one node per
// collision box) hangs from root, so moving or tilting root moves all of it together.
export interface PlacedProp {
  root: TransformNode;
  instance: InstancedMesh;
  transitions: PropTransitions;
}

export async function fetchProps(pack: string): Promise<PropsManifest> {
  return (await fetch(`packs/${pack}/props/props.json`)).json();
}

// Draw the biome's standing props and make them solid. Each distinct prop is loaded once and instanced
// at its placements; decks and ramps become ground the player can walk on.
export async function loadProps(scene: Scene, biome: Biome, manifest: PropsManifest, shadows: ShadowGenerator): Promise<PlacedProp[]> {
  const levels = new Map<string, Mesh[]>();
  const placed: PlacedProp[] = [];
  for (const placement of biome.props) {
    const entry = manifest.props[placement.prop];
    if (!levels.has(placement.prop)) levels.set(placement.prop, await loadLevels(scene, biome.id, placement.prop, entry));
    const prop = placeProp(scene, placement.prop, levels.get(placement.prop)![0], shadows);
    prop.root.position.set(...placement.position);
    // A positive pitch lifts the prop's +z end: the piers climb from the shore to meet the ship's rail.
    prop.root.rotationQuaternion = Quaternion.RotationYawPitchRoll(
      (placement.headingDegrees * Math.PI) / 180, (-(placement.pitchDegrees ?? 0) * Math.PI) / 180, 0);
    solidBoxes(scene, prop.root, placement.prop, entry, entry.blockers ?? [], false);
    placed.push(prop);
  }
  return placed;
}

// One instance per prepared level under a shared placement root. Only the
// settled level, or the two complementary levels in a fade, are visible.
export function placeProp(scene: Scene, name: string, source: Mesh, shadows: ShadowGenerator): PlacedProp {
  const root = new TransformNode(`${name}_root`, scene);
  const prepared = preparedLevels.get(source)!;
  const instances = prepared.levels.map((level, i) => {
    const instance = level.createInstance(i === 0 ? name : `${name}_LOD${i}`);
    instance.parent = root;
    shadows.addShadowCaster(instance);
    return instance;
  });
  const instance = instances[0];
  const transitions = new PropTransitions(instances, prepared.distances);
  // Run after world culling and before active-list/mirror evaluation. Underwater
  // uses the same instant-switch boundary as terrain and flora.
  const observer = scene.onBeforeActiveMeshesEvaluationObservable.add(() => {
    const eye = scene.activeCamera?.globalPosition;
    transitions.update(scene, !(eye && eye.y < WATER_Y && inLake(eye.x, eye.z)));
  });
  root.onDisposeObservable.add(() => scene.onBeforeActiveMeshesEvaluationObservable.remove(observer));
  return { root, instance, transitions };
}

// Build a prop's LOD levels the way Campfire.load builds the fire pit's: the meshes of one
// level (one per material) are merged together with their baked transforms, then selected
// by distance in PropTransitions without ever becoming a native LOD chain.
export async function loadLevels(scene: Scene, pack: string, name: string, entry: PropEntry): Promise<Mesh[]> {
  const container = await LoadAssetContainerAsync(`packs/${pack}/props/${entry.file}`, scene);
  container.addAllToScene();
  // A level with several materials loads as one mesh per material, named <prop>_LOD<n>_primitive<m>.
  const pattern = new RegExp(`^${name}_LOD(\\d+)(_primitive\\d+)?$`);
  const parts = new Map<number, Mesh[]>();
  for (const mesh of container.meshes) {
    const level = pattern.exec(mesh.name);
    if (!level || !(mesh instanceof Mesh) || mesh.getTotalVertices() === 0) continue;
    mesh.computeWorldMatrix(true);
    const k = Number(level[1]);
    parts.set(k, [...(parts.get(k) ?? []), mesh]);
  }
  const merged = [...parts.keys()].sort((a, b) => a - b).map(k => mergeLevel(parts.get(k)!));
  if (merged.length !== entry.lodDistances.length + 1)
    throw new Error(`${name}: expected ${entry.lodDistances.length + 1} prepared prop levels, got ${merged.length}`);
  for (const mesh of container.meshes) mesh.setEnabled(false);
  preparedLevels.set(merged[0], { levels: merged, distances: entry.lodDistances });
  for (const level of merged) {
    // Disabled sources still draw their enabled placed instances; enabling a
    // source would draw a spare prop at the origin. Shipped materials are shared
    // across placements, with independent fade bounds on each ordinary instance.
    level.setEnabled(false);
    level.isPickable = false;
    level.receiveShadows = true;
  }
  return merged;
}

// One collision box as a child of root, in the prop's own frame. Every box is a static body. One that
// moves (the ship's) takes its node's place before every physics step, so it is put exactly where the
// ship is and has no velocity: an animated body reports the speed of each jump as a surface velocity,
// which threw the player backwards along the deck.
export function solidBox(scene: Scene, root: TransformNode, name: string, centre: Vector3, rotation: Quaternion,
  extents: Vector3, mask: number, moves: boolean): TransformNode {
  const node = new TransformNode(name, scene);
  node.parent = root;
  node.position = centre;
  node.rotationQuaternion = rotation;
  const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, scene);
  body.shape = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), extents, scene);
  body.shape.filterMembershipMask = mask;
  if (moves) body.disablePreStep = false;
  return node;
}

// Stand one body per walk box and blocker: decks and ramps are ground that carries the player, rails
// and steps are obstacles that stop them. The blockers are passed separately so the ship can leave a
// gap in its rail.
export function solidBoxes(scene: Scene, root: TransformNode, name: string, entry: PropEntry, blockers: PropBlocker[],
  moves: boolean) {
  const level = Quaternion.Identity();
  for (const walk of entry.walk ?? []) {
    if (walk.kind === "ramp") {
      const dz = walk.to.z - walk.from.z, dy = walk.to.y - walk.from.y;
      // Tilt the box about the prop's x axis so its top face lies on the slope between the ends.
      const tilt = Math.atan2(walk.from.y - walk.to.y, dz);
      const c = Math.cos(tilt), s = Math.sin(tilt);
      const midY = (walk.from.y + walk.to.y) / 2, midZ = (walk.from.z + walk.to.z) / 2;
      solidBox(scene, root, `${name}_ramp`,
        new Vector3((walk.x[0] + walk.x[1]) / 2, midY - (walk.thickness / 2) * c, midZ - (walk.thickness / 2) * s),
        Quaternion.RotationYawPitchRoll(0, tilt, 0),
        new Vector3(walk.x[1] - walk.x[0], walk.thickness, Math.hypot(dz, dy)), GROUND_MASK, moves);
    } else {
      const top = walk.kind === "deck" ? walk.yTop : walk.y;
      solidBox(scene, root, `${name}_deck`,
        new Vector3((walk.x[0] + walk.x[1]) / 2, top - walk.thickness / 2, (walk.z[0] + walk.z[1]) / 2), level.clone(),
        new Vector3(walk.x[1] - walk.x[0], walk.thickness, walk.z[1] - walk.z[0]), GROUND_MASK, moves);
    }
  }
  for (const blocker of blockers)
    solidBox(scene, root, `${name}_rail`,
      new Vector3((blocker.x[0] + blocker.x[1]) / 2, (blocker.y[0] + blocker.y[1]) / 2, (blocker.z[0] + blocker.z[1]) / 2), level.clone(),
      new Vector3(blocker.x[1] - blocker.x[0], blocker.y[1] - blocker.y[0], blocker.z[1] - blocker.z[0]), OBSTACLE_MASK, moves);
}
