"""Re-encode the textures inside glTF models as KTX2 (Basis Universal UASTC, Zstandard-supercompressed),
which stay compressed on the GPU (BC7/ASTC/ETC2): about a fifth of the memory of PNG/JPEG/WebP and
no decode stall on upload. UASTC is the near-lossless mode: quality first, larger downloads accepted.

Needs Bun (for glTF-Transform) and KTX-Software 4.x: on PATH, or unpacked where KTX_HOME points
(default ~/.local/opt/KTX-Software-*). Rewrites the models in place; the originals stay in git.

Usage: python3 tools/compress_textures.py public/packs/crater-lake/models/trees/*.glb
Then rebuild the pack index: python3 tools/build_pack_index.py crater-lake
"""
import glob
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

GLTF_TRANSFORM = ["bun", "x", "@gltf-transform/cli@4"]


def ktx_env() -> dict:
    env = dict(os.environ)
    if shutil.which("ktx") or shutil.which("toktx"):
        return env
    homes = [os.environ["KTX_HOME"]] if "KTX_HOME" in os.environ else sorted(
        glob.glob(os.path.expanduser("~/.local/opt/KTX-Software-*")))
    if not homes:
        sys.exit("KTX-Software not found: put it on PATH or set KTX_HOME")
    home = homes[-1]
    env["PATH"] = f"{home}/bin:{env.get('PATH', '')}"
    env["LD_LIBRARY_PATH"] = f"{home}/lib:{env.get('LD_LIBRARY_PATH', '')}"
    return env


def compress(model: Path, env: dict):
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "png.glb"
        subprocess.run([*GLTF_TRANSFORM, "png", str(model), str(png), "--formats", "*"], env=env, check=True,
                       capture_output=True)
        out = Path(tmp) / "ktx2.glb"
        subprocess.run([*GLTF_TRANSFORM, "uastc", str(png), str(out), "--level", "2", "--zstd", "18"], env=env,
                       check=True, capture_output=True)
        before = model.stat().st_size
        shutil.copyfile(out, model)
        print(f"{model}: {before / 1e6:.2f} MB -> {model.stat().st_size / 1e6:.2f} MB")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    env = ktx_env()
    for arg in sys.argv[1:]:
        compress(Path(arg), env)


if __name__ == "__main__":
    main()
