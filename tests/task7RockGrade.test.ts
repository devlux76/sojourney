import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// U19 Task 7: the Llao Rock boat reference re-grade. Measured land palette from the NPS
// boat-tour photo (sRGB, docs/plans/2026-10-06-u19-terrain-relief.md Task 7): dark crag
// grey (0.13,0.15,0.17), mid grey (0.40,0.40,0.41), pale scree (0.61,0.61,0.61), warm
// brown weathering only ~4%. The shipped dark_rock_02 base means (0.23,0.20,0.17): ~2x
// too dark and warm-shifted. strataTint therefore has to brighten toward the ramp (not
// darken), demote rust to a patchy accent, streak vertically on the steeps, and wash
// pale scree down the gullies. Like tests/groundAnisotropy.test.ts this guards the
// fix at source level: the ground material cannot run under `bun test` (importing it
// pulls in the KTX2 decoder, which reads document.baseURI at module load).
const source = readFileSync(new URL("../src/engine/TerrainMaterial.ts", import.meta.url), "utf8");

// Both shader halves (GLSL `vec3 strataTint`, WGSL `fn strataTint`) must carry the
// grade: count matches across the whole file, so a half that missed the edit fails.
const count = (re: RegExp) => source.match(re)?.length ?? 0;

describe("rock re-grade from the Llao Rock boat reference (U19 Task 7)", () => {
  test("the cold base brightens toward the measured ramp instead of darkening it", () => {
    // The old multiplier (0.72,0.76,0.84) pushed the already-dark texture down further.
    expect(source).not.toContain("0.72, 0.76, 0.84");
    // Both halves declare a cool-grey multiplier at least ~1.4x: closes the ~2x gap
    // against the measured mid grey while staying blue-grey (b >= r).
    const colds = [...source.matchAll(/cold = vec3f?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g)];
    expect(colds.length).toBe(2);
    for (const [, r, g, b] of colds) {
      expect(Number(r)).toBeGreaterThanOrEqual(1.2);
      expect(Number(g)).toBeGreaterThanOrEqual(1.2);
      expect(Number(b)).toBeGreaterThanOrEqual(Number(r));
    }
  });

  test("brown weathering is a patchy accent, not the base", () => {
    // Amplitude at most 0.4 (was 0.55) in both halves...
    const amps = [...source.matchAll(/rust \* ([\d.]+)/g)].map(m => Number(m[1]));
    expect(amps.length).toBe(2);
    for (const a of amps) expect(a).toBeLessThanOrEqual(0.4);
    // ...behind a tightened patch gate (was 0.5,0.75) in both halves: ~5-10% cover.
    expect(count(/smoothstep\(0\.62,\s*0\.82,/g)).toBe(2);
  });

  test("vertical fracture striping keys off steepness in both halves", () => {
    // A `steep` gate (1 on cliffs, 0 on flats) drives a fast-across/slow-down noise term.
    expect(count(/steep = 1\.0 - clamp\(up,/g)).toBe(2);
    expect(count(/streak/g)).toBeGreaterThanOrEqual(2);
    expect(source).toContain("p.y * 0.012");
  });

  test("pale scree washes down the gullies in both halves", () => {
    // Noise-channelled vertical runs mix toward the measured pale scree (~0.61 sRGB),
    // as a brightening multiplier the dark base can reach without blowing out.
    expect(count(/chute/g)).toBeGreaterThanOrEqual(2);
    expect(count(/1\.9, 1\.9, 1\.85/g)).toBe(2);
  });
});
