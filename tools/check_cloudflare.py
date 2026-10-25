"""Reject a static deployment that exceeds Sojourney's Cloudflare file budgets.

Run against the final staged directory, including application bundles and WASM:
    python3 tools/check_cloudflare.py dist
This checks deployable bytes, not HTTP compression or player cache occupancy.
"""
import argparse
import json
from pathlib import Path

MAX_FILES = 20_000
# Use the lead's decimal 25 MB cap, conservatively below Cloudflare's 25 MiB limit.
MAX_FILE_BYTES = 25_000_000


def audit(root: Path, max_files: int = MAX_FILES, max_file_bytes: int = MAX_FILE_BYTES) -> dict:
    if not root.is_dir():
        raise ValueError(f"Deployment directory does not exist: {root}")
    files = sorted(p for p in root.rglob("*") if p.is_file())
    oversized = []
    total = 0
    for path in files:
        size = path.stat().st_size
        total += size
        if size > max_file_bytes:
            oversized.append({"path": path.relative_to(root).as_posix(), "bytes": size})
    return {
        "ok": len(files) <= max_files and not oversized,
        "files": len(files),
        "bytes": total,
        "maxFiles": max_files,
        "maxFileBytes": max_file_bytes,
        "oversized": oversized,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    try:
        report = audit(args.directory)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
