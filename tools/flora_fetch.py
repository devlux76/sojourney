import hashlib
import json
import urllib.request
from pathlib import Path

CACHE = Path(__file__).resolve().parent / ".cache" / "flora" / "src"
API = "https://api.polyhaven.com/files/"


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(entry, dest):
    if dest.exists() and md5(dest) == entry["md5"]:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(entry["url"], headers={"User-Agent": "sojourney-packsmith"})
    with urllib.request.urlopen(req) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    if md5(tmp) != entry["md5"]:
        raise RuntimeError(f"md5 mismatch for {entry['url']}")
    tmp.rename(dest)


def files_index(asset):
    index = CACHE / asset / "files.json"
    if not index.exists():
        index.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(API + asset, headers={"User-Agent": "sojourney-packsmith"})
        index.write_bytes(urllib.request.urlopen(req).read())
    return json.loads(index.read_text())


def fetch_gltf(asset, res="4k", geometry=True):
    entry = files_index(asset)["gltf"][res]["gltf"]
    root = CACHE / asset / "gltf"
    download(entry, root / Path(entry["url"]).name)
    for rel, sub in entry["include"].items():
        if geometry or not rel.endswith(".bin"):
            download(sub, root / rel)
    return root / Path(entry["url"]).name


def fetch_blend(asset, res="4k", textures=True):
    entry = files_index(asset)["blend"][res]["blend"]
    root = CACHE / asset / "blend"
    download(entry, root / Path(entry["url"]).name)
    if textures:
        for rel, sub in entry["include"].items():
            download(sub, root / rel)
    return root / Path(entry["url"]).name
