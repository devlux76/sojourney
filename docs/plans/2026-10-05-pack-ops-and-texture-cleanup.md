# Pack ops, texture cleanup and Cloudflare distribution — execution plan

**Status:** planned (not started). **Written:** 2026-10-05, after a VRAM/KTX2 audit sprint that
found **zero** in-scope conversions: `public/packs/` is already 100 % KTX2. That sprint produced no
diff and no commit; this plan is its hand-off.

**Execute the phases in order 1 → 2 → 3 → 4** (they were prioritised in reverse, safest/cheapest
first, which also buys time to hunt down texture originals).

**Rules that still apply to every phase** (from `AGENTS.md`):

- Bun only: `bun install`, `bun run dev`, `bun run build`, `bun test`, `bun run typecheck`. Never
  npm/npx/yarn/pnpm/node directly.
- Commit directly on `main`, one commit per phase. Do **not** touch `dist/`, `node_modules/`,
  `ISSUES.md` (has a pre-existing unstaged modification) or the untracked `docs/baselines/*`.
- Never `git restore --source=HEAD` anything; never delete code you did not write in this phase.
- Comment the files you edit (rule 6), describing what the code does *now*.
- Any asset that ships must be commercially usable and credited in `CREDITS.md`
  (CC0/public domain preferred; BabylonJS/Assets = CC BY 4.0 unless its folder says otherwise).

---

## Verified facts from the audit (do not re-research)

- **Pack textures:** 16/16 referenced ground textures are `.ktx2` (UASTC q2, zstd, full mip chains;
  `vkFormat=0`, level-0 byte count = `w*h*1`), plus 82 GLB-embedded `image/ktx2` images across 17
  textured GLBs. Manifests `flora/forest.json`, `props/props.json`, `route/boat_tour.json`,
  `audio/tour/lines.json` reference **no** images. The only non-KTX2 image under `public/packs/` is
  `thumbnail.jpg` (DOM `<img>` in `src/ui/DestinationScreen.ts` — browsers cannot decode KTX2 there;
  it never reaches the GPU; **keep JPEG**).
- **`ground/splatmap.png` no longer exists** (converted in commit `db8ce71`); the pipeline now runs
  `encode_ktx2.py --linear` then unlinks the PNG (`tools/build_ground.py:453-454`).
- **`files.json` before any of this work:** sha256
  `c03001ff0873c255dd747b4988c4b9bd5acefd82d63c1fc38f4b39ee723c8c6d`, version `ad5cc6c8892ca3cb`,
  5103 entries, self-consistent (its own path:bytes hash re-verifies).
- **Ground tile build is incomplete on disk:** `public/packs/crater-lake/ground/near/` holds 146 of
  the 1311 tiles that `ground.json` declares (`leaves: 1311`) — the `compress_all(near_jobs …)` pass
  at `tools/build_ground.py:429` was interrupted ~2026-10-05 21:03. `collision/` is complete (1311)
  and `dist/` still holds the full 1311 from an earlier build. Rebuilding `files.json` right now
  would produce 3938 entries / 546.1 MB / version `4935f21feefe34a9` — **do not commit that while
  `near/` is incomplete** (it would ship an index for a partial pack *and* bump the version hash,
  forcing every player to re-download). This is why the index was restored byte-identically.
- **`ktx` (KTX-Software) CLI is NOT installed** — any `tools/encode_ktx2.py` run will fail until it
  is. Prerequisite for Phase 3.
- **Encoder:** `python3 tools/encode_ktx2.py [--colour|--linear] <out-dir> <images...>` (UASTC q2,
  zstd 18, `--generate-mipmap`, name-derived colour/linear auto-detection via `transfer_for`).
  **Read the script before running it** and confirm flags against its current argparse.
- **Pre-existing test/typecheck baseline:** `bun run typecheck` → exactly 2 errors, both known
  (`src/core/SettingsPanel.ts(87,9)` TS2322, `src/engine/environment/index.ts(29,20)` TS2724).
  `bun test` → 21 pass / 0 fail / 118 expects / 8 files. Any phase that changes these is a failure.
- **Terrain question (answered):** *No — we never adopted Babylon Large Terrain or hexagonal tiles
  and there is no "keep the player at 0, move the terrain" floating origin anywhere in `src/` or
  `tools/`* (greps for `hexagon|hex tile|LargeTerra|floating origin|recenter|worldOffset` return
  nothing). The terrain is a **static-world leaf grid**: `src/engine/groundStream.ts` streams
  per-leaf LOD files (`leaf_<id>_LOD<level>`, LOD 0–1 in `ground/near/*.glb`, LOD 2–4 always
  loaded), cross-fades switches with `DitheredTileFadeMaterialPlugin` (500 ms, 5 % hysteresis),
  and attaches Havok `PhysicsShapeHeightField` collision within 400 m. The player/camera moves over
  world coordinates; `prepare()` pre-loads leaves + collision before teleports. Adopting a
  floating-origin/hex-tile architecture would be a rewrite, not a sprint.

---

## Phase 1 — Fix stale `splatmap.png` references (docs + tools only)

Smallest and safest. No VRAM effect; it stops the docs/tools from lying about the pack.

1. `CREDITS.md`:
   - the `public/packs/crater-lake/ground/splatmap.png` citation (around line 42) → `ground/splatmap.ktx2`.
   - the dead `public/packs/crater-lake/terrain/splatmap.png` citation (around lines 84-85) →
     `ground/splatmap.ktx2`, and re-check the tool it credits (see next point).
2. `tools/generate_splatmap.py` (~line 52) still writes to the non-existent `ground/…`/`terrain/…`
   path. Decide the single source of truth: the pipeline is `ground_splat.py` → PNG →
   `build_ground.py` encodes → PNG unlinked. Point the generator at the same path the pipeline
   reads (or at a cache dir such as `tools/.cache/splatmap.png`) so running it standalone can never
   drop an unreferenced PNG inside `public/packs/`.
3. `tools/ground_splat.py` `__main__` (~line 124) writes `public/packs/crater-lake/ground/splatmap.png`
   directly — same fix as (2).
4. Verify: `grep -rn 'splatmap\.png' . --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist`
   → only cache/ or nothing; `bun run typecheck` unchanged (2 errors); `bun test` 21/21.
5. Commit: `docs: fix stale splatmap.png references (pack ships splatmap.ktx2)`.

## Phase 2 — Finish the `ground/near` build and rebuild the pack index

Makes the pack deployable (today `PackLoader.loadPack` throws on the first missing
`near/146.glb` because every `files.json` entry must return 200).

1. Record the baseline: `sha256sum public/packs/crater-lake/files.json` must be
   `c03001ff…8c6d` before you start.
2. **Read** `tools/build_ground.py`'s CLI/flow first (argparse, what it skips, whether it resumes).
   The interrupted step is `compress_all(near_jobs + far_jobs)` (line ~429). Re-running the tool
   may redo earlier stages — check for skip/resume flags before launching, and expect a long run
   (1165 meshopt/KTX2 compressions).
3. After it finishes: confirm 1311 files in `ground/near/`, 1311 in `ground/collision/`, and that
   `git status` shows the new tiles as untracked (the pack *is* tracked — that is how
   `splatmap.png` history exists).
4. `python3 tools/build_pack_index.py crater-lake` → expect ~5103 entries / ~783 MB. Note the new
   `version` hash: it differs from `ad5cc6c8892ca3cb` if the rebuilt tiles differ byte-wise from the
   older `dist/` build. **Version bump = players re-download the pack.** Acceptable pre-launch; call
   it out in the commit message rather than trying to preserve the hash.
5. Verify index ↔ disk equality (the audit script pattern): every entry's `bytes` equals
   `os.path.getsize`, zero on-disk files missing from the index, zero listed-but-missing.
6. `bun run build` (regenerate `dist/`), then re-run the file/sizes check against `dist/`;
   `bun run typecheck` (2 pre-existing), `bun test` (21/21).
7. Commit: `chore: finish ground/near tile build (146→1311) and rebuild pack index`.

## Phase 3 — Convert the four loose non-KTX2 GPU textures

These are the only remaining non-KTX2 textures that reach the GPU, and they live **outside**
`public/packs/` (out of the audit's scope, now explicitly in scope by decision).

| File | Size | GPU RGBA8+mips | as UASTC+mips | Loaded from |
|---|---:|---:|---:|---|
| `public/sky/moon.jpg` | 1024×512, 139,068 B | ≈2.80 MB | ≈0.70 MB | `src/engine/environment/Moon.ts` |
| `public/sky/milkyway.jpg` | 1024×512, 71,247 B | ≈2.80 MB | ≈0.70 MB | `src/engine/environment/NightSky.ts` |
| `public/textures/waterbump.png` | 256×256, 60,352 B | ≈0.35 MB | ≈0.09 MB | `src/engine/ground.ts`, `src/engine/underwater.ts` |
| `public/textures/flare.png` | 256×256, 7,556 B | ≈0.35 MB | ≈0.09 MB | `src/play/Campfire.ts` |

Total ≈ 6.3 MB → ≈ 1.6 MB VRAM. (They have never been converted — unchanged since `5d8e988`
"Sojourney: initial import".)

**Originals (located 2026-10-05):** all four shipped files are **byte-identical** to
`/home/mirai/projects/wizards_island/public/…`, and the sibling project has real sources:

- `/home/mirai/projects/wizards_island/assets/textures/flare.png` (+ variants `flare32bits.png`,
  `flare3.png`, `Flare2.png`)
- `/home/mirai/projects/wizards_island/assets/textures/waterbump.png`
- `moon.jpg` / `milkyway.jpg`: **no `assets/` original anywhere** — only identical
  `public/sky/*` and `dist/sky/*` copies in `wizards_island`. Check
  `wizards_island/src/sky/Moon.ts` and any `SOURCES.csv`/credits there for provenance before
  encoding from the shipped copy (encoding a shipped JPEG re-encodes lossy→UASTC, which is fine
  for a sky, but the licence still has to be recorded).

Procedure:

1. **Prereq:** install KTX-Software so `ktx` is on `PATH` (currently missing). Verify with
   `which ktx && ktx help`. Then **read** `tools/encode_ktx2.py` for its current flags.
2. Choose colour space per call site (read the actual material usage first — `grep -rn
   'moon.jpg\|milkyway.jpg\|waterbump.png\|flare.png' src/` gives the exact lines):
   - moon + milkyway → colour maps → `--colour`
   - waterbump → bump/normal input → `--linear`
   - flare → additive sprite/particle → `--colour`
3. Encode into `public/sky/` and `public/textures/` (same directory, `.ktx2` extension), e.g.
   `python3 tools/encode_ktx2.py --colour public/sky <sources>/moon.jpg`.
4. Update the 5 call sites to the `.ktx2` filenames (URLs are built with
   `import.meta.env.BASE_URL`, so only the filename literal changes).
5. Confirm nothing else references them (`grep -rn` across `src/`, `tools/`, `tests/`, `CREDITS.md`,
   `index.html`) — they are **not** in `files.json` (outside the pack), so no index rebuild.
6. Delete the now-unreferenced `.jpg`/`.png` originals **after** verification (they would otherwise
   ship in `dist/`). Keep them if any DOM use appears — none exists today.
7. `CREDITS.md`: add entries for both textures (source = wizards_island / original generator,
   state licence; AI-generated-if-so, say that instead of inventing a source).
8. Verify: `bun run typecheck` (2 pre-existing), `bun test` (21/21), `bun run build`, then a manual
   smoke test in `bun run dev`: night sky (milkyway + moon disc), water surface ripples, campfire
   flare, underwater view. Check the KTX2 decode path actually fires (no purple/black textures).
9. Commit: `perf: convert sky/water/flare textures to KTX2 (VRAM)`.

## Phase 4 — Cloudflare distribution (≤20k files, ≤25 MB per file)

Constraints given by the lead: **no more than 20,000 files per deployment and no file greater than
25 MB** (Cloudflare Pages limits). Current `dist/` audit:

- **5,814 files total** — under 20k today, but packs are ~3,939 of them and each destination adds
  ~1.3k near tiles + ~1k far/collision tiles → **4–5 destinations approaches 20k**. Plan for
  archives/object storage now rather than after it breaks.
- **5 files exceed 25 MB and will be rejected:**

  | File | Size | Kind |
  |---|---:|---|
  | `dist/packs/crater-lake/ground/terrain_normal_ao.ktx2` | 75.6 MB | texture (8192², 14 mips) |
  | `dist/packs/crater-lake/props/dutch_ship_medium.glb` | ~35.9 MB | mesh (KTX2-embedded images) |
  | `dist/packs/crater-lake/props/modular_wooden_pier.glb` | ~28 MB | mesh |
  | `dist/packs/crater-lake/audio/quiet_surf_on_the_lake.mp3` | ~28 MB | audio |
  | `dist/assets/ort-wasm-simd-threaded.asyncify-*.wasm` | ~26 MB | Babylon/Havok wasm |

Options to weigh (decide with the lead before coding; the plan does not pick one):

1. **Pages for the app shell + R2 for packs.** No file/count limits on R2, native range requests,
   cheap. Cost: CORS config, cache headers, and `PackLoader` base-URL indirection (pack URLs are
   already absolute-ish via `files.json`, so this may be a small change).
2. **Archive packs into ≤25 MB chunks** fetched and unpacked in-browser. `DecompressionStream`
   supports `gzip`/`deflate`/`deflate-raw` but **not `zstd`** — so a `.tar.zst` would need a wasm
   decompressor (Babylon ships zstd for KTX2 via `src/core/ktx2.ts`, but that is a container
   decoder, not a general archive tool). A zip/deflate archive works natively. Note KTX2 payloads
   are *already* zstd-compressed, so compressing them again buys almost nothing; the win is in
   GLB/JSON/MP3/JPG content and in file-count reduction.
3. **Split/re-encode the oversized files:** `terrain_normal_ao.ktx2` (75.6 MB) is the worst offender
   — candidate for a 4096² rebuild at higher `tileMetres` reuse, a KTX2 array split, or Range-based
   chunked fetch. The mp3 wants a bitrate/Opus pass. The wasm should be checked against what
   Babylon actually needs (threaded/asyncify variants are optional).
4. **Pre-compressed sidecars** (`.br`/`.gz`) — only worth it if Cloudflare Pages serves them
   transparently; **verify current Pages behaviour before relying on it**.

Also verify before building: whether `deploy` target is Pages or Workers, whether `public/packs`
lands in `dist/` (it does), and the exact current limit wording (the 20k/25MB figures came from the
lead — confirm against Cloudflare docs).

**Deliverable for this phase:** a short decision record in `docs/specs/` with the chosen option,
the resulting file-count/size budget, and the loader changes, *then* implementation. Do not start
coding phase 4 until the option is chosen.

---

## Global verification (run after each phase)

```
bun run typecheck   # expect exactly 2 pre-existing errors (SettingsPanel.ts, environment/index.ts)
bun test            # expect 21 pass / 0 fail
bun run build
git status --porcelain   # only the intended files; never ISSUES.md, dist/, docs/baselines/
```

Phase 2 additionally: `python3 tools/build_pack_index.py crater-lake` + index↔disk equality script.
Phase 3 additionally: visual smoke test (night sky, water, campfire, underwater).
