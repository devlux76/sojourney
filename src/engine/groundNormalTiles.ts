import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { GroundDetailResources } from "./groundStream";
import type { GroundNormalTile } from "./pack";

// How a ready regional tile reaches a mesh: the material plugin (which owns the hardBind) swaps
// the tile in for that mesh, or back to the distant fallback on null. bounds is the tile's padded
// world rectangle (west, south, width, height in metres); null carries no bounds.
export type GroundNormalApply = (mesh: Mesh, texture: Texture | null, bounds?: [number, number, number, number]) => void;

// The smallest surface the manager needs: stock Babylon Textures satisfy this, and tests inject
// fakes through the factory below.
export interface GroundNormalTexture {
  dispose(): void;
}

// Builds the texture for a tile url, telling onLoad when the native load lands and onError when it
// fails. The default builds a stock Babylon Texture (linear KTX2 data: clamped, trilinear, full
// mip chain, caller-passed anisotropy); the parameter exists solely so lifecycle tests can drive
// loads without a GPU.
export type GroundNormalTextureFactory = (
  url: string,
  onLoad: () => void,
  onError: (message?: string, exception?: unknown) => void,
) => GroundNormalTexture;

interface TileRecord {
  // Bumped on every release: a native callback holding an older generation is late and must not
  // publish. Compared together with the record's identity in the map, so a load started, released
  // and started again cannot be repainted by the first load's landing.
  generation: number;
  texture: Texture | null;
  ready: boolean;
  // The in-flight load shared by concurrent callers; settling it wakes them without publishing.
  promise: Promise<void> | null;
  settle: (() => void) | null;
  meshes: Set<Mesh>;
}

// Pages the normal/AO region referenced by each ground leaf (tiles[leaf id]) and applies ready tiles to the
// meshes bound to their leaf. No custom decoder, no runtime baking or downscaling, no per-tile
// material and no performance settings: a tile is either ready and applied, or the mesh keeps the
// distant fallback it already has. A failed tile warns and leaves that fallback; it never rejects
// gameplay. Releasing a leaf returns every bound mesh to the fallback BEFORE the texture is
// disposed, and a scene disposal releases everything.
export class GroundNormalTiles implements GroundDetailResources {
  private records = new Map<number, TileRecord>();
  private sceneGone = false;

  constructor(
    private scene: Scene,
    private tiles: GroundNormalTile[],
    private apply: GroundNormalApply,
    private anisotropy: number,
    private createTexture?: GroundNormalTextureFactory,
  ) {
    // A scene disposal releases everything: every bound override is cleared before its texture
    // goes, exactly as release() does per leaf.
    scene.onDisposeObservable.addOnce(() => {
      this.sceneGone = true;
      for (const id of [...this.records.keys()]) this.release(id);
    });
  }

  load(leafId: number): Promise<void> {
    const tile = this.tiles[leafId];
    // Packs without this leaf's tile, and a gone scene, behave exactly as before: fallback, at once.
    if (!tile || this.sceneGone) return Promise.resolve();
    const record = this.recordFor(leafId);
    if (record.ready) return Promise.resolve();
    // Concurrent callers share the in-flight load: one texture per leaf, however many asked.
    if (record.promise) return record.promise;
    const generation = record.generation;
    const { url, bounds } = tile;
    let resolveLoad!: () => void;
    record.promise = new Promise<void>(resolve => { resolveLoad = resolve; });
    // Waking the waiters without publishing: release() settles here, so a caller awaiting this
    // load returns on the fallback instead of hanging on a tile that will never land.
    record.settle = () => {
      if (this.records.get(leafId) === record) {
        record.promise = null;
        record.settle = null;
      }
      resolveLoad();
    };
    const promise = record.promise;
    // The native load starts a tick later: a factory that calls its callbacks synchronously (or
    // throws) then lands after record.promise exists, so settling cannot be overwritten back into
    // a fake pending state.
    queueMicrotask(() => {
      // Released before the start: never create the orphan.
      if (this.records.get(leafId) !== record || record.generation !== generation) return;
      const done = () => {
        if (this.records.get(leafId) === record) {
          record.promise = null;
          record.settle = null;
        }
        resolveLoad();
      };
      const live = (): boolean => this.records.get(leafId) === record && record.generation === generation;
      // A callback that fires before the factory returned (a synchronous factory) is re-queued:
      // by the re-run the texture is stored below and the handler sees it.
      let stored = false;
      const whenStored = (run: () => void): void => {
        if (stored) run();
        else queueMicrotask(() => whenStored(run));
      };
      const onLoad = () => whenStored(() => {
        // Stale (released meanwhile): the release already disposed this record's only texture and
        // cleared its meshes, so there is nothing to publish and nothing left to dispose.
        if (!live()) {
          done();
          return;
        }
        // Ready on the native onLoad: apply to every mesh bound meanwhile.
        record.ready = true;
        const texture = record.texture;
        if (texture) for (const mesh of record.meshes) this.apply(mesh, texture, bounds);
        done();
      });
      const onError = (message?: string) => whenStored(() => {
        console.warn(`ground normal tile ${leafId} (${url}) failed to load, keeping distant fallback${message ? `: ${message}` : ""}`);
        // A failed load leaves no texture behind: drop what the factory handed back.
        const texture = record.texture;
        record.texture = null;
        if (texture && live()) {
          try { (texture as GroundNormalTexture).dispose(); } catch { /* already gone with the scene */ }
        }
        done();
      });
      try {
        const texture = (this.createTexture ?? ((item, loaded, failed) => this.stockTexture(item, loaded, failed)))(url, onLoad, onError);
        // Stored immediately, long before ready: release() can dispose (and cancel) an in-flight
        // texture, while stats() still gates residency on ready.
        if (live()) record.texture = texture as Texture;
        else {
          try { texture.dispose(); } catch { /* already gone with the scene */ }
          done();
          return;
        }
        stored = true;
      } catch (error) {
        stored = true;
        console.warn(`ground normal tile ${leafId} (${url}) failed to load, keeping distant fallback: ${String(error)}`);
        done();
      }
    });
    return promise;
  }

  // The record for a leaf, created on first use. At most one texture ever lives on a record:
  // release() deletes it, so a later load starts a new record no stale callback can touch.
  private recordFor(leafId: number): TileRecord {
    let record = this.records.get(leafId);
    if (!record) {
      record = { generation: 0, texture: null, ready: false, promise: null, settle: null, meshes: new Set() };
      this.records.set(leafId, record);
    }
    return record;
  }

  bind(leafId: number, mesh: Mesh): void {
    const tile = this.tiles[leafId];
    // No tile for this leaf (or scene gone): the mesh keeps the distant fallback it already has.
    if (!tile || this.sceneGone) {
      if (!tile) this.apply(mesh, null);
      return;
    }
    const record = this.recordFor(leafId);
    record.meshes.add(mesh);
    // Apply what is ready now, or the fallback: a later onLoad repaints every bound mesh.
    if (record.ready && record.texture) this.apply(mesh, record.texture, tile.bounds);
    else this.apply(mesh, null);
  }

  release(leafId: number): void {
    const record = this.records.get(leafId);
    if (!record) return;
    // Retire this generation first: a landing native callback finds a stale record and drops its
    // orphan instead of publishing. Cancel the deferred wait so load() callers wake on fallback.
    record.generation++;
    record.settle?.();
    record.promise = null;
    record.settle = null;
    const meshes = [...record.meshes];
    record.meshes.clear();
    record.ready = false;
    const texture = record.texture;
    record.texture = null;
    this.records.delete(leafId);
    // Clear every bound override BEFORE disposing the texture: no mesh keeps pointing at it.
    for (const mesh of meshes) this.apply(mesh, null);
    if (texture) {
      try { (texture as GroundNormalTexture).dispose(); } catch { /* already gone with the scene */ }
    }
  }

  // How many tiles are resident and ready, and how many loads are still in flight.
  stats(): { resident: number; pending: number } {
    let resident = 0, pending = 0;
    for (const record of this.records.values()) {
      if (record.ready && record.texture) resident++;
      if (record.promise) pending++;
    }
    return { resident, pending };
  }

  // The stock texture for linear KTX2 tile data: clamped, trilinear with full mip chain, at the
  // caller-passed anisotropy. Ready is reported on the native onLoad.
  private stockTexture(url: string, onLoad: () => void, onError: (message?: string, exception?: unknown) => void): Texture {
    const texture = new Texture(url, this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE, onLoad, onError);
    texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = this.anisotropy;
    texture.gammaSpace = false;
    return texture;
  }
}
