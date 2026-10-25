import { Scene } from "@babylonjs/core/scene";
import { ShaderMaterial, IShaderMaterialOptions } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";

export interface ShaderSources { vertex: string; fragment: string }

export function nativeShaderMaterial(name: string, scene: Scene, glsl: ShaderSources, wgsl: ShaderSources,
  options: Partial<IShaderMaterialOptions>): ShaderMaterial {
  const webgpu = scene.getEngine().isWebGPU, src = webgpu ? wgsl : glsl;
  return new ShaderMaterial(name, scene, { vertexSource: src.vertex, fragmentSource: src.fragment },
    { ...options, shaderLanguage: webgpu ? ShaderLanguage.WGSL : ShaderLanguage.GLSL });
}
