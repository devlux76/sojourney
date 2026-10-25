import { NodeMaterial, Color3, Vector3, InputBlock, ShaderLanguage, RegisterMathColor, RegisterMathVector, type Scene, type DirectionalLight } from "@babylonjs/core";
import { Atmosphere } from "@babylonjs/addons";
import { AtmospherePBRMaterialPlugin } from "@babylonjs/addons/atmosphere/atmospherePBRMaterialPlugin";
import graph from "../tools/materials/play-pbr/pilot.json";

export interface PilotOptions {
  colour?: Color3;
  metallic?: number;
  roughness?: number;
  attachAtmosphere?: boolean;
  bindSkyIrradiance?: boolean;
}

// This authoring-only material tests the native NME PBR graph against the world's
// stock PBR materials. Defaults belong here; the caller need only select variants.
export class PlayPbrPilot extends NodeMaterial {
  readonly atmospherePlugin: AtmospherePBRMaterialPlugin | null;

  constructor(name: string, scene: Scene, {
    colour = new Color3(0.45, 0.3, 0.18), metallic = 0, roughness = 0.85,
    attachAtmosphere = true, bindSkyIrradiance = true,
  }: PilotOptions = {}) {
    super(name, scene, { shaderLanguage: scene.getEngine().isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL });
    RegisterMathColor();
    RegisterMathVector();
    this.loadFromSerialization(graph);
    this.name = name;
    (this.getBlockByName("baseColor") as InputBlock).value = colour.clone();
    (this.getBlockByName("metallic") as InputBlock).value = metallic;
    (this.getBlockByName("roughness") as InputBlock).value = roughness;
    // Explicitly try the addon attachment instead of assuming its automatic
    // PBRMaterial factory rule establishes NodeMaterial compatibility.
    const atmosphere = scene.getExternalData<Atmosphere>("atmosphere");
    this.atmospherePlugin = attachAtmosphere && atmosphere
      ? new AtmospherePBRMaterialPlugin(this, atmosphere, atmosphere.depthTexture === null)
      : null;
    if (bindSkyIrradiance && atmosphere) {
      const sky = this.getBlockByName("skyAmbient") as InputBlock;
      const skyColour = new Color3();
      const global = new Vector3(), normal = new Vector3(), direction = new Vector3();
      // First manual-wiring experiment: query Babylon's existing irradiance LUT API
      // at the mesh position. This uniform ambient fill tests the missing sky term;
      // it does not claim per-normal irradiance or aerial-perspective equivalence.
      this.onBindObservable.add(mesh => {
        const sun = scene.getLightByName("sun") as DirectionalLight | null;
        if (!sun) return;
        mesh.getAbsolutePosition().scaleToRef(0.001, global);
        global.y += atmosphere.physicalProperties.planetRadius;
        const radius = global.length();
        global.scaleToRef(1 / radius, normal);
        sun.direction.scaleToRef(-1, direction);
        atmosphere.getDiffuseSkyIrradianceToRef(direction, radius, normal, sun.getScaledIntensity(), skyColour);
        // The native query already includes additional sky irradiance and its intensity.
        // NME's ambient input is multiplied by scene.ambientColor; undo that factor
        // when supplying the computed linear sky contribution, with the diffuse BRDF.
        skyColour.r /= Math.PI * Math.max(0.00001, scene.ambientColor.r);
        skyColour.g /= Math.PI * Math.max(0.00001, scene.ambientColor.g);
        skyColour.b /= Math.PI * Math.max(0.00001, scene.ambientColor.b);
        sky.value = skyColour;
      });
    }
    this.build();
  }
}
