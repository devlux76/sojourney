#!/usr/bin/env python3
"""Poly Haven helper: search, inspect and download original assets.

Stdlib only. Metadata via GET https://api.polyhaven.com (cached 24h); file
bytes only from official index URLs, md5/size-verified before replacing.
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

API_BASE = "https://api.polyhaven.com"
USER_AGENT = "SojourneyPolyHavenSkill/1.0"
CACHE_TTL = 24 * 3600
DEFAULT_CACHE = os.path.join(os.path.expanduser("~"), ".cache",
                             "sojourney-polyhaven")
MANIFEST_NAME = "polyhaven-manifest.json"
LICENSE = "CC0"
# File bytes only from official HTTPS Poly Haven hosts, never arbitrary URLs.
ALLOWED_HOST_SUFFIXES = ("polyhaven.com", "polyhaven.org")
MD5_RE = re.compile(r"[0-9a-fA-F]{32}")
ASSET_ID_RE = re.compile(r"[a-z0-9_]+")


def fail(message):
    """Concise stderr error, nonzero exit, no retries."""
    print("polyhaven: error: {}".format(message), file=sys.stderr)
    raise SystemExit(1)


def check_asset_id(asset_id):
    """Slugs only ([a-z0-9_]+); reject anything else before any fetch."""
    if not asset_id or not ASSET_ID_RE.fullmatch(asset_id):
        fail("invalid asset id {!r} (expected [a-z0-9_]+)".format(asset_id))


class _PolyHavenRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Follow redirects only within official HTTPS Poly Haven hosts."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url_allowed(urllib.parse.urljoin(req.full_url, newurl))
        return super().redirect_request(req, fp, code, msg, headers, newurl)


# One opener for every request (metadata and file bytes alike), so even the
# initial API calls refuse redirects to non-Poly-Haven hosts.
_OPENER = urllib.request.build_opener(_PolyHavenRedirectHandler)


def _http_get(url, timeout):
    """Single GET with the skill User-Agent; callers never retry."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return _OPENER.open(req, timeout=timeout)


def report_http_error(exc):
    """Concise message for an HTTPError; rate limits keep Retry-After."""
    if exc.code == 429:
        retry = exc.headers.get("Retry-After") if exc.headers else None
        hint = " retry after {}".format(retry) if retry else ""
        fail("rate limited (429){}; not retrying".format(hint))
    url = getattr(exc, "url", None) or getattr(exc, "filename", None)
    fail("request failed ({}): {}".format(exc.code, url or "request"))


def api_get_json(url, timeout):
    """GET a URL and parse it as JSON; report HTTP errors without retrying."""
    try:
        with _http_get(url, timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        report_http_error(exc)
    except urllib.error.URLError as exc:
        fail("request failed: {}".format(exc.reason))
    except (ValueError, UnicodeDecodeError):
        fail("invalid JSON from {}".format(url))


def atomic_write_json(path, obj):
    """Write JSON via a unique sibling temp file + os.replace; clean up."""
    tmp_fd, tmp_name = tempfile.mkstemp(dir=os.path.dirname(path) or ".",
                                        prefix=".tmp-")
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as handle:
            json.dump(obj, handle, indent=2)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def cache_path(cache_dir, key):
    """Stable short filename (SHA256 of the full API path) for any query."""
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return os.path.join(cache_dir, digest + ".json")


def cache_load(cache_dir, key):
    """Cached payload, or None when missing/expired/corrupt."""
    try:
        with open(cache_path(cache_dir, key), "r", encoding="utf-8") as handle:
            entry = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(entry, dict):
        return None
    fetched = entry.get("fetched")
    if isinstance(fetched, bool) or not isinstance(fetched, (int, float)) \
            or fetched != fetched or time.time() - fetched > CACHE_TTL:
        return None  # malformed timestamp counts as corrupt cache
    return entry.get("payload")


def cache_save(cache_dir, key, payload):
    """Atomically cache a metadata payload (warn, don't fail, on error)."""
    try:
        os.makedirs(cache_dir, exist_ok=True)
        atomic_write_json(cache_path(cache_dir, key),
                          {"fetched": time.time(), "payload": payload})
    except OSError as exc:
        print("polyhaven: warning: cache write failed: {}".format(exc),
              file=sys.stderr)


def fetch_json(path, cache_dir, refresh, timeout):
    """GET an API path, using the 24h metadata cache unless refreshed."""
    if not refresh:
        hit = cache_load(cache_dir, path)
        if hit is not None:
            return hit
    payload = api_get_json(API_BASE + path, timeout)
    cache_save(cache_dir, path, payload)
    return payload


def emit(obj):
    """Compact JSON on stdout: selected fields only, never raw catalogs."""
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")


def select_info(asset_id, payload):
    """Contract fields from an /info payload; dimensions passed through."""
    if not isinstance(payload, dict):
        payload = {}
    return {
        "provider": "Poly Haven", "id": asset_id, "license": LICENSE,
        "name": payload.get("name"), "type": payload.get("type"),
        "description": payload.get("description"),
        "authors": payload.get("authors"),
        "dimensions": payload.get("dimensions"),
        "polycount": payload.get("polycount", payload.get("poly_count")),
        "max_resolution": payload.get("max_resolution"),
        "tags": payload.get("tags"), "attributes": payload.get("attributes"),
        "category": payload.get("category", payload.get("categories")),
        "source_url": payload.get("source_url") or
        "https://polyhaven.com/a/{}".format(asset_id),
        "thumbnail_url": payload.get("thumbnail_url"),
    }


def select_search_result(asset_id, payload, score):
    """Concise search hit; rich fields stay in info only."""
    if not isinstance(payload, dict):
        payload = {}
    return {
        "provider": "Poly Haven", "id": asset_id, "license": LICENSE,
        "name": payload.get("name"), "type": payload.get("type"),
        "description": payload.get("description"),
        "authors": payload.get("authors"),
        "source_url": payload.get("source_url") or
        "https://polyhaven.com/a/{}".format(asset_id),
        "thumbnail_url": payload.get("thumbnail_url"), "score": score,
    }


def cmd_search(args):
    """Native ranked search; API order preserved, only matches enriched."""
    query = args.query.strip().lower()
    if not query:
        fail("search query is empty")
    if len(query) > 100:
        fail("search query exceeds 100 characters")
    if args.limit < 1:
        fail("--limit must be positive")
    limit = min(args.limit, 50)
    payload = fetch_json("/search?{}".format(urllib.parse.urlencode(
        {"q": query, "t": args.type, "limit": limit})), args.cache_dir,
        args.refresh, args.timeout)
    results = payload.get("results", []) if isinstance(payload, dict) else []
    total = payload.get("total", len(results)) \
        if isinstance(payload, dict) else 0
    enriched = []
    for entry in results[:limit]:
        slug = entry.get("slug") if isinstance(entry, dict) else None
        if not slug:
            continue
        path = "/info/{}".format(slug)
        enriched.append(select_search_result(
            slug, fetch_json(path, args.cache_dir, args.refresh, args.timeout),
            entry.get("score")))
    emit({"provider": "Poly Haven", "query": query, "type": args.type,
          "total": total, "results": enriched})


def cmd_info(args):
    """Selected metadata for one asset (cached 24h)."""
    check_asset_id(args.asset)
    emit(select_info(args.asset, fetch_json("/info/{}".format(args.asset),
                                            args.cache_dir, args.refresh, args.timeout)))


def collect_variants(node, prefix, out):
    """Flatten the /files tree; include maps stay dependencies, not variants."""
    if isinstance(node, dict) and isinstance(node.get("url"), str):
        includes = []
        collect_includes(node.get("include"), includes)
        out.append({"variant": "/".join(prefix), "url": node["url"],
                    "size": node.get("size"), "md5": node.get("md5"),
                    "includes": includes})
    elif isinstance(node, dict):
        for key, value in node.items():
            if key != "include":
                collect_variants(value, prefix + [key], out)


def collect_includes(node, out):
    """Recursively collect entry.include files, preserving relative paths."""
    if not isinstance(node, dict):
        return
    for rel, entry in node.items():
        if isinstance(entry, dict) and isinstance(entry.get("url"), str):
            out.append({"path": rel, "url": entry["url"],
                        "size": entry.get("size"), "md5": entry.get("md5")})
            collect_includes(entry.get("include"), out)


def cmd_files(args):
    """Exact variant keys with main/dependency sizes and hashes."""
    check_asset_id(args.asset)
    if args.limit < 1:
        fail("--limit must be positive")
    variants = []
    path = "/files/{}".format(args.asset)
    collect_variants(fetch_json(path, args.cache_dir, args.refresh, args.timeout), [], variants)
    if args.prefix:
        variants = [v for v in variants
                    if v["variant"].startswith(args.prefix)]
    records = []
    for variant in variants[:args.limit]:
        dep_bytes = sum(i.get("size") or 0 for i in variant["includes"])
        record = {"variant": variant["variant"], "url": variant["url"],
                  "size": variant["size"], "md5": variant["md5"],
                  "dependency_count": len(variant["includes"]),
                  "dependency_bytes": dep_bytes,
                  "total_bytes": (variant["size"] or 0) + dep_bytes}
        if args.include_files:
            record["includes"] = variant["includes"]
        records.append(record)
    emit({"provider": "Poly Haven", "id": args.asset, "total": len(variants),
          "shown": len(records), "truncated": len(variants) > len(records),
          "variants": records})


def root_filename(url):
    """Root filename = unquoted basename of the file URL path."""
    name = os.path.basename(urllib.parse.unquote(
        urllib.parse.urlsplit(url).path))
    if not name:
        fail("cannot derive filename from {}".format(url))
    return name


def check_url_allowed(url):
    """Refuse file URLs outside the official HTTPS Poly Haven hosts."""
    parts = urllib.parse.urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not any(
            host == s or host.endswith("." + s)
            for s in ALLOWED_HOST_SUFFIXES):
        fail("refusing non-official download URL: {}".format(url))


def check_verification(item):
    """Refuse missing/corrupt verification metadata before any transfer."""
    size, md5 = item.get("size"), item.get("md5")
    if isinstance(size, bool) or not isinstance(size, int) or size < 0:
        fail("missing or corrupt size for {!r}: {!r}".format(
            item.get("path"), size))
    if not isinstance(md5, str) or not MD5_RE.fullmatch(md5):
        fail("missing or corrupt md5 for {!r}".format(item.get("path")))


def plan_download(asset, variant_key, files_payload, destination):
    """Build + validate the full file plan BEFORE downloading anything."""
    variants = []
    collect_variants(files_payload, [], variants)
    match = [v for v in variants if v["variant"] == variant_key]
    if not match:
        fail("unknown variant {!r}".format(variant_key))
    match = match[0]
    planned = [{"path": root_filename(match["url"]), "url": match["url"],
                "size": match.get("size"), "md5": match.get("md5")}]
    planned.extend(match["includes"])
    if not os.path.isabs(destination):
        fail("destination must be absolute: {}".format(destination))
    dest_real = os.path.realpath(os.path.abspath(destination))
    seen = set()
    for item in planned:
        rel = item["path"]
        parts = rel.split("/")
        if not rel or os.path.isabs(rel) or "\\" in rel or "" in parts \
                or "." in parts or ".." in parts:
            fail("refusing unsafe path: {!r}".format(rel))
        if rel in seen or rel == MANIFEST_NAME:
            fail("conflicting path in plan: {!r}".format(rel))
        seen.add(rel)
        target = os.path.realpath(os.path.join(os.path.abspath(destination),
                                               *parts))
        if os.path.commonpath([dest_real, target]) != dest_real:
            fail("plan escapes destination: {!r}".format(rel))
        check_url_allowed(item["url"])
        check_verification(item)  # mandatory: no transfer without hash+size
    return planned


def md5_of(path):
    """Hex md5 of an existing file."""
    digest = hashlib.md5()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_one(url, dest, size, md5, timeout):
    """Stream to a temp sibling, verify size/md5, then atomically replace."""
    if os.path.isfile(dest) and not os.path.islink(dest) \
            and os.path.getsize(dest) == size \
            and md5_of(dest).lower() == str(md5).lower():
        return "skipped"  # size+checksum match: leave the file alone
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp_fd, tmp_name = tempfile.mkstemp(dir=os.path.dirname(dest),
                                        prefix=".download-")
    os.close(tmp_fd)
    digest, received = hashlib.md5(), 0
    try:
        with _http_get(url, timeout) as resp:
            with open(tmp_name, "wb") as handle:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    handle.write(chunk)
                    digest.update(chunk)
                    received += len(chunk)
        if received != size:
            fail("size mismatch for {} (got {}, want {})".format(url, received, size))
        if digest.hexdigest().lower() != str(md5).lower():
            fail("md5 mismatch for {}".format(url))
        os.replace(tmp_name, dest)  # existing file kept until success
        return "downloaded"
    finally:
        try:
            os.unlink(tmp_name)  # partial temp removed on errors too
        except OSError:
            pass


def cmd_download(args):
    """Fetch one exact variant + includes, verified, with a manifest."""
    check_asset_id(args.asset)
    if not args.destination:
        fail("--destination is required")
    info = fetch_json("/info/{}".format(args.asset), args.cache_dir,
                      args.refresh, args.timeout)
    planned = plan_download(args.asset, args.variant, fetch_json(
        "/files/{}".format(args.asset), args.cache_dir, args.refresh,
        args.timeout), args.destination)
    total_bytes = sum(i.get("size") or 0 for i in planned)
    if args.dry_run:  # plan only: no dirs, downloads, contents or manifest
        emit({"provider": "Poly Haven", "id": args.asset, "variant": args.variant,
              "dry_run": True, "file_count": len(planned), "total_bytes": total_bytes,
              "paths": [i["path"] for i in planned]})
        return
    dest_abs = os.path.abspath(args.destination)
    results = []
    for item in planned:
        print("polyhaven: fetching {}".format(item["path"]), file=sys.stderr)
        status = download_one(item["url"],
                              os.path.join(dest_abs, *item["path"].split("/")),
                              item.get("size"), item.get("md5"), args.timeout)
        results.append({"path": item["path"], "url": item["url"],
                        "size": item.get("size"), "md5": item.get("md5"),
                        "status": status})
    os.makedirs(dest_abs, exist_ok=True)
    atomic_write_json(os.path.join(dest_abs, MANIFEST_NAME), {
        "provider": "Poly Haven", "id": args.asset, "variant": args.variant,
        "source_url": "https://polyhaven.com/a/{}".format(args.asset),
        "license": LICENSE, "authors": info.get("authors")
        if isinstance(info, dict) else None,
        "fetched_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "files": [{k: r[k] for k in ("path", "url", "size", "md5")} for r in results]})
    emit({"provider": "Poly Haven", "id": args.asset, "variant": args.variant, "manifest": MANIFEST_NAME,
          "file_count": len(results), "total_bytes": total_bytes, "files": results})


def build_parser():
    """CLI: global flags before the subcommand; search/info/files/download."""
    parser = argparse.ArgumentParser(
        prog="polyhaven.py",
        description="Search, inspect and download Poly Haven originals.")
    parser.add_argument("--cache-dir", default=DEFAULT_CACHE, help="cache directory")
    parser.add_argument("--refresh", action="store_true", help="bypass the 24h metadata cache")
    parser.add_argument("--timeout", type=float, default=60, help="HTTP timeout seconds (default 60)")
    sub = parser.add_subparsers(dest="command", required=True)
    search = sub.add_parser("search", help="ranked asset search")
    search.add_argument("query", help="search text")
    search.add_argument("--type", default="all", choices=["models", "textures", "hdris", "all"])
    search.add_argument("--limit", type=int, default=5, help="matches to enrich (default 5, max 50)")
    search.set_defaults(func=cmd_search)
    info = sub.add_parser("info", help="selected metadata for one asset")
    info.add_argument("asset", help="asset id ([a-z0-9_]+)")
    info.set_defaults(func=cmd_info)
    files = sub.add_parser("files", help="list exact download variant keys")
    files.add_argument("asset", help="asset id ([a-z0-9_]+)")
    files.add_argument("--prefix", default=None, help="variant prefix filter")
    files.add_argument("--limit", type=int, default=30, help="variants shown (default 30)")
    files.add_argument("--include-files", action="store_true",
                       help="include per-file dependency entries")
    files.set_defaults(func=cmd_files)
    download = sub.add_parser("download", help="fetch one variant + includes")
    download.add_argument("asset", help="asset id ([a-z0-9_]+)")
    download.add_argument("--variant", required=True, help="exact variant key from files")
    download.add_argument("--destination", required=True, help="absolute destination directory")
    download.add_argument("--dry-run", action="store_true", help="print the plan without downloading")
    download.set_defaults(func=cmd_download)
    return parser


def main(argv=None):
    """Parse argv and run the subcommand; concise errors, no tracebacks."""
    args = build_parser().parse_args(argv)
    timeout = args.timeout
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) \
            or not timeout > 0:
        fail("--timeout must be positive")
    try:
        args.func(args)
    except urllib.error.HTTPError as exc:
        report_http_error(exc)  # file transfers keep Retry-After, no retry
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        fail("request failed: {}".format(getattr(exc, "reason", None) or exc))
    return 0


if __name__ == "__main__":
    main()
