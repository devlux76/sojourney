import * as B from "@babylonjs/core";

// InputBlock.Parse resolves serialized vector/colour values through Babylon's
// registry. Explicit registration survives Vite's removal of unused side effects.
B.RegisterMathVector();
B.RegisterMathColor();

// Vite deliberately ignores tools/ in its watcher. Fetch exports afresh so MCP
// edits are visible after a reload instead of reusing a cached JSON module.
const normalBake = await (await fetch("/tools/materials/terrain-relief/normalBake.json", { cache: "no-store" })).json();

// This authoring harness renders Babylon's HeightToNormalBlock into an asset. It is
// separate from the game: the shipped material samples the baked map, never its height.
const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const status = document.querySelector<HTMLElement>("#status")!;
const download = document.querySelector<HTMLButtonElement>("#download")!;
const gpu = new URLSearchParams(location.search).get("backend") === "webgpu";
const engine = gpu ? new B.WebGPUEngine(canvas, { antialias: false })
  : new B.Engine(canvas, false, { preserveDrawingBuffer: true });
if (engine instanceof B.WebGPUEngine) await engine.initAsync();
engine.setSize(512, 512);
const scene = new B.Scene(engine);
scene.clearColor = new B.Color4(0, 0, 0, 1);
const camera = new B.FreeCamera("bakeCamera", new B.Vector3(32, 10, 32), scene);
camera.upVector.set(0, 0, 1);
camera.setTarget(new B.Vector3(32, 0, 32));
camera.mode = B.Camera.ORTHOGRAPHIC_CAMERA;
camera.orthoLeft = camera.orthoBottom = -32;
camera.orthoRight = camera.orthoTop = 32;
const plane = B.CreatePlane("64-metre authoring tile", { size: 64 }, scene);
plane.rotation.x = Math.PI / 2;
plane.position.set(32, 0, 32);
const material = B.NodeMaterial.Parse(normalBake, scene);
material.backFaceCulling = false;
const source = material.getBlockByName("macroHeightSource");
if (!(source instanceof B.ImageSourceBlock)) throw new Error("NME graph lost its height image input");
if (!source.texture) throw new Error("NME export has no embedded height texture; run the relief prepare step");
source.texture.gammaSpace = false;
// Keep the narrowed block type in the asynchronous authoring checks below.
const heightSource: B.ImageSourceBlock = source;
plane.material = material;
async function checkNormalDirections() {
  const original = heightSource.texture;
  const results: { axis: string; rgb: number[] }[] = [];
  try {
    // TriPlanar's +Y projection uses world ZX for UV. A height ramp in texture V
    // therefore slopes along world X; texture U slopes along world Z. Read actual
    // GPU output rather than assuming the bake's green-channel orientation.
    for (const axis of ["x", "z"]) {
      const bytes = new Uint8Array(64 * 64 * 4);
      for (let row = 0; row < 64; row++) for (let col = 0; col < 64; col++) {
        const offset = (row * 64 + col) * 4;
        const height = Math.round(32 + 192 * (axis === "x" ? row : col) / 63);
        bytes[offset] = bytes[offset + 1] = bytes[offset + 2] = height;
        bytes[offset + 3] = 255;
      }
      const ramp = B.RawTexture.CreateRGBATexture(bytes, 64, 64, scene, false, false, B.Texture.BILINEAR_SAMPLINGMODE);
      ramp.gammaSpace = false;
      heightSource.texture = ramp;
      for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame);
      const pixels = await engine.readPixels(256, 256, 1, 1);
      const rgb = Array.from(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)).slice(0, 3);
      const slopingChannel = axis === "x" ? 0 : 1;
      if (rgb[slopingChannel] >= 126 || Math.abs(rgb[1 - slopingChannel] - 128) > 2 || rgb[2] < 250) {
        throw new Error(`NME ${axis}-ramp normal points the wrong way: ${rgb.join(", ")}`);
      }
      results.push({ axis, rgb });
      ramp.dispose();
    }
  } finally {
    heightSource.texture = original;
  }
  return results;
}
Object.assign(window, { reliefBake: { engine, scene, material, canvas, checkNormalDirections } });
let frames = 0;
engine.runRenderLoop(() => {
  scene.render();
  if (scene.isReady() && ++frames === 30) {
    status.textContent = `NME normal bake ready (${gpu ? "WebGPU" : "WebGL"}, 512 × 512, 64 metres)`;
    download.disabled = false;
  }
});
download.onclick = () => {
  const link = document.createElement("a");
  link.download = "terrain_relief_normal.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
};
// CDP reads this small authoring interface to save pixels and inspect the compiled
// backend. Keeping the render loop alive lets WebGPU finish its asynchronous pipeline.
