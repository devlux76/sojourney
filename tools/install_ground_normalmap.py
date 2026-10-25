"""Install the baked normal + sky-visibility data as streamed regional textures.

Validates tools/.cache/ground_normalmap/terrain_normal_ao.png, stages it as the source of
truth under assets/crater-lake/ground/, authors shared padded linear UASTC KTX2 regional crops
referenced by the ground leaves plus a small distant map, and rebuilds the pack index. Run after
changing the bake or the terrain leaf layout.

Usage: python3 tools/install_ground_normalmap.py [--bake]
       --bake runs tools/ground_normalmap.py first when the bake is missing or stale.
"""
import shutil
import subprocess
import sys
import time
import pathlib

from PIL import Image, ImageStat

ROOT = pathlib.Path(__file__).resolve().parent.parent
BAKE = ROOT / "tools/.cache/ground_normalmap/terrain_normal_ao.png"
STAGED = ROOT / "assets/crater-lake/ground/terrain_normal_ao.png"
OUT = ROOT / "public/packs/crater-lake/ground"
GROUND_JSON = OUT / "ground.json"
SIZE = 8192
BLOCK_TEXELS = 4
S = 18000.0 / SIZE
SIGN_CHECKS = (
    (4132, 5325, "south wall below rim", True),
    (4522, 2458, "north wall below Llao Rock", False),
)


def fail(message):
    raise SystemExit(message)


def bake_command():
    return ("uv run --quiet --with numpy --with scipy --with pillow python "
            "tools/ground_normalmap.py")


def validate(path):
    with Image.open(path) as im:
        if im.size != (SIZE, SIZE):
            fail(f"{path} is {im.size}, expected {(SIZE, SIZE)}")
        if im.mode != "RGB":
            fail(f"{path} is {im.mode}, expected RGB")
        if SIZE % BLOCK_TEXELS:
            fail(f"{SIZE} is not a whole number of {BLOCK_TEXELS}x{BLOCK_TEXELS} blocks")
        for col, row, label, positive in SIGN_CHECKS:
            window = im.crop((col - 22, row - 22, col + 23, row + 23))
            nz = ImageStat.Stat(window).mean[1] / 255.0 * 2.0 - 1.0
            ok = nz > 0 if positive else nz < 0
            want = "positive" if positive else "negative"
            print(f"sign check {label} at pixel ({row}, {col}): block nz = {nz:+.3f}, want {want} "
                  f"-> {'PASS' if ok else 'FAIL'}")
            if not ok:
                fail(f"{path} fails the {label} sign check; re-run {bake_command()}")


def run(*argv):
    subprocess.run([sys.executable, *map(str, argv)], check=True)


def main():
    started = time.time()
    if "--bake" in sys.argv or not BAKE.exists():
        if not BAKE.exists() and "--bake" not in sys.argv:
            fail(f"bake not found at {BAKE}; run: {bake_command()}")
        print(f"baking with: {bake_command()}")
        subprocess.run(bake_command().split(), check=True, cwd=ROOT)
    validate(BAKE)
    STAGED.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(BAKE, STAGED)
    print(f"staged {STAGED.relative_to(ROOT)}")
    if not GROUND_JSON.exists():
        fail(f"{GROUND_JSON.relative_to(ROOT)} not found; run tools/build_ground.py first")
    run(ROOT / "tools/tile_ground_normalmap.py", "--source", STAGED)
    run(ROOT / "tools/build_pack_index.py", "crater-lake")
    print("contract: R = nx (east), G = nz (north), B = sky visibility 0..1; "
          "rebuild ny = sqrt(saturate(1 - nx^2 - nz^2)); row 0 = north, col 0 = west; "
          "renormalise after filtering; see docs/specs/2026-10-02-ground-normal-ao-contract.md")
    print(f"installed in {time.time() - started:.1f} s")


if __name__ == "__main__":
    main()
