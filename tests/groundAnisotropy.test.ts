import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// U19 washout at the Llao Rock boat viewpoint: from the water the wall is ~190 m off, seen at a
// grazing angle with the texture heavily minified, so the default anisotropic level (4) smeared the
// 2.2 m/texel bake — normalAo above all — into mush. groundMaterial cannot run under `bun test`
// (importing it pulls in the KTX2 decoder, which reads document.baseURI at module load), so this
// guards the fix at source level: which textures opt in, that the level is capped to the engine's
// own maxAnisotropy, and that nothing here turned mipmaps or the sampling modes off.
// Tech debt: matching regexes against this file's source is a stopgap — it breaks on reformatting
// and can be satisfied by unrelated code. The future fix is to extract the cap/apply logic into a
// KTX2-import-free module, so it can be unit-tested directly with fake texture objects instead of
// being read off the page as text.
const source = readFileSync(new URL("../src/engine/ground.ts", import.meta.url), "utf8");

// The assertions below are scoped to the groundMaterial function body, so code (or a matching
// comment) elsewhere in the file cannot satisfy them.
const groundMaterialBody = (() => {
  const start = source.indexOf("export async function groundMaterial");
  const end = source.indexOf("\n}\n", start);
  return start >= 0 && end > start ? source.slice(start, end) : "";
})();

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("ground texture anisotropy (U19)", () => {
  test("every relief-carrying 2D texture is constructed with anisotropic filtering", () => {
    // The splat map, rock albedo/normal, the baked macro-normal and each layer's albedo/normal all
    // meet the eye at grazing incidence from the boat, so each construction is wrapped in
    // applyAnisotropy(...), which raises it to this GPU's limit.
    const reliefTextures = [
      "m.splatmapUrl",
      "m.rock.albedoUrl",
      // The factory selects the original or RG/BA-packed authored rock normal.
      "rockNormalUrl",
      "m.normalAoUrl",
      "layer.albedoUrl",
      "layer.normalUrl",
    ];
    for (const url of reliefTextures) {
      const wrapped = new RegExp(`applyAnisotropy\\(\\s*new Texture\\(\\s*${escapeRegExp(url)}`, "u");
      expect(groundMaterialBody).toMatch(wrapped);
    }
  });

  test("the KTX2 bed texture arrays opt in too", () => {
    // CreateTexture2DArrayFromKTX2Async hands back a RawTexture2DArray — a Texture — so the same
    // anisotropicFilteringLevel property is set on it once it exists.
    expect(groundMaterialBody).toMatch(/applyAnisotropy\(\s*bedAlbedo\s*\)/u);
    expect(groundMaterialBody).toMatch(/applyAnisotropy\(\s*bedNormal\s*\)/u);
  });

  test("the lake mask keeps Babylon's default level", () => {
    // 24 m cells sampled bilinearly: nothing fine enough to lose at a grazing angle. Every line in
    // groundMaterial that mentions the lake mask must stay clear of the helper and the property.
    const mentions = groundMaterialBody.split("\n").filter(line => line.includes("lakeMask"));
    expect(mentions.length).toBeGreaterThan(0);
    for (const line of mentions) {
      expect(line).not.toMatch(/applyAnisotropy|anisotropicFilteringLevel/u);
    }
  });

  test("the level is capped to the engine's own maxAnisotropy", () => {
    // The Math.max(1, ...) outer guard keeps the level ≥ 1 even on an engine reporting
    // maxAnisotropy 0 (NullEngine), so a texture never ends up with anisotropy switched off.
    expect(groundMaterialBody).toMatch(
      /Math\.max\(\s*1\s*,\s*Math\.min\(\s*GRAZING_ANISOTROPY\s*,\s*scene\.getEngine\(\)\.getCaps\(\)\.maxAnisotropy\s*\)\s*\)/u,
    );
    // The property is written once, from that capped value, rather than left at Babylon's default 4.
    expect(groundMaterialBody).toMatch(/anisotropicFilteringLevel\s*=\s*anisotropy/u);
    const asked = source.match(/const GRAZING_ANISOTROPY = (\d+)/u);
    expect(asked).not.toBeNull();
    expect(Number(asked![1])).toBeGreaterThanOrEqual(16);
  });

  test("mip chains and sampling modes are left alone", () => {
    // Anisotropy only helps a minified texture that still has mips; nothing here may switch them off
    // or drop to nearest sampling.
    expect(source).not.toMatch(/noMipmap\s*:\s*true/u);
    expect(source).not.toContain("Texture.NEAREST_SAMPLINGMODE");
  });

  test("the KTX2 encoder keeps baking full mip chains", () => {
    const encoder = readFileSync(new URL("../tools/encode_ktx2.py", import.meta.url), "utf8");
    expect(encoder).toContain("--generate-mipmap");
  });
});
