import type { Color3 } from "@babylonjs/core/Maths/math.color";

// Calculate cloud lighting into reusable colours so a weather update does not allocate several colours
// or mutate the scene and light colours while composing the cloud material values.
export function updateCloudColors(
  sceneAmbient: Color3,
  sunDiffuse: Color3,
  sunIntensity: number,
  moonDiffuse: Color3,
  moonIntensity: number,
  rain: number,
  overcast: number,
  ambientLit: number,
  rainDarken: number,
  sunLit: number,
  overcastLit: number,
  overcastShade: number,
  lit: Color3,
  shade: Color3,
  ambient: Color3,
  contribution: Color3,
): void {
  const ambientScale = ambientLit * (1 - rainDarken * rain);
  const litScale = 1 - overcastLit * overcast;
  const shadeScale = 1 - overcastShade * overcast;
  ambient.set(sceneAmbient.r * ambientScale, sceneAmbient.g * ambientScale, sceneAmbient.b * ambientScale);
  const directScale = sunLit * sunIntensity;
  const lunarScale = sunLit * moonIntensity;
  contribution.set(
    sunDiffuse.r * directScale + moonDiffuse.r * lunarScale,
    sunDiffuse.g * directScale + moonDiffuse.g * lunarScale,
    sunDiffuse.b * directScale + moonDiffuse.b * lunarScale,
  );
  lit.set(
    ambient.r * litScale + contribution.r,
    ambient.g * litScale + contribution.g,
    ambient.b * litScale + contribution.b,
  );
  shade.set(ambient.r * shadeScale, ambient.g * shadeScale, ambient.b * shadeScale);
}
