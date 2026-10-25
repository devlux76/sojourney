import hashlib
import io
import json
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "ktx2"
CDN = "https://cdn.babylonjs.com"
TRANSCODERS = [
    "ktx2Transcoders/1/msc_basis_transcoder.js",
    "ktx2Transcoders/1/msc_basis_transcoder.wasm",
    "ktx2Transcoders/1/uastc_astc.wasm",
    "ktx2Transcoders/1/uastc_bc7.wasm",
    "ktx2Transcoders/1/uastc_r8_unorm.wasm",
    "ktx2Transcoders/1/uastc_rg8_unorm.wasm",
    "ktx2Transcoders/1/uastc_rgba8_srgb_v2.wasm",
    "ktx2Transcoders/1/uastc_rgba8_unorm_v2.wasm",
    "zstddec.wasm",
]


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url) as response:
        return response.read()


def main():
    version = json.loads((ROOT / "node_modules/@babylonjs/core/package.json").read_text())["version"]
    OUT.mkdir(parents=True, exist_ok=True)
    tarball = fetch(f"https://registry.npmjs.org/babylonjs-ktx2decoder/-/babylonjs-ktx2decoder-{version}.tgz")
    with tarfile.open(fileobj=io.BytesIO(tarball)) as tar:
        decoder = tar.extractfile("package/babylon.ktx2Decoder.js").read()
    files = {"babylon.ktx2Decoder.js": decoder}
    for path in TRANSCODERS:
        files[Path(path).name] = fetch(f"{CDN}/{path}")
    for name, data in files.items():
        (OUT / name).write_bytes(data)
        print(f"{name:32} {len(data):>9} bytes  sha256 {hashlib.sha256(data).hexdigest()[:16]}")
    print(f"decoder version {version} -> {OUT.relative_to(ROOT)}")
    meshopt = ROOT / "public" / "meshopt" / "meshopt_decoder.js"
    meshopt.parent.mkdir(parents=True, exist_ok=True)
    meshopt.write_bytes(fetch(f"{CDN}/meshopt_decoder.js"))
    print(f"meshopt decoder -> {meshopt.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
