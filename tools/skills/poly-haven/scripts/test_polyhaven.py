#!/usr/bin/env python3
"""Offline tests for polyhaven.py (fake HTTP, temp dirs, no network)."""

import hashlib
import io
import json
import os
from email.message import Message
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.client import HTTPMessage
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

import polyhaven


class FakeResp:
    """Minimal urlopen context manager backed by bytes."""

    def __init__(self, body, headers=None):
        self._body = body
        self.headers = headers or {}

    def read(self, size=-1):
        if size is None or size < 0:
            data, self._body = self._body, b""
            return data
        data, self._body = self._body[:size], self._body[size:]
        return data

    def getheader(self, name, default=None):
        return self.headers.get(name, default)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def json_resp(payload):
    return FakeResp(json.dumps(payload).encode("utf-8"))


def run_cli(argv):
    """Run main() capturing stdout/stderr; return (code, out, err)."""
    out, err, code = io.StringIO(), io.StringIO(), 0
    with redirect_stdout(out), redirect_stderr(err):
        try:
            polyhaven.main(argv)
        except SystemExit as exc:
            code = exc.code if isinstance(exc.code, int) else 1
    return code, out.getvalue(), err.getvalue()


INFO = {
    "oak": {"name": "Oak", "type": "models", "authors": {"a": "A"},
            "description": "d", "dimensions": "1x2",
            "thumbnail_url": "https://polyhaven.com/t.png"},
    "pine": {"name": "Pine", "type": "models", "authors": {"b": "B"},
             "description": "e"},
}

FILES = {"gltf": {"4k": {"gltf": {
    "url": "https://dl.polyhaven.org/model.gltf",
    "size": 4, "md5": hashlib.md5(b"GLTF").hexdigest(),
    "include": {
        "tex/nor.png": {
            "url": "https://dl.polyhaven.org/tex/nor.png",
            "size": 3, "md5": hashlib.md5(b"NOR").hexdigest(),
            # Nested dependency: include inside an include entry.
            "include": {"tex/nor_extra.png": {
                "url": "https://dl.polyhaven.org/tex/nor_extra.png",
                "size": 3, "md5": hashlib.md5(b"EXT").hexdigest()}}},
        "tex/diff.png": {
            "url": "https://dl.polyhaven.org/tex/diff.png",
            "size": 3, "md5": hashlib.md5(b"DIF").hexdigest()}}}}},
    "blend": {"4k": {"blend": {
        "url": "https://dl.polyhaven.org/model.blend",
        "size": 9, "md5": hashlib.md5(b"BLEND").hexdigest()}}}}

FILE_BYTES = {
    "https://dl.polyhaven.org/model.gltf": b"GLTF",
    "https://dl.polyhaven.org/tex/nor.png": b"NOR",
    "https://dl.polyhaven.org/tex/nor_extra.png": b"EXT",
    "https://dl.polyhaven.org/tex/diff.png": b"DIF",
    "https://dl.polyhaven.org/model.blend": b"BLEND",
}


def router_factory(calls, bodies=None, errors=None):
    """Fake _http_get: serve metadata bodies, record every requested URL."""
    bodies = bodies or {}
    errors = errors or {}

    def fake(url, timeout=None):
        calls.append(url)
        if url in errors:
            raise errors[url]
        if url in bodies:
            return bodies[url]
        if url in FILE_BYTES:
            return FakeResp(FILE_BYTES[url])
        if url.startswith(polyhaven.API_BASE + "/info/"):
            slug = url.rsplit("/", 1)[-1]
            return json_resp(INFO.get(slug, {"name": slug}))
        if url.startswith(polyhaven.API_BASE + "/files/"):
            return json_resp(FILES)
        raise AssertionError("unexpected URL: " + url)

    return fake


class PolyHavenTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = os.path.join(self.tmp.name, "cache")
        self.base = ["--cache-dir", self.cache]

    def tearDown(self):
        self.tmp.cleanup()

    def test_search_preserves_rank_order_and_limit(self):
        search = {"total": 3, "results": [
            {"slug": "oak", "score": 0.9},
            {"slug": "pine", "score": 0.8},
            {"slug": "birch", "score": 0.1}]}
        calls = []
        bodies = {polyhaven.API_BASE + "/search?q=fir+tree&t=models&limit=2":
                  json_resp(search)}
        with mock.patch.object(polyhaven, "_http_get",
                               side_effect=router_factory(calls, bodies)):
            code, out, _ = run_cli(self.base + [
                "search", "  FIR Tree ", "--type", "models", "--limit", "2"])
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertEqual(payload["provider"], "Poly Haven")
        # Query trimmed/lowercased; rank order preserved; limit honoured.
        self.assertEqual(payload["query"], "fir tree")
        self.assertEqual([r["id"] for r in payload["results"]],
                         ["oak", "pine"])
        self.assertTrue(all("score" in r for r in payload["results"]))

    def test_info_caching_avoids_second_request(self):
        calls = []
        with mock.patch.object(polyhaven, "_http_get",
                               side_effect=router_factory(calls)):
            code1, out1, _ = run_cli(self.base + ["info", "oak"])
            code2, out2, _ = run_cli(self.base + ["info", "oak"])
        self.assertEqual((code1, code2), (0, 0))
        self.assertEqual(out1, out2)
        info_calls = [u for u in calls if u.endswith("/info/oak")]
        self.assertEqual(len(info_calls), 1)  # second run served from cache

    def test_files_recursive_dependency_paths(self):
        calls = []
        with mock.patch.object(polyhaven, "_http_get",
                               side_effect=router_factory(calls)):
            code, out, _ = run_cli(self.base + [
                "files", "oak", "--include-files"])
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertEqual(payload["total"], 2)
        gltf = next(v for v in payload["variants"]
                    if v["variant"] == "gltf/4k/gltf")
        # Recursive include preserved with relative paths intact.
        paths = sorted(i["path"] for i in gltf["includes"])
        self.assertEqual(paths, ["tex/diff.png", "tex/nor.png",
                                 "tex/nor_extra.png"])
        self.assertEqual(gltf["dependency_count"], 3)
        self.assertEqual(gltf["dependency_bytes"], 3 + 3 + 3)

    def test_files_default_omits_include_entries(self):
        calls = []
        with mock.patch.object(polyhaven, "_http_get",
                               side_effect=router_factory(calls)):
            code, out, _ = run_cli(self.base + ["files", "oak"])
        self.assertEqual(code, 0)
        payload = json.loads(out)
        gltf = next(v for v in payload["variants"]
                    if v["variant"] == "gltf/4k/gltf")
        # Default stays small: counts/bytes/hashes kept, entries omitted.
        self.assertNotIn("includes", gltf)
        self.assertEqual(gltf["dependency_count"], 3)
        self.assertEqual(gltf["dependency_bytes"], 3 + 3 + 3)
        self.assertEqual(gltf["total_bytes"], 4 + 3 + 3 + 3)
        self.assertTrue(gltf["md5"])

    def test_search_results_concise(self):
        search = {"total": 1, "results": [{"slug": "oak", "score": 0.9}]}
        calls = []
        bodies = {polyhaven.API_BASE + "/search?q=oak&t=all&limit=5":
                  json_resp(search)}
        with mock.patch.object(polyhaven, "_http_get",
                               side_effect=router_factory(calls, bodies)):
            code, out, _ = run_cli(self.base + ["search", "oak"])
        self.assertEqual(code, 0)
        (hit,) = json.loads(out)["results"]
        for key in ("id", "name", "type", "description", "authors",
                    "source_url", "thumbnail_url", "license", "score"):
            self.assertIn(key, hit)
        # Rich info-only fields stay out of search output.
        for key in ("dimensions", "polycount", "max_resolution", "tags",
                    "category", "attributes"):
            self.assertNotIn(key, hit)

    def test_search_rejects_overlong_query(self):
        code, _, err = run_cli(self.base + ["search", "x" * 101])
        self.assertNotEqual(code, 0)
        self.assertIn("100", err)

    def test_nonpositive_timeout_rejected(self):
        code, _, err = run_cli(self.base + ["--timeout", "0", "info", "oak"])
        self.assertNotEqual(code, 0)
        self.assertIn("timeout", err)

    def test_long_multilingual_cached_query(self):
        query = ("fir tree 日本語テスト🌲 " * 5).strip()
        normalized = query.lower()
        search_url = polyhaven.API_BASE + "/search?" + urllib.parse.urlencode(
            {"q": normalized, "t": "all", "limit": 5})
        search = {"total": 1, "results": [{"slug": "oak", "score": 0.5}]}
        calls = []
        bodies = {search_url: json_resp(search)}
        with mock.patch.object(polyhaven, "_http_get",
                               side_effect=router_factory(calls, bodies)):
            code1, out1, _ = run_cli(self.base + ["search", query])
            code2, out2, _ = run_cli(self.base + ["search", query])
        self.assertEqual((code1, code2), (0, 0))
        self.assertEqual(out1, out2)
        # Cache filenames stay short no matter the query bytes.
        names = os.listdir(self.cache)
        self.assertTrue(names)
        self.assertTrue(all(len(n.encode("utf-8")) <= 255 for n in names))
        info_calls = [u for u in calls if u.endswith("/info/oak")]
        self.assertEqual(len(info_calls), 1)
        self.assertEqual(json.loads(out1)["query"], normalized)

    def test_malformed_cache_timestamp_ignored(self):
        os.makedirs(self.cache, exist_ok=True)
        with open(polyhaven.cache_path(self.cache, "/info/oak"), "w",
                   encoding="utf-8") as handle:
            json.dump({"fetched": "yesterday",
                       "payload": {"name": "Stale"}}, handle)
        calls = []
        with mock.patch.object(polyhaven, "_http_get",
                               side_effect=router_factory(calls)):
            code, out, _ = run_cli(self.base + ["info", "oak"])
        self.assertEqual(code, 0)  # corrupt timestamp refetches, no TypeError
        self.assertTrue(any(u.endswith("/info/oak") for u in calls))
        self.assertEqual(json.loads(out)["name"], "Oak")

    def test_missing_checksum_rejected_without_download(self):
        bad = {"gltf": {"4k": {"gltf": {
            "url": "https://dl.polyhaven.org/m.gltf", "size": 1,
            "include": {
                "tex/a.png": {
                    "url": "https://dl.polyhaven.org/tex/a.png", "size": 1,
                    "md5": hashlib.md5(b"a").hexdigest()}}}}}}  # root md5 missing
        calls = []
        bodies = {polyhaven.API_BASE + "/files/oak": json_resp(bad),
                  polyhaven.API_BASE + "/info/oak": json_resp(INFO["oak"])}
        dest = os.path.join(self.tmp.name, "dest")
        with mock.patch.object(polyhaven, "_http_get",
                               side_effect=router_factory(calls, bodies)):
            code, _, err = run_cli(self.base + [
                "download", "oak", "--variant", "gltf/4k/gltf",
                "--destination", dest])
        self.assertNotEqual(code, 0)
        self.assertIn("md5", err)
        self.assertFalse(any(u in FILE_BYTES for u in calls))
        self.assertFalse(os.path.exists(dest))

    def test_download_http429_single_attempt_no_traceback(self):
        headers = Message()
        headers["Retry-After"] = "3"
        boom = urllib.error.HTTPError(
            "https://dl.polyhaven.org/model.gltf", 429, "Too Many Requests",
            headers, None)
        calls = []

        def fake(url, timeout=None):
            calls.append(url)
            if url == "https://dl.polyhaven.org/model.gltf":
                raise boom
            if url in FILE_BYTES:
                return FakeResp(FILE_BYTES[url])
            if url.startswith(polyhaven.API_BASE + "/info/"):
                return json_resp(INFO["oak"])
            if url.startswith(polyhaven.API_BASE + "/files/"):
                return json_resp(FILES)
            raise AssertionError("unexpected URL: " + url)

        dest = os.path.join(self.tmp.name, "dest")
        with mock.patch.object(polyhaven, "_http_get", side_effect=fake):
            code, _, err = run_cli(self.base + [
                "download", "oak", "--variant", "gltf/4k/gltf",
                "--destination", dest])
        self.assertNotEqual(code, 0)
        self.assertIn("429", err)
        self.assertIn("3", err)  # Retry-After surfaced
        self.assertNotIn("Traceback", err)
        self.assertEqual(calls.count("https://dl.polyhaven.org/model.gltf"), 1)
        self.assertFalse(os.path.exists(os.path.join(dest, "model.gltf")))
        leftovers = [f for f in os.listdir(dest) if f.startswith(".download-")]
        self.assertEqual(leftovers, [])  # no temp leak

    def test_redirect_rejects_non_polyhaven_host(self):
        handler = polyhaven._PolyHavenRedirectHandler()
        req = urllib.request.Request("https://api.polyhaven.com/info/oak")
        fp, headers = io.BytesIO(b""), HTTPMessage()
        with self.assertRaises(SystemExit):
            handler.redirect_request(req, fp, 302, "Found", headers,
                                     "https://evil.example/file.bin")
        allowed = handler.redirect_request(req, fp, 302, "Found", headers,
                                           "https://dl.polyhaven.org/f.bin")
        self.assertIsNotNone(allowed)

    def test_download_rejects_traversal_before_any_download(self):
        bad = {"gltf": {"4k": {"gltf": {
            "url": "https://dl.polyhaven.org/m.gltf", "size": 1,
            "md5": hashlib.md5(b"x").hexdigest(),
            "include": {"../evil.bin": {
                "url": "https://dl.polyhaven.org/evil.bin", "size": 1,
                "md5": hashlib.md5(b"e").hexdigest()}}}}}}
        calls = []
        bodies = {polyhaven.API_BASE + "/files/oak": json_resp(bad),
                  polyhaven.API_BASE + "/info/oak": json_resp(INFO["oak"])}
        dest = os.path.join(self.tmp.name, "dest")
        with mock.patch.object(polyhaven, "_http_get",
                               side_effect=router_factory(calls, bodies)):
            code, _, err = run_cli(self.base + [
                "download", "oak", "--variant", "gltf/4k/gltf",
                "--destination", dest])
        self.assertNotEqual(code, 0)
        # Rejected before any file bytes were fetched or written.
        self.assertFalse(any("evil.bin" in u for u in calls))
        self.assertFalse(os.path.exists(dest))

    def test_download_rejects_symlink_escape_before_any_download(self):
        outside = os.path.join(self.tmp.name, "outside")
        os.makedirs(outside)
        dest = os.path.join(self.tmp.name, "dest")
        os.makedirs(os.path.join(dest, "real"))
        os.symlink(outside, os.path.join(dest, "real", "link"))
        bad = {"gltf": {"4k": {"gltf": {
            "url": "https://dl.polyhaven.org/m.gltf", "size": 1,
            "md5": hashlib.md5(b"x").hexdigest(),
            "include": {"real/link/evil.bin": {
                "url": "https://dl.polyhaven.org/evil.bin", "size": 1,
                "md5": hashlib.md5(b"e").hexdigest()}}}}}}
        calls = []
        bodies = {polyhaven.API_BASE + "/files/oak": json_resp(bad),
                  polyhaven.API_BASE + "/info/oak": json_resp(INFO["oak"])}
        with mock.patch.object(polyhaven, "_http_get",
                               side_effect=router_factory(calls, bodies)):
            code, _, _ = run_cli(self.base + [
                "download", "oak", "--variant", "gltf/4k/gltf",
                "--destination", dest])
        self.assertNotEqual(code, 0)
        self.assertFalse(any("evil.bin" in u for u in calls))
        self.assertFalse(os.path.exists(os.path.join(outside, "evil.bin")))

    def test_download_checksum_mismatch_preserves_existing(self):
        dest = os.path.join(self.tmp.name, "dest")
        os.makedirs(os.path.join(dest, "tex"))
        root = os.path.join(dest, "model.gltf")
        with open(root, "wb") as handle:
            handle.write(b"ORIGINAL")
        bodies = {polyhaven.API_BASE + "/files/oak": json_resp(FILES),
                  polyhaven.API_BASE + "/info/oak": json_resp(INFO["oak"]),
                  # Same size as advertised but wrong bytes: md5 must fail.
                  "https://dl.polyhaven.org/model.gltf": FakeResp(b"XXXX")}
        calls = []

        def fake(url, timeout=None):
            calls.append(url)
            if url in bodies:
                return bodies[url]
            return FakeResp(FILE_BYTES[url])

        with mock.patch.object(polyhaven, "_http_get", side_effect=fake):
            code, _, _ = run_cli(self.base + [
                "download", "oak", "--variant", "gltf/4k/gltf",
                "--destination", dest])
        self.assertNotEqual(code, 0)  # root md5 mismatch aborts
        with open(root, "rb") as handle:
            self.assertEqual(handle.read(), b"ORIGINAL")  # preserved
        leftovers = [f for f in os.listdir(os.path.join(dest))
                     if f.startswith(".download-")]
        self.assertEqual(leftovers, [])  # partial temp removed

    def test_download_matching_checksum_skips_without_fetch(self):
        dest = os.path.join(self.tmp.name, "dest")
        os.makedirs(os.path.join(dest, "tex"))
        root = os.path.join(dest, "model.gltf")
        with open(root, "wb") as handle:
            handle.write(b"GLTF")  # matches advertised md5
        calls = []

        def fake(url, timeout=None):
            calls.append(url)
            if url == "https://dl.polyhaven.org/model.gltf":
                raise AssertionError("matching file must not be fetched")
            if url in FILE_BYTES:
                return FakeResp(FILE_BYTES[url])
            if url.startswith(polyhaven.API_BASE + "/info/"):
                return json_resp(INFO["oak"])
            if url.startswith(polyhaven.API_BASE + "/files/"):
                return json_resp(FILES)
            raise AssertionError("unexpected URL: " + url)

        with mock.patch.object(polyhaven, "_http_get", side_effect=fake):
            code, out, _ = run_cli(self.base + [
                "download", "oak", "--variant", "gltf/4k/gltf",
                "--destination", dest])
        self.assertEqual(code, 0)
        payload = json.loads(out)
        root_result = next(f for f in payload["files"]
                           if f["path"] == "model.gltf")
        self.assertEqual(root_result["status"], "skipped")
        with open(root, "rb") as handle:
            self.assertEqual(handle.read(), b"GLTF")
        manifest = os.path.join(dest, "polyhaven-manifest.json")
        self.assertTrue(os.path.isfile(manifest))

    def test_dry_run_writes_nothing(self):
        calls = []
        dest = os.path.join(self.tmp.name, "dest")
        with mock.patch.object(polyhaven, "_http_get",
                               side_effect=router_factory(calls)):
            code, out, _ = run_cli(self.base + [
                "download", "oak", "--variant", "gltf/4k/gltf",
                "--destination", dest, "--dry-run"])
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertTrue(payload["dry_run"])
        self.assertEqual(payload["total_bytes"], 4 + 3 + 3 + 3)
        self.assertIn("model.gltf", payload["paths"])
        # Dry-run fetches metadata only: no file bytes, no directories.
        self.assertFalse(any(u in FILE_BYTES for u in calls))
        self.assertFalse(os.path.exists(dest))

    def test_rate_limit_reports_retry_after_without_retry(self):
        headers = Message()
        headers["Retry-After"] = "7"
        err = urllib.error.HTTPError(
            polyhaven.API_BASE + "/info/oak", 429, "Too Many Requests",
            headers, None)
        calls = []

        def fake(url, timeout=None):
            calls.append(url)
            raise err

        with mock.patch.object(polyhaven, "_http_get", side_effect=fake):
            code, _, err_out = run_cli(self.base + ["info", "oak"])
        self.assertNotEqual(code, 0)
        self.assertIn("429", err_out)
        self.assertIn("7", err_out)  # Retry-After surfaced
        self.assertEqual(len(calls), 1)  # no automatic retry


if __name__ == "__main__":
    unittest.main()
