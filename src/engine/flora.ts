import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Material } from "@babylonjs/core/Materials/material";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { DitheredTileFadeMaterialPlugin } from "@babylonjs/core/Materials/ditheredTileFadeMaterialPlugin";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeCylinder } from "@babylonjs/core/Physics/v2/physicsShape";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import type { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import "../core/ktx2";
import "./meshopt";
import { rainHides } from "./environment/Fog";
import type { Biome } from "../biomes/Biome";
import { TrunkGrid } from "../play/TrunkGrid";
import type { FloraKind, ForestManifest, ForestSpecies, GroundLeaf } from "./pack";
import { OBSTACLE_MASK } from "./player/ground";

const TRUNK_REACH = 0.9;
// The near cells are sorted into levels again when the camera has moved this far, and while any
// cross-fade is playing, so the fade runs on the wall clock even standing still ...
const RESORT_METRES = 0.25;
// ... and the far lists are built again when it has moved this far. A cell is sorted tree by tree while
// it is within the species' last level distance plus this slack, so nothing in a far list can come
// close enough to need a better level before the lists are next built.
const FAR_SLACK_METRES = 25;
// Trunk colliders, the chopping grid and rock seats exist for what stands this close to the camera;
// they are found again whenever the camera has moved NEARBY_SLACK_METRES.
const NEARBY_METRES = 48;
const NEARBY_SLACK_METRES = 8;
// A leaf's file is released this far beyond the distance at which it is wanted.
const RELEASE_METRES = 150;
// Nothing the forest stands on is taller than this, so a leaf's top plus this clears every tree.
const TALLEST_METRES = 80;
// A level switch plays its cross-fade over this long in real time, then finishes: at rest every
// tree, rock and shrub sits at exactly one level, with no dither anywhere. Half a second reads as
// a dissolve rather than a pop, yet a running player (6 m/s) is barely a stride in.
const FADE_MS = 500;
// ... the switch outward happens at the switch distance D, the switch back inward at D * (1 - GAP):
// something hovering on a boundary fades once, then stays, instead of fading back and forth. Five
// percent is centimetres at flora distances (40 cm at the 8 m tree switch), still above the sort's
// quarter-metre step, and small against the distances themselves.
const FADE_GAP = 0.05;
// prepare() loads the full files this close to a teleport target and holds them until the camera is there.
const PREPARE_METRES = 150;
const ANCHOR_SECONDS = 3;
const MAX_LOADS = 4;
// While leaves are still arriving, gather their costly middle-band uploads.
// Rebuilding full lists publishes pending ownership changes in the same update.
const REBUILD_SECONDS = 1;
// Records turned into matrices before the frame is given back, so a big leaf never stalls one.
const RECORDS_PER_SLICE = 4000;
const BURIED_Y = -10000;
const BURIED = Matrix.Translation(0, BURIED_Y, 0);
// A pebble is too small to sit on, and a wide patch is many small rocks rather than one seat.
const MIN_SEAT_RADIUS = 0.3;
const MAX_SEAT_RADIUS = 2.0;
const SEAT_CELL = 4;

// The top of a rock the player could sit on: the centre of its top in world metres and the radius of its footprint.
export interface RockSeat { x: number; y: number; z: number; radius: number }

// One mesh drawn as thin instances from a buffer that grows as needed. Level meshes also carry a
// dither interval per instance, two floats each grown with the buffer; the far, beyond and
// middle-band meshes never fade and draw without them.
interface Draw {
  mesh: Mesh;
  buffer: Float32Array;
  fades: Float32Array;
  fade: DitheredTileFadeMaterialPlugin[];
  count: number;
  grown: boolean;
}

// A species: its levels (filled by the near sort), the last level again for everything in the full
// files that is beyond the level distances, in two meshes: "far" out to the reach of the shadows, which
// casts them, and "beyond" past it, which is left out of the shadow pass since nothing there can cast
// a shadow that is drawn. Trees have the last level once more for the middle band ("mid"), which is
// also past the shadows and casts none.
interface Batch {
  species: ForestSpecies;
  levels: Draw[];
  far: Draw;
  beyond: Draw;
  mid: Draw | null;
  source: Mesh;
  sortReach: number;
  collider: Mesh | null;
  seatWidth: number;
  seatTop: number;
  boundsRadius: number;
}

// A run of one species' records in a file, standing in one cell, largest first.
interface Cell { x: number; z: number; radius: number; first: number; count: number; minY: number; maxY: number }

// One decoded placement file: a matrix per record, the distance beyond which each record is under two
// pixels, each record's packed leaf coordinates (to find the same tree in the other file), the level
// each record draws at (255 until first sorted), when its fade from that level began (-1 settled),
// the level that fade set off for, and the cells of each species.
interface LeafFile {
  matrices: Float32Array;
  reach: Float32Array;
  xz: Uint32Array;
  shown: Uint8Array;
  fadeStart: Float32Array;
  goal: Uint8Array;
  cells: Cell[][];
}

interface Leaf {
  id: number;
  info: GroundLeaf;
  near: LeafFile | null;
  mid: LeafFile | null;
  nearJob: Promise<void> | null;
  midJob: Promise<void> | null;
}

interface NearCell { leaf: Leaf; batch: Batch; cell: Cell }

interface Tree { leaf: Leaf; batch: Batch; index: number }

// A tree taken out of its batch to be shaken or felled: its own mesh, and the matrix to put back.
interface Standing { mesh: Mesh; leaf: Leaf; index: number; saved: Float32Array }

// Everything that stands on the ground, read from flora/forest.json and streamed leaf by leaf (layout
// in pack.ts). Within nearMetres of a leaf its full file is loaded: cells close to the camera are
// sorted record by record into the species' levels, the rest are copied whole into the "far" mesh at
// the last level, each cell cut where its records drop under two pixels. Leaves out to midMetres draw
// their middle-band file instead, as tree cards. Beyond that the forest is painted into the ground.
export class Flora {
  readonly trunks = new TrunkGrid(TRUNK_REACH);
  private batches: (Batch | null)[] = [];
  private leaves: Leaf[] = [];
  private nearCells: NearCell[] = [];
  private trees = new Map<string, Tree>();
  private standing = new Map<string, Standing>();
  // Felled trees by ground leaf: record indices in the leaf's full file, and the same trees' packed
  // coordinates for its middle-band file. Kept for the session and applied whenever a file is loaded.
  private felled = new Map<number, { indices: Set<number>; xz: Set<number> }>();
  // Seats are kept in a grid of 4 m cells so nearby rocks can be found without scanning them all.
  private seats = new Map<string, RockSeat[]>();
  private anchor: { x: number; z: number; expires: number } | null = null;
  private loading = 0;
  private changed = false;
  private builtAt = 0;
  private farAt: Vector3 | null = null;
  private sortedAt: Vector3 | null = null;
  private nearbyAt: Vector3 | null = null;
  // Whether the last near sort left a fade playing, and when the latest fade ends on the wall
  // clock: the sort keeps running while either says so, and rests otherwise.
  private fading = false;
  private fadesUntil = 0;

  // How far the sun's shadows reach from the camera, in metres.
  private shadowReach = 0;
  // How far the rain lets the player see, set from the sky each frame; the far and middle-band
  // lists skip what it fully hides. Infinite while the air is clear.
  rainReach = Infinity;
  // Radius of the opaque volume around a submerged eye; infinite on land.
  // Height bounds remove depth-hidden cells independently of the rain veil.
  waterRadius = Infinity;
  private waterRadiusSeen = Infinity;
  // The binoculars' zoom, set from the player each frame: level switches and two-pixel culls
  // answer to the distance divided by it, so zooming shows the close-up levels. The lists are
  // rebuilt when it moves more than a twentieth, so the 10 s ramp rebuilds a handful of times,
  // not every frame. Shadows, fog and everything within arm's reach stay physical.
  zoom = 1;
  private zoomSeen = 1;
  // Whether a level switch plays its dithered cross-fade; off under water, as on the ground.
  fades = true;
  private fadesSeen = true;
  // The rain reach the far and middle-band lists were last built for, rainReach * 1.25 plus the
  // slack: they are built again once the rain moves past what that allows for, either way.
  private reachBuilt = Infinity;
  // The rain reach the lists are built from: rainReach, or infinite when it is past every leaf whose
  // files are loaded, where it hides nothing and the lists need not follow it or the eye.
  private reach = Infinity;
  // Where the eye was when the middle-band lists were last built: they depend on the camera while
  // the rain hides anything, unlike the far lists. Null while they never have.
  private midAt: Vector3 | null = null;
  // Clones of level materials without the fade plugin, one per source material, for the meshes
  // that never fade.
  private plainMaterials = new Map<Material, Material>();

  private constructor(private scene: Scene, private manifest: ForestManifest | null) {}

  static async load(scene: Scene, biome: Biome, shadows: CascadedShadowGenerator, ground: GroundLeaf[]): Promise<Flora> {
    const response = await fetch(`packs/${biome.id}/flora/forest.json`);
    if (!response.ok || !response.headers.get("content-type")?.includes("json")) return new Flora(scene, null);
    const manifest: ForestManifest = await response.json();
    const flora = new Flora(scene, manifest);
    flora.shadowReach = shadows.shadowMaxZ;
    flora.batches = await Promise.all(manifest.species.map(species => flora.add(species, shadows)));
    manifest.leaves.forEach(([near, mid], id) => {
      if (near + mid > 0) flora.leaves.push({ id, info: ground[id], near: null, mid: null, nearJob: null, midJob: null });
    });
    scene.onBeforeRenderObservable.add(() => flora.update());
    return flora;
  }

  // The distances between which the ground takes over from the trees: where the full files end and
  // where the middle-band cards end. Null when the pack has no forest.
  get band(): [number, number] | null {
    return this.manifest ? [this.manifest.nearMetres, this.manifest.midMetres] : null;
  }

  // Loads the full files around (x, z) before the player is placed there, so they arrive among trees.
  async prepare(x: number, z: number): Promise<void> {
    this.anchor = { x, z, expires: performance.now() + ANCHOR_SECONDS * 1000 };
    await Promise.all(this.leaves.filter(leaf => rectDistance(leaf.info, x, z) < PREPARE_METRES).map(leaf => this.loadNear(leaf)));
  }

  private async add(species: ForestSpecies, shadows: CascadedShadowGenerator): Promise<Batch | null> {
    try {
      const meshes = await loadLevels(this.scene, species);
      const source = meshes[0].clone(`${species.id}_source`);
      source.setEnabled(false);
      const last = meshes[meshes.length - 1];
      // The middle-band, far and beyond meshes draw the last level whole and never fade, and hold up
      // to hundreds of thousands of instances between them: they share one clone of its material
      // without the fade plugin, so they carry no per-instance fade buffer.
      const plain = this.plainMaterial(last);
      // A clone shares its geometry, and thin-instance matrices are vertex buffers of the geometry, so
      // each clone that is drawn gets a geometry of its own.
      const copy = (name: string) => {
        const mesh = last.clone(name).makeGeometryUnique();
        mesh.material = plain;
        return mesh;
      };
      const draw = (mesh: Mesh, casts: boolean, fade: DitheredTileFadeMaterialPlugin[]): Draw => {
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.isPickable = false;
        mesh.receiveShadows = true;
        mesh.setEnabled(false);
        if (casts) shadows.addShadowCaster(mesh);
        return { mesh, buffer: new Float32Array(0), fades: new Float32Array(0), fade, count: 0, grown: false };
      };
      // The model's own extents: getBoundingInfo() would give the extent of the placed instances instead.
      const { minimum, maximum } = meshes[0].getRawBoundingInfo().boundingBox;
      // Enclose every authored level about its placement origin using Babylon's
      // raw sphere. A uniform placement scale/rotation preserves this enclosure.
      const boundsRadius = Math.max(...meshes.map(mesh => {
        const sphere = mesh.getRawBoundingInfo().boundingSphere;
        return sphere.center.length() + sphere.radius;
      }));
      return {
        species, source,
        levels: meshes.map(mesh => draw(mesh, species.castsShadows, levelFade(mesh))),
        far: draw(copy(`${species.id}_far`), species.castsShadows, []),
        beyond: draw(copy(`${species.id}_beyond`), false, []),
        mid: species.kind === "tree" ? draw(copy(`${species.id}_mid`), false, []) : null,
        sortReach: (meshes.length > 1 ? species.lodDistances[meshes.length - 2] : 0) + FAR_SLACK_METRES,
        collider: species.collider ? this.addCollider(species) : null,
        seatWidth: Math.max(maximum.x - minimum.x, maximum.z - minimum.z),
        seatTop: maximum.y,
        boundsRadius,
      };
    } catch (error) {
      console.error(`flora species ${species.id} (${species.modelUrl}) skipped`, error);
      return null;
    }
  }

  // A clone of a level mesh's material without the fade plugin, for the meshes that never fade:
  // cloning drops the plugin, which is marked not to serialize, while sharing the textures. One
  // clone per source material, cached across species; a multi-material gets a plain wrapper whose
  // sub-materials are the cached clones.
  private plainMaterial(mesh: Mesh): Material {
    const material = mesh.material;
    if (material instanceof MultiMaterial) {
      const plain = new MultiMaterial(`${material.name}_plain`, this.scene);
      plain.subMaterials = material.subMaterials.map(sub => sub && this.plainSingle(sub));
      return plain;
    }
    return this.plainSingle(material!);
  }

  private plainSingle(material: Material): Material {
    let plain = this.plainMaterials.get(material);
    if (!plain) {
      plain = material.clone(`${material.name}_plain`) as Material;
      this.plainMaterials.set(material, plain);
    }
    return plain;
  }

  // One static Havok body per trunk near the camera, as thin instances of a hidden cylinder. It starts
  // with a single buried instance because a body takes its instances from the mesh when it is made.
  private addCollider(species: ForestSpecies): Mesh {
    const { radius, height } = species.collider!;
    const mesh = MeshBuilder.CreateCylinder(`${species.id}_trunks`, { height, diameter: 2 * radius, tessellation: 8 }, this.scene);
    mesh.isVisible = false;
    mesh.isPickable = false;
    mesh.thinInstanceSetBuffer("matrix", BURIED.asArray().slice() as unknown as Float32Array, 16, false);
    const body = new PhysicsBody(mesh, PhysicsMotionType.STATIC, false, this.scene);
    body.shape = new PhysicsShapeCylinder(new Vector3(0, 0, 0), new Vector3(0, height, 0), radius, this.scene);
    body.shape.filterMembershipMask = OBSTACLE_MASK;
    return mesh;
  }

  private update() {
    const camera = this.scene.activeCamera;
    if (!camera || !this.manifest) return;
    const eye = camera.globalPosition;
    if (this.waterRadius !== this.waterRadiusSeen) {
      this.waterRadiusSeen = this.waterRadius;
      this.farAt = this.midAt = this.sortedAt = null;
    }
    // Entering/leaving water must re-sort even at rest: a running fade becomes an
    // immediate distance-based selection underwater, without keeping its old goal.
    if (this.fades !== this.fadesSeen) {
      this.fadesSeen = this.fades;
      this.sortedAt = null;
    }
    // A changed zoom rebuilds the far lists and re-sorts the near cells below.
    if (Math.abs(this.zoomSeen - this.zoom) / this.zoomSeen > 0.05) {
      this.zoomSeen = this.zoom;
      this.farAt = null;
      this.sortedAt = null;
      this.nearbyAt = null;
      this.midAt = null;
      this.reachBuilt = -Infinity;
    }
    this.stream(eye);
    const now = performance.now();
    if (this.changed && (this.loading === 0 || now - this.builtAt > REBUILD_SECONDS * 1000)) {
      this.changed = false;
      this.builtAt = now;
      this.buildMid(eye);
      this.farAt = null;
    }
    // The far and middle-band lists are built for a rain reach of reachBuilt. They are built again
    // once the rain has thickened or thinned past what that allows for; the middle band also follows
    // the eye while the rain hides anything, since its lists depend on the camera then. While the
    // air is clear the reach is infinite and none of this fires.
    this.reach = this.rainReach < this.manifest.midMetres + RELEASE_METRES ? this.rainReach : Infinity;
    const stale = this.reach + FAR_SLACK_METRES > this.reachBuilt || this.reach < this.reachBuilt / 2;
    if (!this.farAt || Vector3.DistanceSquared(eye, this.farAt) > FAR_SLACK_METRES ** 2 || stale) {
      // Camera travel or release can rebuild full-file lists before the arrival
      // throttle expires. Refresh middle ownership too, or both files can draw
      // a leaf (arrival), or neither can draw it (release). Keep batching at rest.
      if (this.changed) {
        this.changed = false;
        this.builtAt = now;
        this.buildMid(eye);
      }
      this.buildFar(eye);
      this.sortedAt = this.nearbyAt = null;
    }
    // A radius change invalidates midAt even in clear air; depth-dependent
    // middle lists must also follow vertical camera travel without rain.
    if (stale || !this.midAt || ((this.reach < Infinity || this.waterRadius < Infinity) &&
      Vector3.DistanceSquared(eye, this.midAt) > FAR_SLACK_METRES ** 2)) {
      this.buildMid(eye);
    }
    // The sort moves with the camera, and every frame while a fade plays so the fade runs on the
    // wall clock; otherwise it rests. Either flag alone restarts it, and the run below settles both.
    if (!this.sortedAt || Vector3.DistanceSquared(eye, this.sortedAt) > RESORT_METRES ** 2 ||
      now < this.fadesUntil || this.fading) this.sortNear(eye, now);
    if (!this.nearbyAt || Vector3.DistanceSquared(eye, this.nearbyAt) > NEARBY_SLACK_METRES ** 2) this.findNearby(eye);
  }

  // Asks for the files of leaves that have come within range, nearest first, and releases those that
  // have gone RELEASE_METRES beyond it. Ranges answer to the zoomed distance, so the glass pulls
  // in the full files of the wall it is aimed at.
  private stream(eye: Vector3) {
    const { nearMetres, midMetres } = this.manifest!;
    if (this.anchor && performance.now() > this.anchor.expires) this.anchor = null;
    const wanted: { leaf: Leaf; near: boolean; distance: number }[] = [];
    for (const leaf of this.leaves) {
      let d = rectDistance(leaf.info, eye.x, eye.z) / this.zoom;
      if (this.anchor) d = Math.min(d, rectDistance(leaf.info, this.anchor.x, this.anchor.z));
      const [nearCount, midCount] = this.manifest!.leaves[leaf.id];
      if (leaf.near) {
        if (d > nearMetres + RELEASE_METRES) this.unloadNear(leaf);
      } else if (nearCount && !leaf.nearJob && d < nearMetres) wanted.push({ leaf, near: true, distance: d });
      if (leaf.mid) {
        if (d > midMetres + RELEASE_METRES) {
          leaf.mid = null;
          this.changed = true;
        }
      } else if (midCount && !leaf.midJob && d < midMetres) wanted.push({ leaf, near: false, distance: d });
    }
    wanted.sort((a, b) => a.distance - b.distance);
    for (const { leaf, near } of wanted) {
      if (this.loading >= MAX_LOADS) break;
      this.loading++;
      (near ? this.loadNear(leaf) : this.loadMid(leaf)).finally(() => { this.loading--; });
    }
  }

  private loadNear(leaf: Leaf): Promise<void> {
    if (leaf.near || !this.manifest!.leaves[leaf.id][0]) return Promise.resolve();
    leaf.nearJob ??= (async () => {
      const file = await this.decode(`${this.manifest!.leavesUrl}${leaf.id}.bin`, leaf.info, this.manifest!.cellMetres);
      for (const index of this.felled.get(leaf.id)?.indices ?? []) file.matrices.set(BURIED.asArray(), index * 16);
      leaf.near = file;
      this.changed = true;
    })().catch(error => console.error(`flora leaf ${leaf.id} failed to load`, error)).finally(() => { leaf.nearJob = null; });
    return leaf.nearJob;
  }

  private loadMid(leaf: Leaf): Promise<void> {
    leaf.midJob ??= (async () => {
      // The middle band is only ever drawn whole, so each species is a single cell: the leaf.
      const file = await this.decode(`${this.manifest!.midUrl}${leaf.id}.bin`, leaf.info, leaf.info.size);
      const felled = this.felled.get(leaf.id)?.xz;
      if (felled) file.xz.forEach((xz, index) => { if (felled.has(xz)) file.matrices.set(BURIED.asArray(), index * 16); });
      leaf.mid = file;
      this.changed = true;
    })().catch(error => console.error(`flora middle band of leaf ${leaf.id} failed to load`, error)).finally(() => { leaf.midJob = null; });
    return leaf.midJob;
  }

  private unloadNear(leaf: Leaf) {
    for (const [key, tree] of this.standing) {
      if (tree.leaf !== leaf) continue;
      tree.mesh.dispose();
      this.standing.delete(key);
    }
    leaf.near = null;
    // Force publication; update refreshes middle ownership with the full lists.
    this.changed = true;
    this.farAt = null;
  }

  // Reads a placement file (records as laid out in pack.ts) into matrices, a few thousand per frame.
  private async decode(url: string, info: GroundLeaf, cellMetres: number): Promise<LeafFile> {
    const { recordBytes, scaleUnit, pixelReach, species } = this.manifest!;
    const view = new DataView(await (await fetch(url)).arrayBuffer());
    const count = Math.floor(view.byteLength / recordBytes);
    const file: LeafFile = {
      matrices: new Float32Array(count * 16), reach: new Float32Array(count), xz: new Uint32Array(count),
      // No record has been sorted into a level yet; wall-clock time is never negative while one plays.
      shown: new Uint8Array(count).fill(255), fadeStart: new Float32Array(count).fill(-1),
      goal: new Uint8Array(count),
      cells: species.map(() => []),
    };
    const across = Math.round(info.size / cellMetres), unit = info.size / 65536;
    const radius = cellMetres * Math.SQRT1_2;
    let cell: Cell | null = null, cellKey = -1;
    for (let i = 0; i < count; i++) {
      const o = i * recordBytes;
      const qx = view.getUint16(o + 4, true), qz = view.getUint16(o + 6, true);
      const scale = view.getUint16(o + 8, true) * scaleUnit, kind = view.getUint8(o + 11);
      writeMatrix(file.matrices, i * 16, info.x + (qx + 0.5) * unit, view.getFloat32(o, true), info.z + (qz + 0.5) * unit,
        scale, view.getUint8(o + 10) / 256 * 2 * Math.PI, view.getInt8(o + 12) / 127, view.getInt8(o + 13) / 127);
      file.reach[i] = pixelReach * species[kind].size * scale;
      file.xz[i] = qx * 65536 + qz;
      const cx = Math.floor(qx * across / 65536), cz = Math.floor(qz * across / 65536);
      const key = (kind * across + cz) * across + cx;
      if (key !== cellKey) {
        cellKey = key;
        cell = { x: info.x + (cx + 0.5) * cellMetres, z: info.z + (cz + 0.5) * cellMetres, radius, first: i, count: 0,
          minY: Infinity, maxY: -Infinity };
        file.cells[kind].push(cell);
      }
      cell!.count++;
      // Failed species are never drawn. Keep their bounds unbounded rather than
      // deriving an extent from the manifest's screen-size estimate.
      const extent = (this.batches[kind]?.boundsRadius ?? Infinity) * scale;
      const y = file.matrices[i * 16 + 13];
      cell!.minY = Math.min(cell!.minY, y - extent);
      cell!.maxY = Math.max(cell!.maxY, y + extent);
      if (i % RECORDS_PER_SLICE === RECORDS_PER_SLICE - 1) await new Promise(resolve => setTimeout(resolve));
    }
    return file;
  }

  // Fills the middle-band meshes from the leaves that have no full file loaded. Their contents
  // do not depend on where the camera is, so this runs only when a file has arrived or gone — and
  // while the rain hides anything, when the fog decides per leaf from the eye, so it follows that too.
  private buildMid(eye: Vector3) {
    this.reachBuilt = this.reach * 1.25 + FAR_SLACK_METRES;
    this.midAt = eye.clone();
    for (const batch of this.batches) if (batch?.mid) batch.mid.count = 0;
    for (const leaf of this.leaves) {
      if (leaf.near || !leaf.mid) continue;
      // A leaf the rain fog fully hides draws nothing: the fog on it and the veil behind it are
      // both opaque past the reach, over the tallest thing that can stand on it.
      const { info } = leaf;
      if (rainHides(this.reachBuilt, rectDistance(info, eye.x, eye.z),
        info.heightMin + 65535 * info.heightScale + TALLEST_METRES - eye.y)) continue;
      const { matrices, cells } = leaf.mid;
      cells.forEach((runs, kind) => {
        const batch = this.batches[kind];
        if (batch?.mid) for (const run of runs) {
          if (!this.waterHides(run, eye)) this.appendWaterVisible(batch.mid, batch, matrices, run.first, run.count, eye);
        }
      });
    }
    for (const batch of this.batches) if (batch?.mid) flush(batch.mid);
  }

  // Fills the far meshes from the full files and lists the cells close enough to be sorted record by record.
  private buildFar(eye: Vector3) {
    this.farAt = eye.clone();
    this.nearCells = [];
    this.reachBuilt = this.reach * 1.25 + FAR_SLACK_METRES;
    for (const batch of this.batches) if (batch) batch.far.count = batch.beyond.count = 0;
    // The far meshes are built again once the camera has moved FAR_SLACK_METRES, so a cell that far past
    // the shadows' reach now cannot come within it before then.
    const shadowReach = this.shadowReach + FAR_SLACK_METRES;
    for (const leaf of this.leaves) {
      const file = leaf.near;
      if (!file) continue;
      file.cells.forEach((cells, kind) => {
        const batch = this.batches[kind];
        if (!batch) return;
        for (const cell of cells) {
          if (this.waterHides(cell, eye)) {
            resetCellFade(file, cell);
            continue;
          }
          // Cell ranges and two-pixel culls answer to the zoomed distance: under the glass a
          // record counts as ten times nearer, and stays two pixels tall ten times farther off.
          const distance = Math.max(0, Math.hypot(cell.x - eye.x, cell.z - eye.z) - cell.radius) / this.zoom;
          // A cell the rain fog fully hides draws nothing and needs no finer level either.
          const { info } = leaf;
          if (rainHides(this.reachBuilt, distance,
            info.heightMin + 65535 * info.heightScale + TALLEST_METRES - eye.y)) {
            resetCellFade(file, cell);
            continue;
          }
          if (distance < batch.sortReach) {
            this.nearCells.push({ leaf, batch, cell });
            continue;
          }
          // Far lists draw the last LOD whole. Near reentry must select from
          // today's distance rather than resume state from before that handover.
          resetCellFade(file, cell);
          // Records are largest first, so those still two pixels tall at this distance are the front of the cell.
          let n = cell.count;
          while (n > 0 && file.reach[cell.first + n - 1] < distance) n--;
          this.appendWaterVisible(distance > shadowReach ? batch.beyond : batch.far,
            batch, file.matrices, cell.first, n, eye);
        }
      });
    }
    for (const batch of this.batches) if (batch) { flush(batch.far); flush(batch.beyond); }
  }

  // Puts every record of the near cells into the level its distance calls for. A switch plays its
  // cross-fade over FADE_MS of real time and finishes: the old level draws [0, 1 - p), the new
  // [1 - p, 1), so exactly one of them shows at every pixel, and at rest every record draws whole
  // at one level with no dither anywhere. The switch outward happens at the switch distance, back
  // inward a FADE_GAP below it, so hovering on a boundary fades once instead of back and forth.
  private sortNear(eye: Vector3, now: number) {
    this.sortedAt = eye.clone();
    this.fading = false;
    for (const batch of this.batches) if (batch) for (const level of batch.levels) level.count = 0;
    for (const { leaf, batch, cell } of this.nearCells) {
      // Near lists re-sort after a quarter metre of motion; unlike far/mid
      // lists they need only that smaller safety margin around the volume.
      // A leaf released since the far lists were built is skipped until they are built again.
      if (!leaf.near) continue;
      if (this.waterHides(cell, eye, RESORT_METRES)) {
        resetCellFade(leaf.near, cell);
        continue;
      }
      const { matrices, reach, shown, fadeStart, goal } = leaf.near;
      const { lodDistances } = batch.species, last = batch.levels.length - 1;
      for (let i = cell.first; i < cell.first + cell.count; i++) {
        const o = i * 16;
        // Buried (felled, or taken out to be shaken) draws nothing; sorted again later it snaps in.
        if (matrices[o + 13] === BURIED_Y) { shown[i] = 255; continue; }
        if (this.waterHidesRecord(batch, matrices, o, eye, RESORT_METRES)) {
          // Reappearance selects the current LOD with full coverage, even if
          // this record was fading when it disappeared behind the volume.
          shown[i] = 255;
          fadeStart[i] = -1;
          continue;
        }
        const distance = Math.hypot(matrices[o + 12] - eye.x, matrices[o + 13] - eye.y, matrices[o + 14] - eye.z) / this.zoom;
        // Past its two-pixel reach a record belongs to the far mesh, which draws the last level whole.
        if (distance > reach[i]) { shown[i] = 255; continue; }
        const disp = shown[i];
        let target: number;
        if (this.fades && disp !== 255 && fadeStart[i] >= 0) {
          // A fade once begun plays out to the level it set off for, and only then is the distance
          // asked again: the camera is never quite still, and a record sitting on a switch distance
          // would otherwise start and cancel its fade every frame.
          target = goal[i];
        } else if (disp === 255) {
          target = 0;
          while (target < last && distance >= lodDistances[target]) target++;
        } else {
          target = disp;
          while (target < last && distance >= lodDistances[target]) target++;
          while (target > 0 && distance < lodDistances[target - 1] * (1 - FADE_GAP)) target--;
        }
        if (disp === 255 || target === disp || !this.fades) {
          // New here, or where it was drawn: whole, with no fade.
          shown[i] = target;
          fadeStart[i] = -1;
          append(batch.levels[target], matrices, i, 1);
        } else {
          if (fadeStart[i] < 0) {
            fadeStart[i] = now;
            goal[i] = target;
            if (now + FADE_MS > this.fadesUntil) this.fadesUntil = now + FADE_MS;
          }
          // The start is kept in single precision, so it can round to just after now.
          const p = Math.max(0, (now - fadeStart[i]) / FADE_MS);
          if (p >= 1) {
            shown[i] = target;
            fadeStart[i] = -1;
            append(batch.levels[target], matrices, i, 1);
            // The camera can reverse or teleport while this fade plays. Recheck
            // distance next frame before resting, even if no other fade is active;
            // otherwise a completed old goal can remain at the wrong LOD forever.
            this.fading = true;
          } else {
            this.fading = true;
            append(batch.levels[disp], matrices, i, 1, 0, 1 - p);
            append(batch.levels[target], matrices, i, 1, 1 - p, 1);
          }
        }
      }
    }
    for (const batch of this.batches) {
      if (!batch) continue;
      for (const level of batch.levels) {
        flush(level);
        // Past this the mesh draws this many instances: the fade buffer is grown to hold them if the
        // count outgrew the buffer made when the material compiled, then told the per-instance bounds.
        if (level.count > 0) {
          const fades = level.fades.subarray(0, level.count * 2);
          for (const fade of level.fade) fade.setThinInstanceFadeBoundsBuffer(level.mesh, fades);
        }
      }
    }
  }

  private waterHides(cell: Cell, eye: Vector3, slack = FAR_SLACK_METRES): boolean {
    // Lists can be reused through FAR_SLACK_METRES of camera travel. Expand
    // the volume by that amount so a discarded cell cannot become visible
    // before the next rebuild. This tests physical metres, independent of zoom.
    const radius = this.waterRadius + slack;
    return cell.minY > eye.y + radius || cell.maxY < eye.y - radius;
  }

  private waterHidesRecord(batch: Batch, matrices: Float32Array, offset: number, eye: Vector3,
    slack = FAR_SLACK_METRES): boolean {
    if (!Number.isFinite(this.waterRadius)) return false;
    // Babylon's raw bounds enclose all authored LODs about the placement
    // origin. Uniform scale and arbitrary tilt keep this height test conservative.
    const scale = Math.hypot(matrices[offset], matrices[offset + 1], matrices[offset + 2]);
    const extent = batch.boundsRadius * scale;
    return Math.abs(matrices[offset + 13] - eye.y) > this.waterRadius + slack + extent;
  }

  private appendWaterVisible(draw: Draw, batch: Batch, matrices: Float32Array,
    first: number, count: number, eye: Vector3) {
    // Keep the single bulk copy above water. Submerged, copy contiguous
    // surviving ranges without allocating a second placement buffer.
    if (!Number.isFinite(this.waterRadius)) { append(draw, matrices, first, count); return; }
    let start = first;
    const end = first + count;
    for (let i = first; i < end; i++) {
      if (!this.waterHidesRecord(batch, matrices, i * 16, eye)) continue;
      append(draw, matrices, start, i - start);
      start = i + 1;
    }
    append(draw, matrices, start, end - start);
  }

  // Finds the trees and rocks around the camera again: trunk colliders, the chopping grid, rock seats.
  private findNearby(eye: Vector3) {
    this.nearbyAt = eye.clone();
    this.trunks.clear();
    this.trees.clear();
    this.seats.clear();
    const trunks = new Map<Batch, number[]>();
    for (const { leaf, batch, cell } of this.nearCells) {
      const { kind } = batch.species;
      if (!leaf.near || (kind !== "tree" && kind !== "rock")) continue;
      const m = leaf.near.matrices;
      for (let i = cell.first; i < cell.first + cell.count; i++) {
        const o = i * 16, x = m[o + 12], z = m[o + 14];
        if (m[o + 13] === BURIED_Y || Math.hypot(x - eye.x, z - eye.z) > NEARBY_METRES) continue;
        if (kind === "tree") {
          this.trunks.add(x, z);
          this.trees.set(treeKey(x, z), { leaf, batch, index: i });
          if (!trunks.has(batch)) trunks.set(batch, []);
          for (let j = 0; j < 16; j++) trunks.get(batch)!.push(m[o + j]);
        } else this.addSeat(batch, m, o);
      }
    }
    for (const batch of this.batches) {
      if (!batch?.collider) continue;
      const matrices = trunks.get(batch) ?? BURIED.asArray();
      batch.collider.thinInstanceSetBuffer("matrix", new Float32Array(matrices), 16, false);
      batch.collider.physicsBody?.updateBodyInstances();
    }
  }

  // Records the top of a rock big enough to sit on but small enough to be one rock.
  private addSeat(batch: Batch, m: Float32Array, o: number) {
    // The placements are uniformly scaled, so any column of the matrix gives the scale.
    const scale = Math.hypot(m[o], m[o + 1], m[o + 2]);
    const radius = 0.5 * batch.seatWidth * scale;
    if (radius < MIN_SEAT_RADIUS || radius > MAX_SEAT_RADIUS) return;
    const x = m[o + 12], z = m[o + 14];
    // The top ignores the rock's tilt, which only lowers the edges the player does not sit on.
    const seat: RockSeat = { x, y: m[o + 13] + batch.seatTop * scale, z, radius };
    const key = `${Math.floor(x / SEAT_CELL)},${Math.floor(z / SEAT_CELL)}`;
    const cell = this.seats.get(key);
    if (cell) cell.push(seat);
    else this.seats.set(key, [seat]);
  }

  // The level meshes of a kind from fromLevel up, with the far, beyond and middle-band meshes (which draw the last level).
  meshes(kind: FloraKind, fromLevel = 0): Mesh[] {
    return this.batches.flatMap(batch => !batch || batch.species.kind !== kind ? []
      : [...batch.levels.slice(fromLevel), batch.far, batch.beyond, ...(batch.mid ? [batch.mid] : [])].map(draw => draw.mesh));
  }

  // Every rock seat whose centre is within radius of (x, z), found through the 4 m cell grid.
  seatsNear(x: number, z: number, radius: number): RockSeat[] {
    const r = Math.ceil(radius / SEAT_CELL);
    const cx = Math.floor(x / SEAT_CELL), cz = Math.floor(z / SEAT_CELL);
    const found: RockSeat[] = [];
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++)
        for (const seat of this.seats.get(`${cx + dx},${cz + dz}`) ?? [])
          if (Math.hypot(seat.x - x, seat.z - z) <= radius) found.push(seat);
    return found;
  }

  // The tree at (x, z) as a mesh of its own, taken out of its batch so it can be shaken or felled.
  nearModelAt(x: number, z: number): AbstractMesh | undefined {
    const key = treeKey(x, z);
    const standing = this.standing.get(key);
    if (standing) return standing.mesh;
    const tree = this.trees.get(key);
    if (!tree?.leaf.near) return undefined;
    const { matrices } = tree.leaf.near, o = tree.index * 16;
    const mesh = tree.batch.source.clone(`tree_${x}_${z}`);
    mesh.setEnabled(true);
    const scaling = new Vector3(), rotation = new Quaternion(), position = new Vector3();
    Matrix.FromArray(matrices, o).decompose(scaling, rotation, position);
    mesh.position = position;
    mesh.scaling = scaling;
    mesh.rotation = rotation.toEulerAngles();
    this.standing.set(key, { mesh, leaf: tree.leaf, index: tree.index, saved: matrices.slice(o, o + 16) });
    matrices.set(BURIED.asArray(), o);
    this.sortedAt = null;
    return mesh;
  }

  // Fells the tree at (x, z) for good: it stays out of its leaf's files however often they are loaded again.
  fellTree(x: number, z: number): { model: AbstractMesh | null } | null {
    const key = treeKey(x, z);
    const model = this.nearModelAt(x, z);
    const standing = this.standing.get(key);
    if (!model || !standing) return null;
    const { leaf, index } = standing;
    this.standing.delete(key);
    if (!this.felled.has(leaf.id)) this.felled.set(leaf.id, { indices: new Set(), xz: new Set() });
    const felled = this.felled.get(leaf.id)!, xz = leaf.near!.xz[index];
    felled.indices.add(index);
    felled.xz.add(xz);
    const inMid = leaf.mid?.xz.indexOf(xz) ?? -1;
    if (inMid >= 0) leaf.mid!.matrices.set(BURIED.asArray(), inMid * 16);
    // The trunk collider, chopping grid entry and seat list are found again without it.
    this.nearbyAt = null;
    return { model };
  }
}

// A cell outside the near sorter no longer owns a timed LOD transition. Reset
// only its record range, preserving fades/hysteresis in continuously near cells.
function resetCellFade(file: LeafFile, cell: Cell) {
  const end = cell.first + cell.count;
  file.shown.fill(255, cell.first, end);
  file.fadeStart.fill(-1, cell.first, end);
}

function rectDistance(info: GroundLeaf, x: number, z: number): number {
  const dx = Math.max(info.x - x, 0, x - (info.x + info.size));
  const dz = Math.max(info.z - z, 0, z - (info.z + info.size));
  return Math.hypot(dx, dz);
}

// Copies count matrices starting at record first into a draw's buffer, growing the buffer if it is
// full, with each record's dither interval beside it, two floats grown with the buffer. Records that
// never fade take the whole pattern.
function append(draw: Draw, matrices: Float32Array, first: number, count: number, lower = 0, upper = 1) {
  const at = draw.count * 16, length = count * 16;
  if (at + length > draw.buffer.length) {
    const grown = new Float32Array(Math.max(2 * draw.buffer.length, at + length, 1024));
    grown.set(draw.buffer.subarray(0, at));
    draw.buffer = grown;
    const fades = new Float32Array(grown.length / 8);
    fades.set(draw.fades.subarray(0, draw.count * 2));
    draw.fades = fades;
    draw.grown = true;
  }
  const from = first * 16;
  if (count > 8) draw.buffer.set(matrices.subarray(from, from + length), at);
  else for (let j = 0; j < length; j++) draw.buffer[at + j] = matrices[from + j];
  const fadeAt = draw.count * 2;
  for (let j = 0; j < count; j++) {
    draw.fades[fadeAt + j * 2] = lower;
    draw.fades[fadeAt + j * 2 + 1] = upper;
  }
  draw.count += count;
}

// Sends a draw's buffer to its mesh: the whole buffer if it grew, otherwise only the part in use.
function flush(draw: Draw) {
  const { mesh, count } = draw;
  if (draw.grown) {
    mesh.thinInstanceSetBuffer("matrix", draw.buffer, 16, false);
    draw.grown = false;
  } else if (count > 0) mesh.thinInstancePartialBufferUpdate("matrix", draw.buffer.subarray(0, count * 16), 0);
  mesh.thinInstanceCount = count;
  mesh.setEnabled(count > 0);
}

// Writes the world matrix of a record: scaled, turned by yaw about the up axis, then tilted so the up
// axis points along (tiltX, sqrt(1 - tiltX² - tiltZ²), tiltZ). The same arithmetic as the placement tool.
function writeMatrix(m: Float32Array, o: number, px: number, py: number, pz: number, scale: number, yaw: number, tiltX: number, tiltZ: number) {
  // Tilt: the shortest turn from the up axis to the tilted one. Yaw: a turn about the up axis.
  const up = Math.sqrt(Math.max(0, 1 - tiltX * tiltX - tiltZ * tiltZ));
  const norm = Math.hypot(tiltZ, tiltX, up + 1);
  const ax = tiltZ / norm, az = -tiltX / norm, aw = (up + 1) / norm;
  const by = Math.sin(yaw / 2), bw = Math.cos(yaw / 2);
  const x = aw * 0 + ax * bw - az * by, y = aw * by, z = az * bw + ax * by, w = aw * bw;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  m[o] = (1 - (yy + zz)) * scale;
  m[o + 1] = (xy + wz) * scale;
  m[o + 2] = (xz - wy) * scale;
  m[o + 3] = 0;
  m[o + 4] = (xy - wz) * scale;
  m[o + 5] = (1 - (xx + zz)) * scale;
  m[o + 6] = (yz + wx) * scale;
  m[o + 7] = 0;
  m[o + 8] = (xz + wy) * scale;
  m[o + 9] = (yz - wx) * scale;
  m[o + 10] = (1 - (xx + yy)) * scale;
  m[o + 11] = 0;
  m[o + 12] = px;
  m[o + 13] = py;
  m[o + 14] = pz;
  m[o + 15] = 1;
}

// Merges the parts of one level into a mesh in world space. The glTF loader mirrors what it loads, and
// Babylon's MergeMeshes puts the winding right only when it merges several meshes, so a level that is a
// single mesh is flipped here. That holds for alpha-tested cards too: they are drawn from both sides, but
// two-sided lighting takes the side from the winding, and an inside-out card is black in the sun and lit
// in the shade.
export function mergeLevel(parts: Mesh[]): Mesh {
  const merged = Mesh.MergeMeshes(parts, false, true, undefined, false, true)!;
  const [only] = parts;
  if (parts.length === 1 && only.getWorldMatrix().determinant() < 0) merged.flipFaces();
  return merged;
}

const containers = new Map<string, Promise<AssetContainer>>();

async function loadLevels(scene: Scene, species: ForestSpecies): Promise<Mesh[]> {
  if (!containers.has(species.modelUrl)) {
    containers.set(species.modelUrl, LoadAssetContainerAsync(species.modelUrl, scene).then(container => {
      container.addAllToScene();
      for (const mesh of container.meshes) mesh.setEnabled(mesh.name === "__root__");
      return container;
    }).catch(error => {
      containers.delete(species.modelUrl);
      throw error;
    }));
  }
  const container = await containers.get(species.modelUrl)!;
  const name = new RegExp(`^${species.id}_LOD(\\d+)`);
  const parts = new Map<number, Mesh[]>();
  for (const mesh of container.meshes) {
    const level = name.exec(mesh.name);
    const source = mesh instanceof InstancedMesh ? mesh.sourceMesh : mesh;
    if (!level || !(source instanceof Mesh) || source.getTotalVertices() === 0) continue;
    source.computeWorldMatrix(true);
    const k = Number(level[1]);
    parts.set(k, [...(parts.get(k) ?? []), source]);
  }
  const levels = [...parts.keys()].sort((a, b) => a - b).map(k => {
    const merged = mergeLevel(parts.get(k)!);
    merged.name = `${species.id}_LOD${k}`;
    merged.setEnabled(true);
    return merged;
  });
  if (levels.length === 0) throw new Error(`${species.modelUrl} has no meshes named ${species.id}_LOD<n>`);
  return levels;
}

function treeKey(x: number, z: number) {
  return `${x},${z}`;
}

// The fade plugin of every material a level mesh draws with: one GetOrCreate per material, so level
// meshes that share a material with each other or another species share its plugin, while each mesh
// keeps its own per-instance bounds.
function levelFade(mesh: Mesh): DitheredTileFadeMaterialPlugin[] {
  const material = mesh.material;
  const subMaterials = material instanceof MultiMaterial ? material.subMaterials : [material];
  const plugins: DitheredTileFadeMaterialPlugin[] = [];
  for (const sub of subMaterials) {
    // The models come from glTF, so every material is a PBR one, which the fade plugin supports.
    if (sub) plugins.push(DitheredTileFadeMaterialPlugin.GetOrCreate(sub as PBRMaterial));
  }
  return plugins;
}
