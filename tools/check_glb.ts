import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/loaders/glTF";
import { readFileSync } from "fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: bun tools/check_glb.ts <file.glb> [...]\nLoads each file with Babylon's own glTF loader and prints what the engine will see:\nmesh names, vertex and triangle counts, materials, and world-space bounds (+X east, +Y up, +Z north).");
  process.exit(1);
}
const engine = new NullEngine();
for (const file of files) {
  const scene = new Scene(engine);
  const data = readFileSync(file);
  const container = await LoadAssetContainerAsync(`data:model/gltf-binary;base64,${data.toString("base64")}`, scene, { pluginExtension: ".glb" });
  console.log(`${file}: ${container.meshes.length} meshes, ${container.materials.length} materials, ${container.textures.length} textures`);
  let vertices = 0, triangles = 0;
  for (const m of container.meshes) {
    if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue;
    m.computeWorldMatrix(true);
    m.refreshBoundingInfo();
    const b = m.getBoundingInfo().boundingBox, lo = b.minimumWorld, hi = b.maximumWorld;
    const f = (v: number) => v.toFixed(2);
    vertices += m.getTotalVertices();
    triangles += m.getTotalIndices() / 3;
    console.log(`  ${m.name}  verts=${m.getTotalVertices()} tris=${m.getTotalIndices() / 3} material=${m.material?.name ?? "-"} thinInstances=${m.thinInstanceCount}`
      + `  x[${f(lo.x)}, ${f(hi.x)}] y[${f(lo.y)}, ${f(hi.y)}] z[${f(lo.z)}, ${f(hi.z)}]`);
  }
  console.log(`  total verts=${vertices} tris=${triangles}`);
  scene.dispose();
}
process.exit(0);
