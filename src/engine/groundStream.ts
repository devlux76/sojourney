import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Material } from "@babylonjs/core/Materials/material";
import { DitheredTileFadeMaterialPlugin } from "@babylonjs/core/Materials/ditheredTileFadeMaterialPlugin";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeHeightField } from "@babylonjs/core/Physics/v2/physicsShape";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import "../core/ktx2";
import "./meshopt";
import type { GroundLeaf, GroundManifest } from "./pack";
import { rainHides } from "./environment/Fog";
import { GROUND_MASK } from "./player/ground";

// Mesh names in the pack: leaf_<id>_LOD<level>, level 0 = 128 quads ... level 4 = 8 quads.
const LEAF_NAME = /^leaf_(\d+)_LOD(\d+)$/;
// Levels 0 and 1 (128 and 64 quads) live in per-leaf "near" files; levels 2 to 4 are always loaded.
const NEAR_LEVELS = 2;
// A near file is requested this far before its level 2 -> 1 switch distance (about 2 s of running at 6 m/s plus load time) ...
const NEAR_MARGIN_METRES = 150;
// ... and released only this far beyond it, so walking back and forth across the line does not reload it.
const NEAR_RELEASE_METRES = 300;
// A level switch plays its cross-fade over this long in real time, then finishes: at rest every
// leaf and block sits at exactly one level, with no dither anywhere. Half a second reads as a
// dissolve rather than a pop, yet keeps up with a running player (at 6 m/s the smallest switch gap
// below is crossed in about that time). Wall-clock time, so standing still never leaves a half-fade.
const FADE_MS = 500;
// ... the switch outward happens at the switch distance D, the switch back inward at D * (1 - GAP):
// something hovering on a boundary fades once, then stays, instead of fading back and forth. Five
// percent is metres at ground distances (about 20 m at the 390 m switch) yet small against the
// distances themselves.
const FADE_GAP = 0.05;
// Havok height fields exist for leaves within 400 m (horizontal, to the leaf square), dropped beyond 500 m.
// Fishing casts reach 40 m and all other ground queries stay within 15 m of the player, so this is generous.
const COLLISION_METRES = 400;
const COLLISION_RELEASE_METRES = 500;
// prepare() waits for collision this close to the target so a teleport never drops the player through the world.
const PREPARE_COLLISION_METRES = 100;
// At most this many streaming loads at once, so decoding never piles up inside one frame.
const MAX_LOADS = 2;
// A prepared teleport target keeps its leaves loaded this long, until the camera has arrived.
const ANCHOR_SECONDS = 3;

interface Leaf {
  info: GroundLeaf;
  id: number;
  // The level the camera distance calls for (the switch target), and the fade towards it: shown is
  // the level drawn when settled and the fade's source while one plays, fadeStart the wall-clock
  // ms it began (-1 when settled), fade how far into it the last update got (1 when settled).
  // shown starts at -1, so the first update snaps to the target instead of fading across the map.
  level: number;
  shown: number;
  fadeStart: number;
  fade: number;
  // Whether the rain fog hides the whole leaf: it is not drawn then. Set from rainReach each frame.
  fogged: boolean;
  block: Block | null;
  // Levels 0 to 4: 0 and 1 from the leaf's near file, null until it is loaded, 2 to 4 always loaded.
  meshes: (Mesh | null)[];
  // The last fade bounds and enabled state set on each mesh: setEnabled and setFadeBounds are only
  // called when the value changed. Meshes start enabled with no bounds set, so these start on.
  state: FadeState[];
  near: AssetContainer | null;
  nearJob: Promise<void> | null;
  body: { node: TransformNode; body: PhysicsBody } | null;
  bodyJob: Promise<void> | null;
}

// The last fade bounds and enabled state set on a mesh.
interface FadeState {
  lower: number;
  upper: number;
  on: boolean;
}

const coldState = (): FadeState => ({ lower: -1, upper: -1, on: true });

// A square of leaves that can be drawn as one mesh: far away each leaf is a draw call for a few triangles,
// and the calls, not the triangles, are what cost. meshes[i] is the block at manifest.blockLevels[i],
// drawn in its own dither interval once the leaves have reached that level; tj[i] is how far into that
// level the block's leaves have least got.
interface Block {
  leaves: Leaf[];
  meshes: Mesh[];
  state: FadeState[];
  tj: number[];
}

// The per-leaf regional detail a GroundStream pages in beside the near meshes: the original-density
// normal/AO region referenced by each leaf (groundNormalTiles.ts implements this). load() fetches the tile
// without applying it and resolves once it is ready or has failed over to the distant fallback;
// bind() registers a mesh of that leaf and applies the ready tile, or the fallback when the tile
// is not ready; release() returns every bound mesh of that leaf to the fallback and drops the tile.
export interface GroundDetailResources {
  load(leafId: number): Promise<void>;
  bind(leafId: number, mesh: Mesh): void;
  release(leafId: number): void;
}

// Owns the ground leaves. The far levels of every leaf are loaded at startup and the near file of each
// leaf near the camera is streamed in; every frame the stream itself chooses the level drawn for
// each leaf and each block and the dither interval each is drawn in. A switch plays its cross-fade
// over half a second of real time and finishes: the old level takes [0, 1 - p), the new [1 - p, 1),
// so exactly one of them shows at every pixel and levels change with no pop; where a block fades in
// over its leaves the leaves share [0, u) and the block's levels continue from u. Collision is one
// Havok height field per leaf near the camera.
export class GroundStream {
  // How far the rain lets the player see, set from the sky each frame; leaves it fully hides are
  // not drawn. Infinite while the air is clear.
  rainReach = Infinity;
  // The binoculars' zoom, set from the player each frame: level switches answer to the distance
  // divided by it, so a 10x glass on a wall 1 km off draws the levels of 100 m. Fog, streaming
  // margins and collision stay physical.
  zoom = 1;
  // Whether a level switch plays its dithered cross-fade. Under water it does not: in a lamp's pool
  // of light on a dark bed the half second of dither stands out far more than the switch itself.
  fades = true;
  private leaves: Leaf[] = [];
  private blocks: Block[] = [];
  private anchor: { x: number; z: number; expires: number } | null = null;
  private loading = 0;

  private constructor(private scene: Scene, private manifest: GroundManifest, private material: Material,
    private fade: DitheredTileFadeMaterialPlugin, private resources: GroundDetailResources | null = null) {}

  static async create(scene: Scene, manifest: GroundManifest, material: Material,
    fade: DitheredTileFadeMaterialPlugin, resources?: GroundDetailResources): Promise<GroundStream> {
    const stream = new GroundStream(scene, manifest, material, fade, resources ?? null);
    const levels = new Map<number, Mesh[]>();
    const [blockContainer, ...containers] = await Promise.all([manifest.blocksUrl, ...manifest.far].map(url => LoadAssetContainerAsync(url, scene)));
    for (const container of containers) {
      container.addAllToScene();
      for (const mesh of container.meshes) {
        const name = LEAF_NAME.exec(mesh.name);
        if (!name || !(mesh instanceof Mesh)) continue;
        const id = Number(name[1]);
        if (!levels.has(id)) levels.set(id, []);
        levels.get(id)![Number(name[2])] = mesh;
        stream.configure(mesh, material);
        // The far levels are in the scene from here on: bind them to their leaf's tile now, so a
        // ready tile shades them and an unready one leaves the distant fallback in place.
        stream.resources?.bind(id, mesh);
      }
    }
    manifest.leaves.forEach((info, id) => {
      const meshes: (Mesh | null)[] = [null, null, ...levels.get(id)!.slice(NEAR_LEVELS)];
      stream.leaves.push({
        info, id, level: 0, shown: -1, fadeStart: -1, fade: 1, fogged: false, block: null, meshes,
        state: meshes.map(coldState), near: null, nearJob: null, body: null, bodyJob: null,
      });
    });
    blockContainer.addAllToScene();
    const blockMeshes = new Map(blockContainer.meshes.map(mesh => [mesh.name, mesh]));
    manifest.blocks.forEach((block, n) => {
      const meshes = manifest.blockLevels.map(level => blockMeshes.get(`block_${n}_LOD${level}`) as Mesh);
      // Block meshes span many leaves, so they are never bound to one leaf's tile: they keep the
      // distant fallback.
      for (const mesh of meshes) stream.configure(mesh, material);
      stream.blocks.push({ leaves: block.leaves.map(id => stream.leaves[id]), meshes, state: meshes.map(coldState), tj: [] });
    });
    for (const block of stream.blocks) for (const leaf of block.leaves) leaf.block = block;
    scene.onBeforeRenderObservable.add(() => stream.update());
    return stream;
  }

  nearCount(): number {
    return this.leaves.filter(leaf => leaf.near).length;
  }

  bodyCount(): number {
    return this.leaves.filter(leaf => leaf.body).length;
  }

  // Loads what must exist before the player is placed at (x, z): collision, and the finest mesh level around it.
  // A tile that fails to load must not strand the player: leaves without their near file draw their
  // far levels instead (the same fallback the per-frame update uses when leaf.near is unset), so each
  // leaf's failure fails open and the teleport still lands. A partial pack still needs its rebuild,
  // but it no longer rejects the travel that proved it partial.
  async prepare(x: number, z: number): Promise<void> {
    this.anchor = { x, z, expires: performance.now() + ANCHOR_SECONDS * 1000 };
    const jobs: Promise<void>[] = [];
    for (const leaf of this.leaves) {
      const { info } = leaf;
      if (this.rectDistance(info, x, z) < PREPARE_COLLISION_METRES) jobs.push(this.loadBody(leaf));
      if (Math.hypot(info.centre[0] - x, info.centre[2] - z) < info.lodDistances[0]) jobs.push(this.loadNear(leaf));
    }
    const settled = await Promise.allSettled(jobs);
    const failed = settled.filter(result => result.status === "rejected").length;
    if (failed > 0) console.warn(`ground prepare at (${x}, ${z}): ${failed} tile(s) missing, drawing far levels`);
  }

  private configure(mesh: Mesh, material: Material) {
    mesh.material = material;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
  }

  private rectDistance(info: GroundLeaf, x: number, z: number): number {
    const dx = Math.max(info.x - x, 0, x - (info.x + info.size));
    const dz = Math.max(info.z - z, 0, z - (info.z + info.size));
    return Math.hypot(dx, dz);
  }

  private update() {
    const camera = this.scene.activeCamera;
    if (!camera) return;
    const now = performance.now();
    if (this.anchor && now > this.anchor.expires) this.anchor = null;
    const eye = camera.globalPosition;
    const wanted: { leaf: Leaf; depth: number }[] = [];
    const wantedBodies: { leaf: Leaf; distance: number }[] = [];
    for (const leaf of this.leaves) {
      const { info } = leaf;
      const centre = Math.hypot(info.centre[0] - eye.x, info.centre[1] - eye.y, info.centre[2] - eye.z);
      // The switch target answers to the zoomed distance; streaming loads answer to the physical one.
      const d = centre / this.zoom;
      // The switch target from the distance, with a gap against the level shown: outward at the
      // switch distance, back inward a FADE_GAP below it, so hovering on a boundary fades once.
      // Without the near file there are no levels 0 and 1, so a leaf that would draw them draws
      // level 2 instead; if the file went away while a fine level showed, snap up to what is drawn.
      let target = info.lodDistances.reduce((n, distance) => n + (d > distance ? 1 : 0), 0);
      // Water entry cancels fades: select from today's distance, rather than
      // snapping to the goal of a transition begun before a reversal or teleport.
      if (this.fades && leaf.shown >= 0 && leaf.fadeStart >= 0) {
        // A fade once begun plays out to the level it set off for, and only then is the distance
        // asked again, so a leaf on a switch distance cannot start and cancel its fade every frame.
        target = leaf.level;
      } else if (this.fades && leaf.shown >= 0) {
        target = leaf.shown;
        const last = info.lodDistances.length;
        while (target < last && d >= info.lodDistances[target]) target++;
        while (target > 0 && d < info.lodDistances[target - 1] * (1 - FADE_GAP)) target--;
      }
      if (!leaf.near && target < NEAR_LEVELS) target = NEAR_LEVELS;
      if (leaf.shown < 0 || !this.fades || (!leaf.near && leaf.shown < NEAR_LEVELS)) {
        leaf.shown = target;
        leaf.fadeStart = -1;
      } else if (target !== leaf.shown) {
        if (leaf.fadeStart < 0) leaf.fadeStart = now;
      } else leaf.fadeStart = -1;
      // How far the fade into the target has run on the wall clock.
      leaf.fade = 1;
      if (leaf.fadeStart >= 0) {
        leaf.fade = Math.min(1, (now - leaf.fadeStart) / FADE_MS);
        if (leaf.fade >= 1) {
          leaf.shown = target;
          leaf.fadeStart = -1;
        }
      }
      leaf.level = target;
      // A leaf the rain fog fully hides is not drawn: the fog on it and the veil behind it are both
      // opaque past the reach, measured to its nearest edge and over its highest ground.
      leaf.fogged = rainHides(this.rainReach, this.rectDistance(info, eye.x, eye.z),
        info.heightMin + 65535 * info.heightScale - eye.y);
      let flat = this.rectDistance(info, eye.x, eye.z);
      // Streaming loads for the teleport target too, but the level fade above answers only to the camera.
      let stream = d;
      if (this.anchor) {
        stream = Math.min(stream, Math.hypot(info.centre[0] - this.anchor.x, info.centre[2] - this.anchor.z));
        flat = Math.min(flat, this.rectDistance(info, this.anchor.x, this.anchor.z));
      }
      const reach = info.lodDistances[1];
      if (leaf.near) {
        if (stream > reach + NEAR_RELEASE_METRES) this.unloadNear(leaf);
      } else if (!leaf.nearJob && stream < reach + NEAR_MARGIN_METRES) {
        wanted.push({ leaf, depth: stream - reach });
      }
      if (leaf.body) {
        if (flat > COLLISION_RELEASE_METRES) this.unloadBody(leaf);
      } else if (!leaf.bodyJob && flat < COLLISION_METRES) {
        wantedBodies.push({ leaf, distance: flat });
      }
    }
    this.updateLevels();
    wanted.sort((a, b) => a.depth - b.depth);
    for (const { leaf } of wanted) {
      if (this.loading >= MAX_LOADS) break;
      this.loading++;
      this.loadNear(leaf).finally(() => { this.loading--; });
    }
    wantedBodies.sort((a, b) => a.distance - b.distance);
    for (const { leaf } of wantedBodies.slice(0, MAX_LOADS)) this.loadBody(leaf);
  }

  // Chooses the levels drawn for every leaf and every block, and the dither interval each is
  // drawn in. Settled, a leaf draws its shown level whole in [0, u) and the block's levels continue
  // from u; fading, the old and new levels split [0, u) between them, [0, (1 - p) * u) and
  // [(1 - p) * u, u), so exactly one of them shows at every pixel. The block's mesh at a level is
  // its leaves' meshes at that level joined, so the splits between them are invisible. A fogged leaf
  // or block gets nothing enabled. Meshes of levels not in use are disabled.
  private updateLevels() {
    const switches = this.manifest.blockLevels;
    for (const block of this.blocks) {
      // tj is the least progress any leaf has made past blockLevels[j]: 1 once the leaf draws at or
      // past it, the fade progress while fading into it, 0 before that. It falls as j rises.
      block.tj.length = 0;
      for (const at of switches) {
        let progress = 1;
        for (const leaf of block.leaves) {
          const into = leaf.shown === leaf.level
            ? (leaf.shown >= at ? 1 : 0)
            : (leaf.shown >= at ? 1 - leaf.fade : 0) + (leaf.level >= at ? leaf.fade : 0);
          if (into < progress) progress = into;
        }
        block.tj.push(progress);
      }
    }
    for (const leaf of this.leaves) {
      const u = leaf.block && switches.length > 0 ? 1 - leaf.block.tj[0] : 1;
      const from = leaf.shown, to = leaf.level;
      const edge = from === to ? u : (1 - leaf.fade) * u;
      for (let m = 0; m < leaf.meshes.length; m++) {
        let lower = 0, upper = 0;
        if (m === from && m === to) upper = u;
        else if (m === from) upper = edge;
        else if (m === to) { lower = edge; upper = u; }
        this.setMesh(leaf.meshes[m], lower, upper, leaf.fogged, leaf.state[m]);
      }
    }
    for (const block of this.blocks) {
      // A block is hidden only when all of its leaves are fogged.
      const fogged = block.leaves.every(leaf => leaf.fogged);
      block.meshes.forEach((mesh, j) => {
        this.setMesh(mesh, 1 - block.tj[j], j + 1 < switches.length ? 1 - block.tj[j + 1] : 1,
          fogged, block.state[j]);
      });
    }
  }

  // Draws a mesh in its dither interval, or not at all: it is enabled exactly when the interval is
  // not empty and the fog does not hide it. The bounds and the flag are only set on change.
  private setMesh(mesh: Mesh | null, lower: number, upper: number, fogged: boolean, last: FadeState) {
    const on = mesh !== null && !fogged && upper > lower;
    if (mesh && on && (lower !== last.lower || upper !== last.upper)) {
      this.fade.setFadeBounds(mesh, lower, upper);
      last.lower = lower;
      last.upper = upper;
    }
    if (on !== last.on) {
      mesh?.setEnabled(on);
      last.on = on;
    }
  }

  private loadNear(leaf: Leaf): Promise<void> {
    if (leaf.near) return Promise.resolve();
    leaf.nearJob ??= (async () => {
      // The near meshes and the leaf's regional tile load together: prepare() waits this job, so
      // the tile is ready (or failed over to the distant fallback) before the leaf draws near.
      // The container is captured in .then (via a holder, so narrowing keeps it nullable),
      // so a Promise.all rejection from either side still disposes a successfully loaded GLB below.
      const holder: { container: AssetContainer | null } = { container: null };
      try {
        const glb = LoadAssetContainerAsync(`${this.manifest.nearUrl}${leaf.id}.glb`, this.scene)
          .then(loaded => (holder.container = loaded));
        await Promise.all([glb, this.resources?.load(leaf.id) ?? Promise.resolve()]);
        holder.container!.addAllToScene();
        // Loading only fills levels 0 and 1, configured and disabled; the next update fades them in.
        for (const mesh of holder.container!.meshes) {
          const name = LEAF_NAME.exec(mesh.name);
          if (!name || !(mesh instanceof Mesh)) continue;
          const level = Number(name[2]);
          this.configure(mesh, this.material);
          mesh.setEnabled(false);
          leaf.meshes[level] = mesh;
          leaf.state[level] = { lower: -1, upper: -1, on: false };
        }
        // Both are in: bind every extant mesh of the leaf, so the new near levels pick up the
        // ready tile (or the fallback) and the already-bound far levels re-bind harmlessly.
        if (this.resources) for (const mesh of leaf.meshes) if (mesh) this.resources.bind(leaf.id, mesh);
        leaf.near = holder.container;
      } catch (error) {
        // The GLB or its setup failed: drop any half-loaded container and release the tile, so the
        // leaf falls back to its far levels on the distant normal map like any unloaded leaf.
        if (holder.container) {
          try { holder.container.dispose(); } catch { /* already gone with the scene */ }
          holder.container = null;
        }
        this.resources?.release(leaf.id);
        throw error;
      }
    })().finally(() => { leaf.nearJob = null; });
    return leaf.nearJob;
  }

  private unloadNear(leaf: Leaf) {
    leaf.near!.dispose();
    leaf.near = null;
    // The meshes are gone with the container; the next file starts disabled with no bounds set.
    for (let level = 0; level < NEAR_LEVELS; level++) {
      leaf.meshes[level] = null;
      leaf.state[level] = { lower: -1, upper: -1, on: false };
    }
    // Released last: the manager first returns the leaf's still-bound far meshes to the distant
    // fallback, then drops the tile.
    this.resources?.release(leaf.id);
  }

  private loadBody(leaf: Leaf): Promise<void> {
    if (leaf.body) return Promise.resolve();
    leaf.bodyJob ??= (async () => {
      const { info } = leaf;
      const samples = this.manifest.collisionSamples;
      const packed = new Uint16Array(await (await fetch(`${this.manifest.collisionUrl}${leaf.id}.bin`)).arrayBuffer());
      const heights = new Float32Array(packed.length);
      for (let i = 0; i < packed.length; i++) heights[i] = info.heightMin + packed[i] * info.heightScale;
      const node = new TransformNode("groundCollision", this.scene);
      node.position.set(info.x + info.size / 2, 0, info.z + info.size / 2);
      node.computeWorldMatrix(true);
      const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
      body.shape = new PhysicsShapeHeightField(info.size, info.size, samples, samples, heights, this.scene);
      body.shape.filterMembershipMask = GROUND_MASK;
      leaf.body = { node, body };
    })().finally(() => { leaf.bodyJob = null; });
    return leaf.bodyJob;
  }

  private unloadBody(leaf: Leaf) {
    const { node, body } = leaf.body!;
    body.shape?.dispose();
    body.dispose();
    node.dispose();
    leaf.body = null;
  }
}
