import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Observable } from "@babylonjs/core/Misc/observable";
import { NodeMaterial } from "@babylonjs/core/Materials/Node/nodeMaterial";
import { InputBlock } from "@babylonjs/core/Materials/Node/Blocks/Input/inputBlock";
import { TextureBlock } from "@babylonjs/core/Materials/Node/Blocks/Dual/textureBlock";
import { settings } from "../../core/Settings";
import type { SettingControl } from "../../core/SettingsPanel";
import { skyLayer } from "./NightSky";
import { SKY_RADIUS, type SkyState } from "./sky";
import moonJson from "./moonMaterial.json";

const MOON_DISTANCE = SKY_RADIUS * 0.96;
const REAL_HALF_SIZE = MOON_DISTANCE * Math.tan((0.26 * Math.PI) / 180);
// Must match the baked `quad` input in MoonMaterial: the graph scales the [-1, 1] quad by this,
// and the halfSize uniform is in the same units.
const QUAD_SCALE = 5;

// The moon is a node material (MoonMaterial, authored in the Node Material Editor) rather than a
// hand-written shader. The graph is linear dataflow with an unconditional moonMap sample at
// explicit lod 0, so it can never trip WGSL's "textureSample must only be called from uniform
// control flow" rule the way the old branched hand shader did (caught 2026-10-06 on the real
// GPU; SwiftShader never enforced it). One graph serves both backends: NodeMaterial compiles it
// to WGSL under WebGPU and GLSL under WebGL.
export class Moon {
  readonly mesh: Mesh;

  constructor(scene: Scene, onSky: Observable<SkyState>) {
    const mesh = new Mesh("moon", scene);
    const data = new VertexData();
    data.positions = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
    data.indices = [0, 1, 2, 0, 2, 3];
    data.applyToMesh(mesh);
    const mat = NodeMaterial.Parse(moonJson, scene);
    const input = (name: string): InputBlock => {
      const block = mat.getBlockByName(name);
      if (!(block instanceof InputBlock)) throw new Error(`MoonMaterial has no InputBlock ${name}`);
      return block;
    };
    const moonDir = input("moonDir"), right = input("rightU"), up = input("upU"), sunDir = input("sunDir");
    const visibility = input("visibility"), darkness = input("darkness"), halfSize = input("halfSize");
    const moonMap = mat.getBlockByName("moonTex");
    if (!(moonMap instanceof TextureBlock)) throw new Error("MoonMaterial has no TextureBlock moonTex");
    moonMap.texture = new Texture(`${import.meta.env.BASE_URL}sky/moon.jpg`, scene);
    this.mesh = skyLayer(mesh, mat, 2, Constants.ALPHA_PREMULTIPLIED);

    const rightV = new Vector3(), upV = new Vector3();
    onSky.add((s: SkyState) => {
      mesh.setEnabled(s.moon.alt > -1);
      const reference = Math.abs(s.moonDir.y) > 0.999 ? Vector3.Forward() : Vector3.Up();
      Vector3.CrossToRef(reference, s.moonDir, rightV);
      rightV.normalize();
      Vector3.CrossToRef(s.moonDir, rightV, upV);
      moonDir.value = s.moonDir;
      right.value = rightV;
      up.value = upV;
      sunDir.value = s.sunDir;
      visibility.value = (1 - s.weather.cloudCover) / s.exposure;
      darkness.value = s.darkness;
      halfSize.value = REAL_HALF_SIZE * settings.moonScale * QUAD_SCALE;
    });
  }

  settingControls(): SettingControl[] {
    return [{ key: "moonScale", label: "Moon size (× real)", min: 1, max: 12, step: 0.1 }];
  }
}
