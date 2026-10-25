import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";

// AgX base look, adapted from three.js r180 (MIT). See public/licenses/three-agx.txt.
// Source: https://github.com/mrdoob/three.js/blob/r180/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js
// Inputs and outputs are linear sRGB; Babylon applies exposure/white balance before this,
// then its normal gamma conversion and E19 dithering afterwards.
const AGX_GLSL = `
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
  vec3( 1.6605, - 0.1246, - 0.0182 ),
  vec3( - 0.5876, 1.1329, - 0.1006 ),
  vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
  vec3( 0.6274, 0.0691, 0.0164 ),
  vec3( 0.3293, 0.9195, 0.0880 ),
  vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return + 15.5 * x4 * x2
    - 40.14 * x4 * x
    + 31.96 * x4
    - 6.868 * x2 * x
    + 0.4298 * x2
    + 0.1191 * x
    - 0.00232;
}
vec3 sojourneyAgX( vec3 color ) {
  const mat3 AgXInsetMatrix = mat3(
    vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
    vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
    vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
  );
  const mat3 AgXOutsetMatrix = mat3(
    vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
    vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
    vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
  );
  const float AgxMinEv = - 12.47393;  // log2( pow( 2, LOG2_MIN ) * MIDDLE_GRAY )
  const float AgxMaxEv = 4.026069;    // log2( pow( 2, LOG2_MAX ) * MIDDLE_GRAY )
  color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
  color = AgXInsetMatrix * color;
  color = max( color, 1e-10 ); // avoid 0 or negative numbers for log2
  color = log2( color );
  color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
  color = clamp( color, 0.0, 1.0 );
  color = agxDefaultContrastApprox( color );
  color = AgXOutsetMatrix * color;
  color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
  color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
  color = clamp( color, 0.0, 1.0 );
  return color;
}
`;

const AGX_WGSL = `
const LINEAR_REC2020_TO_LINEAR_SRGB: mat3x3f = mat3x3f(
  vec3f( 1.6605, - 0.1246, - 0.0182 ),
  vec3f( - 0.5876, 1.1329, - 0.1006 ),
  vec3f( - 0.0728, - 0.0083, 1.1187 )
);
const LINEAR_SRGB_TO_LINEAR_REC2020: mat3x3f = mat3x3f(
  vec3f( 0.6274, 0.0691, 0.0164 ),
  vec3f( 0.3293, 0.9195, 0.0880 ),
  vec3f( 0.0433, 0.0113, 0.8956 )
);
fn agxDefaultContrastApprox(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2
    - 40.14 * x4 * x
    + 31.96 * x4
    - 6.868 * x2 * x
    + 0.4298 * x2
    + 0.1191 * x
    - 0.00232;
}
fn sojourneyAgX(inputColour: vec3f) -> vec3f {
  var color = inputColour;
  const AgXInsetMatrix: mat3x3f = mat3x3f(
    vec3f( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
    vec3f( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
    vec3f( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
  );
  const AgXOutsetMatrix: mat3x3f = mat3x3f(
    vec3f( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
    vec3f( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
    vec3f( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
  );
  const AgxMinEv: f32 = - 12.47393;  // log2( pow( 2, LOG2_MIN ) * MIDDLE_GRAY )
  const AgxMaxEv: f32 = 4.026069;    // log2( pow( 2, LOG2_MAX ) * MIDDLE_GRAY )
  color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
  color = AgXInsetMatrix * color;
  color = max( color, vec3f(1e-10) ); // avoid 0 or negative numbers for log2
  color = log2( color );
  color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
  color = clamp( color, vec3f(0.0), vec3f(1.0) );
  color = agxDefaultContrastApprox( color );
  color = AgXOutsetMatrix * color;
  color = pow( max( vec3f( 0.0 ), color ), vec3f( 2.2 ) );
  color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
  color = clamp( color, vec3f(0.0), vec3f(1.0) );
  return color;
}
`;

// The default pipeline names this pass "imageProcessing". Registering by that exact
// name preserves other postprocesses and survives the pipeline's optimizer rebuilds.
// ACES remains the default. The diagnostic harness can switch this hook then call
// imageProcessing.toneMappingEnabled off/on on the same frozen frame; no product setting is added.
export function configureAgXComparison(enabled: boolean, webGPU: boolean): void {
  PostProcess.RegisterShaderCodeProcessing("imageProcessing", enabled ? {
    // Include the variant in Babylon's effect-cache key when comparing identical frames.
    defineCustomBindings: (_name, defines) => `${defines ?? ""}\n#define SOJOURNEY_AGX`,
    processCodeAfterIncludes: (_name, shaderType, code) => {
      if (shaderType !== "fragment") return code;
      return code.replace("#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_DEFINITIONS", webGPU ? AGX_WGSL : AGX_GLSL)
        .replace(/ACESFitted\((result\.rgb|rgb)\)/g, "sojourneyAgX($1)");
    },
  } : undefined);
}
