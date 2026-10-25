import { MaterialPluginBase, PBRBaseMaterial, PBRMaterial, ShaderLanguage } from "@babylonjs/core";
import type { BaseTexture, Scene, UniformBuffer } from "@babylonjs/core";
import { DAYLIGHT_DEPTH_METRES } from "./lake";
import { WATER_Y } from "./pack";

// Extend the bed's lighting contract to ordinary PBR assets through Babylon's
// native hooks. NME cannot inject its graph into stock atmosphere-lit PBR shaders.
export class WaterDepthMaterialPlugin extends MaterialPluginBase {
  constructor(material: PBRBaseMaterial, private lakeMask: BaseTexture, private sizeMetres: number) {
    // Atmosphere (600) supplies the sunlight first; water then attenuates it.
    super(material, "WaterDepth", 700);
    // The world's material observer installs this on clones with the shared mask;
    // serializing a scene-owned texture into every cloned material would duplicate it.
    this.doNotSerialize = true;
    this._enable(true);
  }

  override getClassName() { return "WaterDepthMaterialPlugin"; }
  override isCompatible() { return true; }
  override isReadyForSubMesh() { return this.lakeMask.isReady(); }
  override getSamplers(samplers: string[]) { samplers.push("objectLakeMask"); }
  override getActiveTextures(textures: BaseTexture[]) { textures.push(this.lakeMask); }
  override hasTexture(texture: BaseTexture) { return texture === this.lakeMask; }
  override bindForSubMesh(ubo: UniformBuffer) { ubo.setTexture("objectLakeMask", this.lakeMask); }

  override getCustomCode(shaderType: string, language?: ShaderLanguage) {
    if (shaderType !== "fragment") return null;
    const wgsl = language === ShaderLanguage.WGSL;
    const position = wgsl ? "fragmentInputs.vPositionW" : "vPositionW";
    // Babylon queries hook names during super(), before constructor fields exist.
    const size = (this.sizeMetres ?? 1).toFixed(1);
    const sample = wgsl
      ? `textureSample(objectLakeMask, objectLakeMaskSampler, ${position}.xz / ${size} + 0.5).r`
      : `texture2D(objectLakeMask, ${position}.xz / ${size} + 0.5).r`;
    const code: Record<string, string> = {
      CUSTOM_FRAGMENT_DEFINITIONS: wgsl
        ? "var objectLakeMaskSampler: sampler;\nvar objectLakeMask: texture_2d<f32>;"
        : "uniform sampler2D objectLakeMask;",
      // Per-fragment world height covers thin instances and objects crossing the
      // surface. The lake mask keeps dry land below lake elevation fully lit.
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `
${wgsl ? "let" : "float"} objectWaterWeight = (1.0 - smoothstep(${(WATER_Y - 1).toFixed(1)}, ${WATER_Y.toFixed(1)}, ${position}.y)) * smoothstep(0.2, 0.5, ${sample});
${wgsl ? "let" : "float"} objectDaylightLeft = exp(-max(${WATER_Y.toFixed(1)} - ${position}.y, 0.0) * objectWaterWeight / ${DAYLIGHT_DEPTH_METRES.toFixed(1)});
`,
      // Dim sky diffuse and specular together. Emission and local lamp light
      // retain their strength; dimming the final colour would destroy both.
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
#ifdef REFLECTION
finalIrradiance *= objectDaylightLeft;
finalRadianceScaled *= objectDaylightLeft;
#endif
`,
    };
    const lights = (this._material as PBRMaterial).maxSimultaneousLights ?? 4;
    for (let i = 0; i < lights; i++) {
      code[`CUSTOM_LIGHT${i}_COLOR`] = `
#if defined(DIRLIGHT${i}) || defined(HEMILIGHT${i})
${wgsl ? `diffuse${i} = vec4f(diffuse${i}.rgb * objectDaylightLeft, diffuse${i}.a);` : `diffuse${i}.rgb *= objectDaylightLeft;`}
#endif
`;
    }
    return code;
  }
}

export function lightSubmergedObjects(scene: Scene, lakeMask: BaseTexture, sizeMetres: number, waterMaterial: PBRBaseMaterial) {
  const attach = (material: import("@babylonjs/core").Material) => {
    // Terrain already implements this contract; the reflective lake surface
    // has its own composition. Avoid attenuating either material twice.
    if (material instanceof PBRBaseMaterial && material !== waterMaterial
      && !material.pluginManager?.getPlugin("Terrain") && !material.pluginManager?.getPlugin("WaterDepth")) {
      new WaterDepthMaterialPlugin(material, lakeMask, sizeMetres);
    }
  };
  scene.materials.forEach(attach);
  const observer = scene.onNewMaterialAddedObservable.add(attach);
  scene.onDisposeObservable.addOnce(() => observer.remove());
}
