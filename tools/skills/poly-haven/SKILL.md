---
name: poly-haven
description: Search Poly Haven models, textures and HDRIs, inspect source metadata and file variants, and download original assets with their dependencies and checksum verification. Use for Poly Haven sourcing and artist-original inspection; use Babylon tools separately for geometry or material editing.
---

Use the bundled Python 3 helper rather than rediscovering the API or printing full catalogs. Resolve `scripts/polyhaven.py` relative to this skill directory. It has no third-party dependencies or server to start.

## Commands

```bash
python3 <skill-dir>/scripts/polyhaven.py search "fir tree" --type models --limit 5
python3 <skill-dir>/scripts/polyhaven.py info fir_tree_01
python3 <skill-dir>/scripts/polyhaven.py files fir_tree_01 --prefix gltf/4k
python3 <skill-dir>/scripts/polyhaven.py download fir_tree_01 --variant gltf/4k/gltf --destination /absolute/source/cache --dry-run
python3 <skill-dir>/scripts/polyhaven.py download fir_tree_01 --variant gltf/4k/gltf --destination /absolute/source/cache
```

`search` uses the API's native ranked search; preserve its order. Review descriptions and thumbnails rather than assuming every result fits the request. Types are `models`, `textures`, `hdris`, or `all`. `info` returns dimensions, authors and source links. Metadata units and library polycounts describe the source and may differ from a selected mesh; measure loaded geometry separately.

`files` gives exact slash-separated variant keys, primary/dependency sizes and hashes. Choose from those keys; do not guess download URLs or silently substitute formats/resolutions. `--prefix` and `--limit` keep output small; add `files --include-files` only when dependency details are needed. Download plans include dependency paths and total bytes. Pick a resolution deliberately and inspect large plans before execution; an already authorized download needs no additional confirmation. Model glTF/Blend files need their included files; the helper downloads these together, unchanged, and skips existing checksum-matching files. It writes `polyhaven-manifest.json` with origin, authors, license and file hashes; use it for repository credits.

Metadata is cached for 24 hours. Global `--refresh` bypasses cache; `--cache-dir PATH` selects its location. Global flags go before the subcommand. Errors are concise and nonzero; rate limits surface `Retry-After` without automatic retry. Do not loop on failure. The helper only fetches and verifies files; it does not convert, simplify, repack or load them into gameplay.

## Attribution and source integrity

The helper identifies requests as `SojourneyPolyHavenSkill/1.0` and labels output as Poly Haven. Assets are CC0, but using the live API to surface content requires visible Poly Haven attribution. Maintain project-specific `CREDITS.md` when shipping assets; do not claim endorsement. For raw-source inspection load the downloaded artist file and requested object directly, retaining authored mesh/material data rather than using pipeline exports. Use a dedicated destination for each asset/variant so its provenance manifest stays together. Downloads stay in asset/source caches unless the user requests integration.

API reference checked 2026-10-07: [overview](https://polyhaven.com/our-api), [OpenAPI schema](https://api.polyhaven.com/api-docs/swagger.json), [service terms](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md). Recheck the schema if an endpoint or response changes.
