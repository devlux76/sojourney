"""Write public/packs/<id>/files.json: every file's path and byte size, plus a content-derived
`version` hash, for the pack loader (src/biomes/PackLoader.ts) to fetch, download and cache.

Usage: python3 tools/build_pack_index.py <biome-id> [<biome-id> ...]
       python3 tools/build_pack_index.py --all
"""
import hashlib
import json
import pathlib
import sys

PACKS = pathlib.Path("public/packs")


def build(pack_dir: pathlib.Path):
    files = sorted(p for p in pack_dir.rglob("*") if p.is_file() and p.name != "files.json")
    entries = [{"path": p.relative_to(pack_dir).as_posix(), "bytes": p.stat().st_size} for p in files]
    digest = hashlib.sha256()
    for e, path in zip(entries, files):
        digest.update(f"{e['path']}:{e['bytes']}".encode())
        # Shader/normal rebuilds can change bytes without changing file size. A
        # path-and-size hash would reuse the old cache version in that case, so
        # include every file's actual content digest in the pack version.
        with path.open("rb") as source:
            digest.update(hashlib.file_digest(source, "sha256").digest())
    version = digest.hexdigest()[:16]
    (pack_dir / "files.json").write_text(json.dumps({"version": version, "files": entries}, indent=2) + "\n")
    total = sum(e["bytes"] for e in entries)
    print(f"{pack_dir.name}: {len(entries)} files, {total / 1e6:.1f} MB, version {version}")


def main():
    if sys.argv[1:] == ["--all"]:
        ids = sorted(p.name for p in PACKS.iterdir() if p.is_dir())
    else:
        ids = sys.argv[1:]
    if not ids:
        raise SystemExit(__doc__)
    for id_ in ids:
        build(PACKS / id_)


if __name__ == "__main__":
    main()
