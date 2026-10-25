import { Scene } from "@babylonjs/core/scene";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Material } from "@babylonjs/core/Materials/material";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Tool } from "./rucksack";

const REST = new Vector3(0.28, -0.26, 0.6);
const SWING_SECONDS = 0.3;
const WIND_BACK = 0.6;
const HELD_RENDERING_GROUP = 2;

export class HeldItem {
  private items = new Map<Tool, TransformNode>();
  private tip: TransformNode;
  private current: TransformNode | null = null;
  private swingStart = -Infinity;
  private pulled = 0;
  private swingSign = 1;

  constructor(scene: Scene, camera: Camera) {
    const mat = (name: string, colour: Color3) => {
      const m = new StandardMaterial(`held_${name}`, scene);
      m.diffuseColor = colour;
      m.specularColor = new Color3(0.1, 0.1, 0.1);
      return m;
    };
    const wood = mat("wood", new Color3(0.45, 0.3, 0.18)), steel = mat("steel", new Color3(0.55, 0.57, 0.6));
    const dark = mat("dark", new Color3(0.08, 0.08, 0.09)), stone = mat("flint", new Color3(0.3, 0.29, 0.27));
    const paper = mat("paper", new Color3(0.6, 0.5, 0.33));
    const part = (root: TransformNode, mesh: Mesh, material: Material, position: Vector3, rotation = Vector3.Zero()) => {
      mesh.parent = root;
      mesh.material = material;
      mesh.position = position;
      mesh.rotation = rotation;
      mesh.renderingGroupId = HELD_RENDERING_GROUP;
      mesh.isPickable = false;
      return mesh;
    };
    const item = (tool: Tool, build: (root: TransformNode) => void) => {
      const root = new TransformNode(`held_${tool}`, scene);
      root.parent = camera;
      root.position = REST.clone();
      build(root);
      root.setEnabled(false);
      this.items.set(tool, root);
    };

    this.tip = new TransformNode("held_poleTip", scene);
    item("pole", root => {
      const rod = part(root, MeshBuilder.CreateCylinder("held_rod", { height: 1.6, diameterTop: 0.008, diameterBottom: 0.025, tessellation: 6 }, scene),
        dark, new Vector3(0, 0.45, 0.5), new Vector3(0.9, 0, 0));
      part(root, MeshBuilder.CreateCylinder("held_reel", { height: 0.03, diameter: 0.06 }, scene), steel,
        new Vector3(0, -0.02, 0.05), new Vector3(0, 0, Math.PI / 2));
      this.tip.parent = rod;
      this.tip.position.y = 0.8;
    });
    item("flint", root => {
      part(root, MeshBuilder.CreateBox("held_flint", { width: 0.06, height: 0.035, depth: 0.045 }, scene), stone, new Vector3(-0.04, 0, 0));
      part(root, MeshBuilder.CreateBox("held_steel", { width: 0.08, height: 0.012, depth: 0.03 }, scene), steel, new Vector3(0.05, 0.01, 0.02));
    });
    item("axe", root => {
      root.rotation.y = -0.5;
      part(root, MeshBuilder.CreateCylinder("held_axeHandle", { height: 0.55, diameter: 0.035 }, scene), wood,
        new Vector3(0, 0.12, 0.05), new Vector3(0.35, 0, 0));
      part(root, MeshBuilder.CreateBox("held_axePoll", { width: 0.04, height: 0.06, depth: 0.06 }, scene), steel,
        new Vector3(0, 0.378, 0.145), new Vector3(0.35, 0, 0));
      part(root, MeshBuilder.CreateBox("held_axeBit", { width: 0.012, height: 0.13, depth: 0.1 }, scene), steel,
        new Vector3(0, 0.354, 0.211), new Vector3(0.35, 0, 0));
    });
    item("rations", root => {
      part(root, MeshBuilder.CreateBox("held_ration", { width: 0.12, height: 0.03, depth: 0.07 }, scene), paper,
        Vector3.Zero(), new Vector3(0.3, 0.4, 0));
    });
    item("flashlight", root => {
      part(root, MeshBuilder.CreateCylinder("held_torchBody", { height: 0.2, diameter: 0.04 }, scene), dark,
        new Vector3(0, 0, 0.05), new Vector3(Math.PI / 2, 0, 0));
      part(root, MeshBuilder.CreateCylinder("held_torchHead", { height: 0.04, diameter: 0.055 }, scene), steel,
        new Vector3(0, 0, 0.16), new Vector3(Math.PI / 2, 0, 0));
    });

    scene.onBeforeRenderObservable.add(() => this.animate());
  }

  show(tool: Tool | null) {
    this.current?.setEnabled(false);
    this.current = tool ? this.items.get(tool)! : null;
    this.current?.setEnabled(true);
  }

  pull(amount: number) {
    this.pulled = amount;
  }

  swing(lift = false) {
    this.swingStart = performance.now() / 1000;
    this.swingSign = lift ? -1 : 1;
  }

  tipPosition(): Vector3 {
    return this.tip.computeWorldMatrix(true).getTranslation();
  }

  private animate() {
    if (!this.current) return;
    const t = (performance.now() / 1000 - this.swingStart) / SWING_SECONDS;
    this.current.rotation.x = t >= 0 && t < 1 ? this.swingSign * Math.sin(t * Math.PI) * 0.8 : -WIND_BACK * this.pulled;
  }
}
