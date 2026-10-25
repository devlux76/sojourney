import "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";
import wasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

export const GRAVITY = 9.81;

let instance: ReturnType<typeof HavokPhysics> | null = null;

export async function enablePhysics(scene: Scene): Promise<void> {
  instance ??= HavokPhysics({ locateFile: () => wasmUrl });
  const havok = await instance;
  scene.enablePhysics(new Vector3(0, -GRAVITY, 0), new HavokPlugin(true, havok));
}
