import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { GroundNormalTiles, type GroundNormalTextureFactory } from "../src/engine/groundNormalTiles";
import type { GroundNormalTile } from "../src/engine/pack";

// Lifecycle tests for the regional normal/AO tile manager. The injectable factory drives native
// texture loads without a GPU: each factory call captures its onLoad/onError for the test to fire.
interface LoadCall {
  url: string;
  onLoad: () => void;
  onError: (message?: string) => void;
}

interface Harness {
  manager: GroundNormalTiles;
  calls: LoadCall[];
  disposed: boolean[];
  events: string[];
  applied: { mesh: Mesh; texture: Texture | null; bounds?: [number, number, number, number] }[];
  fireSceneDispose: () => void;
  mesh: (name: string) => Mesh;
}

const TILES: GroundNormalTile[] = [
  { url: "tiles/normal_0.ktx2", bounds: [-5000, -5000, 1088, 1088] },
];

function harness(tiles: GroundNormalTile[] = TILES, anisotropy = 8, mode: "capture" | "sync" | "throw" = "capture"): Harness {
  const calls: LoadCall[] = [];
  const disposed: boolean[] = [];
  const events: string[] = [];
  const applied: Harness["applied"] = [];
  let sceneDispose = () => {};
  const factory: GroundNormalTextureFactory = (url, onLoad, onError) => {
    if (mode === "throw") throw new Error("no GPU here");
    const index = disposed.length;
    disposed.push(false);
    calls.push({ url, onLoad, onError });
    const texture = {
      dispose() {
        disposed[index] = true;
        events.push(`dispose:${index}`);
      },
    };
    // A factory that reports synchronously, inside the creation call itself.
    if (mode === "sync") onLoad();
    return texture;
  };
  const scene = {
    onDisposeObservable: { addOnce(fn: () => void) { sceneDispose = fn; } },
  } as unknown as Scene;
  const manager = new GroundNormalTiles(
    scene,
    tiles,
    (mesh, texture, bounds) => {
      events.push(`apply:${(mesh as unknown as { tag: string }).tag}:${texture ? "tile" : "null"}`);
      applied.push({ mesh, texture, bounds });
    },
    anisotropy,
    factory,
  );
  return {
    manager, calls, disposed, events, applied,
    fireSceneDispose: () => sceneDispose(),
    mesh: (name: string) => ({ tag: name }) as unknown as Mesh,
  };
}

let warned: string[] = [];
const realWarn = console.warn;
beforeEach(() => {
  warned = [];
  console.warn = (...args: unknown[]) => { warned.push(args.map(String).join(" ")); };
});
afterEach(() => { console.warn = realWarn; });

describe("GroundNormalTiles lifecycle", () => {
  test("dedupes concurrent loads and applies the ready tile to bound meshes", async () => {
    const h = harness();
    const mesh = h.mesh("far2");
    const first = h.manager.load(0);
    const second = h.manager.load(0);
    // The same in-flight promise is shared before the native load even starts.
    expect(second).toBe(first);
    await Promise.resolve();
    expect(h.calls.length).toBe(1);
    expect(h.calls[0].url).toBe(TILES[0].url);
    expect(h.manager.stats()).toEqual({ resident: 0, pending: 1 });
    // Bound before the tile lands: the mesh holds the distant fallback meanwhile.
    h.manager.bind(0, mesh);
    expect(h.applied.length).toBe(1);
    expect(h.applied[0].texture).toBeNull();
    h.calls[0].onLoad();
    await Promise.all([first, second]);
    expect(h.manager.stats()).toEqual({ resident: 1, pending: 0 });
    // The landing repaints every mesh bound meanwhile, with the tile's padded bounds.
    const painted = h.applied.filter(a => a.texture !== null);
    expect(painted.length).toBe(1);
    expect(painted[0].mesh).toBe(mesh);
    expect(painted[0].bounds).toEqual(TILES[0].bounds);
    // A mesh bound after readiness gets the tile at once.
    const late = h.mesh("near0");
    h.manager.bind(0, late);
    const latePainted = h.applied.filter(a => a.mesh === late);
    expect(latePainted.length).toBe(1);
    expect(latePainted[0].texture).not.toBeNull();
  });

  test("a late landing after release never republishes the disposed tile", async () => {
    const h = harness();
    const mesh = h.mesh("far2");
    const waiting = h.manager.load(0);
    await Promise.resolve();
    h.manager.bind(0, mesh);
    h.manager.release(0);
    // Release wakes the waiter on the fallback instead of hanging it on a tile that never lands.
    await waiting;
    expect(h.manager.stats()).toEqual({ resident: 0, pending: 0 });
    // The orphan landing drops its texture instead of publishing it to the unbound mesh.
    h.calls[0].onLoad();
    expect(h.applied.filter(a => a.texture !== null).length).toBe(0);
    expect(h.disposed[0]).toBe(true);
    // A fresh load starts a new texture; the first load's landing must not paint it either.
    const retry = h.manager.load(0);
    await Promise.resolve();
    expect(h.calls.length).toBe(2);
    h.manager.bind(0, mesh);
    h.calls[0].onLoad();
    expect(h.manager.stats()).toEqual({ resident: 0, pending: 1 });
    expect(h.applied.filter(a => a.texture !== null).length).toBe(0);
    h.calls[1].onLoad();
    await retry;
    expect(h.manager.stats()).toEqual({ resident: 1, pending: 0 });
    expect(h.applied.filter(a => a.texture !== null).length).toBe(1);
  });

  test("a failed tile warns and leaves the distant fallback without rejecting", async () => {
    const h = harness();
    const mesh = h.mesh("far2");
    h.manager.bind(0, mesh);
    const waiting = h.manager.load(0);
    await Promise.resolve();
    h.calls[0].onError("boom");
    // Gameplay never rejects on a tile failure.
    await waiting;
    expect(warned.join("\n")).toMatch(/ground normal tile 0.*boom/);
    expect(h.applied.filter(a => a.texture !== null).length).toBe(0);
    expect(h.manager.stats()).toEqual({ resident: 0, pending: 0 });
    // Retry after failure starts a new load rather than caching the miss.
    const retry = h.manager.load(0);
    await Promise.resolve();
    expect(h.calls.length).toBe(2);
    h.calls[1].onLoad();
    await retry;
    expect(h.manager.stats()).toEqual({ resident: 1, pending: 0 });
  });

  test("release clears bound overrides before disposing the texture", async () => {
    const h = harness();
    const first = h.mesh("far2");
    const second = h.mesh("far3");
    const waiting = h.manager.load(0);
    await Promise.resolve();
    h.calls[0].onLoad();
    await waiting;
    h.manager.bind(0, first);
    h.manager.bind(0, second);
    h.events.length = 0;
    h.manager.release(0);
    // No mesh keeps pointing at the texture past its disposal.
    expect(h.events).toEqual(["apply:far2:null", "apply:far3:null", "dispose:0"]);
    expect(h.manager.stats()).toEqual({ resident: 0, pending: 0 });
  });

  test("leaves without tiles resolve at once on the fallback", async () => {
    const h = harness();
    const mesh = h.mesh("block");
    await h.manager.load(7);
    expect(h.calls.length).toBe(0);
    h.manager.bind(7, mesh);
    expect(h.applied.length).toBe(1);
    expect(h.applied[0].texture).toBeNull();
    h.manager.release(7);
    expect(h.manager.stats()).toEqual({ resident: 0, pending: 0 });
  });

  test("a synchronous factory callback still lands exactly once", async () => {
    const h = harness(TILES, 8, "sync");
    const mesh = h.mesh("far2");
    h.manager.bind(0, mesh);
    // The callback fires inside the factory call, before the texture is stored: the manager
    // re-queues it instead of settling into a fake pending state.
    await h.manager.load(0);
    expect(h.calls.length).toBe(1);
    expect(h.manager.stats()).toEqual({ resident: 1, pending: 0 });
    const painted = h.applied.filter(a => a.texture !== null);
    expect(painted.length).toBe(1);
    expect(painted[0].bounds).toEqual(TILES[0].bounds);
  });

  test("a throwing factory resolves the fallback with nothing pending", async () => {
    const h = harness(TILES, 8, "throw");
    await h.manager.load(0);
    expect(warned.join("\n")).toMatch(/ground normal tile 0.*no GPU here/);
    expect(h.manager.stats()).toEqual({ resident: 0, pending: 0 });
    expect(h.applied.filter(a => a.texture !== null).length).toBe(0);
  });

  test("release before the native start never creates the texture", async () => {
    const h = harness();
    const waiting = h.manager.load(0);
    h.manager.release(0);
    await waiting;
    await Promise.resolve();
    expect(h.calls.length).toBe(0);
    expect(h.manager.stats()).toEqual({ resident: 0, pending: 0 });
  });

  test("scene disposal releases everything and stops further loads", async () => {
    const h = harness();
    const mesh = h.mesh("far2");
    const waiting = h.manager.load(0);
    await Promise.resolve();
    h.calls[0].onLoad();
    await waiting;
    h.manager.bind(0, mesh);
    h.fireSceneDispose();
    expect(h.events).toEqual(expect.arrayContaining(["apply:far2:null", "dispose:0"]));
    expect(h.events.indexOf("apply:far2:null")).toBeLessThan(h.events.indexOf("dispose:0"));
    expect(h.manager.stats()).toEqual({ resident: 0, pending: 0 });
    await h.manager.load(0);
    expect(h.calls.length).toBe(1);
  });
});
