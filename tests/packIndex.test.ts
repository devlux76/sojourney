import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A same-size normal/mesh edit must invalidate the downloadable pack cache.
// Exercise the real Python indexer against files rather than inspecting its source.
test("pack version changes for same-size content edits and stays stable otherwise", async () => {
  const root = mkdtempSync(join(tmpdir(), "sojourney-pack-index-"));
  const pack = join(root, "public/packs/example");
  mkdirSync(pack, { recursive: true });
  const script = new URL("../tools/build_pack_index.py", import.meta.url).pathname;
  const build = () => {
    const result = Bun.spawnSync(["python3", script, "example"], { cwd: root });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return JSON.parse(readFileSync(join(pack, "files.json"), "utf8"));
  };
  try {
    await Bun.write(join(pack, "normal.bin"), "first");
    const before = build();
    await Bun.write(join(pack, "normal.bin"), "other");
    const after = build();
    expect(after.files).toEqual(before.files);
    expect(after.version).not.toBe(before.version);
    expect(build().version).toBe(after.version);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
