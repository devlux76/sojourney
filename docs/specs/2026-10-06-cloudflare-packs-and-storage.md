# Cloudflare delivery packs and player storage

Project-lead direction, 2026-10-06. Tracked as S5/S6 in ISSUES.md. This is preparation
for implementation, not a claim that the current loader or service worker supports
archives or enforces a storage budget.

## Delivery constraints

- Maximum **20,000 files** in the complete deployment, including application JS,
  decoder/model WASM, manifests, thumbnails and service worker.
- Maximum **25,000,000 bytes per deployed file**. This decimal 25 MB budget is
  conservative against Cloudflare Pages' documented 25 MiB asset limit.
- Author real downloadable packs with **zstd level 22**, separated into shared assets
  and destination-specific assets such as terrain, bathymetry and placements.
- **Device-driven player storage budget.** Query StorageManager for origin usage/quota
  and reserve headroom for metadata, writes and other stores. The lead clarified that
  we should manage the device's cap rather than impose our own fixed 500 MB quota.
  Download size, stored compressed bytes and transient decode memory remain separate
  measurements; admit content against actual available storage.

Cloudflare's [Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
confirm 20,000 files on Free and 25 MiB per asset. Use the requested budgets even if
another plan offers more files. Chrome does not have a universal 500 MB quota:
[StorageManager and eviction guidance](https://web.dev/articles/storage-for-the-web)
describes estimates, quota errors and best-effort eviction. The device-reported quota and actual write outcomes drive admission.

## Measured starting state

The current generated pack directory contains 5,106 files / 788,975,855 bytes
(including files.json). The inspected dist contains 5,816 files / 831,544,579 bytes.
Six deployed files exceed our 25 MB cap: the terrain normal/AO KTX2 (75,603,376),
ship GLB (37,476,296), lake-surf MP3 (29,126,864), pier GLB (29,017,892), pine GLB
(25,906,192), and application ONNX WASM (26,861,777). These counts describe the
existing build inspected today; re-run after every production build.

`python3 tools/check_cloudflare.py dist` reports the complete directory and exits
nonzero for a missing directory, too many files or oversized files. Its three
regressions cover exact/over-limit size, nested app files and missing output.

Chrome DevTools MCP checked headed Chrome 154 on a fresh localhost context:
StorageManager reported quota 10,737,418,240 bytes, usage 0, persisted false.
`new DecompressionStream('zstd')` threw Unsupported compression format. This is
one browser/environment observation, not a cross-browser compatibility result.

## Authoring and pack layout (S5)

The lead's suggested treatment of the giant terrain normal/AO map is to split it
along the current terrain-tile boundaries and stream regional maps with their
geometry. Preserve the existing world registration, authored normal convention and
sky-visibility values, with border padding/seam-safe mip chains and a smaller distant
representation. Shared repeating ground textures remain reusable assets. This is
texture streaming as well as transport packaging; archive fragments alone do not
reduce the full texture's GPU residency. Prototype matched views/seams and memory
cost before replacing the global map. Keep this on the current terrain architecture;
the voxel investigation is separately scheduled for v2.

1. Inventory actual assets and references after P5's MCP passes. Classify reusable
   model/material/texture/audio content as shared; keep destination geometry,
   placement, environment configuration and destination-specific content in biome
   packs. Use explicit ownership/dependency metadata, not a blanket folder-name move.
2. Produce deterministic, content-addressed shared and biome archives. Include
   asset paths, MIME types, lengths and hashes, archive dependencies, per-frame
   compressed/decoded lengths, offsets and codec/tool versions. Shared content is
   downloaded/stored once across biomes. Preserve the content-change invalidation
   contract of S4 and the licensing/credits attached to each original asset.
3. Use independently decodable zstd-22 frames/chunks with bounded decoded sizes.
   Group related small files; split large files across frames. Every deployed chunk
   stays below 25 MB even for incompressible data. Splitting one huge compressed
   stream into arbitrary files is insufficient for random access and bounded decode.
   A single original KTX2/GLB can span frames and still reach Babylon intact.
4. Persist compressed content once. Do not keep both archives and permanently
   extracted files. The SW maps existing asset URLs to pack members, verifies
   content, decodes needed frames and returns the original authored bytes/MIME types
   to Babylon. Decoding is transport unpacking, not runtime asset derivation.
5. Choose and credit a commercially compatible browser zstd decoder; verify actual
   zstd-22 frames, advertised window limits and memory use on both rendering backends
   and supported browsers. Do not assume native DecompressionStream or HTTP zstd
   support decodes an application archive. Bound concurrent decode and transient
   frame caches separately from persistent storage; a 75 MB reconstructed texture
   still needs an explicit peak-memory measurement.
6. Preserve byte-range audio requests, correct status/headers and cancellable fetches.
   Avoid fetching/decompressing all terrain to satisfy one leaf request. Support
   fresh/partial/cached installs and shared-cache reuse; download progress measures
   compressed network bytes and reports cache contributions separately (S3).
7. Stage a separate deployment directory containing archives, indexes and the app,
   excluding the thousands of loose source-pack files. Apply the file gate to that
   final directory, not only public/packs. Handle oversized application/model WASM
   through compatible bundling/loading or another explicit byte-preserving delivery
   path; game-asset archives alone do not solve it. Keep generated outputs ignored.

Benchmark zstd-22 compression ratios, build time, browser decode cost, peak memory,
network bytes and final file count with representative assets before the full rebuild.
Do not assume large gains from already compressed KTX2, meshopt GLBs and MP3s.
If mandatory content exceeds available device storage, use bounded delivery or explain
the storage requirement without silently exceeding the device capacity.

## Regional normal/AO slice implemented (2026-10-07)

The terrain slice now supplies 81 padded 1024² regional maps on existing 2 km
boundaries and a 2048² distant map. Near geometry requests/releases its registered
region; Babylon shares native textures by URL. Original near texel density is
preserved. Full authored mip chains and 64-texel crop alignment provide matching
compressed overlap through mip 4 in the checked pilot. Total normal/AO download is
100,520,968 bytes; the largest regional file is 1,302,123 bytes and the distant map
is 5,066,193. The download grows because of padding, while tested Cleetwood GPU
residency drops from approximately 89.5 MB to 19.6 MB. The giant single file is gone.

See the [review ledger](../baselines/2026-10-06-issue-work-ledger.md) for loading,
release, per-draw registration checks and the unavailable WebGPU adapter. This
completes the regional texture implementation slice, with wider visual/backend
acceptance still open; it does not implement archives or quota management.

## SW storage management (S6)

- The SW owns a versioned compressed-chunk index with verified byte sizes, dependencies,
  last access, install state and active-client leases. Include shared/biome packs,
  optional voice/model downloads and any managed app caches in accounting. Reconcile
  actual entries on startup; process memory is not durable SW state.
- Check navigator.storage.estimate before admission and periodically during writes;
  compare known stored bytes against available origin quota with headroom.
  Origin usage may include other stores and browser accounting overhead. Estimates
  are approximate, so also handle QuotaExceededError from every storage write.
- Serialize/reserve admission across tabs and concurrent downloads so two checks
  cannot both spend the same space. Reserve room for metadata and version updates.
  Never allow old + new pack generations to silently double persistent occupancy.
- Evict obsolete generations and least-recently-used inactive biome chunks first;
  retain referenced shared chunks and active-client content where possible. Release
  leases on destination departure/client expiry. If pinned content cannot fit,
  decline admission or use a bounded network-serving path and give actionable UI.
- A failed/cancelled install is resumable, never marked complete. Detect partial or
  externally evicted content instead of trusting the current files.json marker.
  Verify hashes/lengths and repair/re-download missing chunks on demand. Offline
  failures should explain missing content instead of returning HTML as asset bytes.
- Request persistent storage where appropriate, inspect the result, and continue
  safely if denied. Persistence is protection against some eviction, not extra quota.
- Validate real SW control after activation, offline/restart recovery, initial and
  switched destinations, shared reuse, quota denial, eviction, interrupted installs,
  rolling updates and multi-tab races through Chrome DevTools MCP. Measure stored
  compressed bytes and decode peaks separately; do not infer them from wire size.

The existing PackLoader downloads/caches every loose file and marks completion with
files.json; the current SW scans pack caches and performs no quota/admission/eviction
management. S5/S6 remain open until these paths are migrated and verified.
