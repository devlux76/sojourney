"""Encode source images as KTX2: Basis Universal UASTC, Zstandard-supercompressed, with mipmaps,
so they stay compressed on the GPU (BC7/ASTC) — about a quarter of the VRAM of a JPEG/PNG.
Colour maps are sRGB; normal and AO maps are linear data. UASTC is the near-lossless mode, without
RDO: quality first, larger downloads accepted. Alpha is kept where the source has it, which is what
an alpha-cutout leaf or an impostor sprite needs.

The sources stay in assets/<pack>/ (not shipped); this encodes them into public/packs/<pack>/.
Then rebuild the pack index: python3 tools/build_pack_index.py <pack-id>

Usage:
    python3 tools/encode_ktx2.py [--colour|--linear] <out-dir> <image> [<image> ...]
    python3 tools/encode_ktx2.py public/packs/crater-lake/terrain assets/crater-lake/terrain/*.jpg
    python3 tools/encode_ktx2.py --colour public/packs/crater-lake/models/trees/impostors \
        assets/crater-lake/impostors/*.png
"""
import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

from compress_textures import ktx_env

COLOUR_SUFFIXES = ("_diff", "_basecolor", "_albedo")
LINEAR_SUFFIXES = ("_normal", "_roughness", "_metalness", "_ao", "_orm", "_opacity")
BLOCK_TEXELS = 4


def check_block_aligned(im: Image.Image, src: Path):
    width, height = im.size
    if width % BLOCK_TEXELS or height % BLOCK_TEXELS:
        sys.exit(f"{src} is {width}x{height}, which is not a whole number of {BLOCK_TEXELS}x"
                 f"{BLOCK_TEXELS} blocks, so it can never reach the GPU. Snap whatever produced it "
                 f"to a block multiple — BLOCK_TEXELS in src/world/TreeImpostor.ts, for a baked view "
                 f"— and generate it again.")


def transfer_for(stem: str, colour: bool | None) -> bool:
    if colour is not None:
        return colour
    if any(k in stem for k in LINEAR_SUFFIXES):
        return False
    return any(k in stem for k in COLOUR_SUFFIXES)


def encode(src: Path, out_dir: Path, env: dict, colour: bool | None, no_alpha: bool = False):
    out = out_dir / f"{src.stem}.ktx2"
    colour_data = transfer_for(src.stem, colour)
    with Image.open(src) as im:
        check_block_aligned(im, src)
        has_alpha = im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info)
        if no_alpha:
            has_alpha = False
            im = im.convert("RGB")
        if has_alpha:
            fmt, tf = ("R8G8B8A8_SRGB", "srgb") if colour_data else ("R8G8B8A8_UNORM", "linear")
            pixels = im.convert("RGBA")
        else:
            fmt, tf = ("R8G8B8_SRGB", "srgb") if colour_data else ("R8G8B8_UNORM", "linear")
            pixels = im.convert("RGB")
        with tempfile.TemporaryDirectory() as tmp:
            flipped = Path(tmp) / "flipped.png"
            pixels.transpose(Image.Transpose.FLIP_TOP_BOTTOM).save(flipped)
            subprocess.run(["ktx", "create", "--format", fmt, "--assign-tf", tf,
                            "--encode", "uastc", "--uastc-quality", "2",
                            "--zstd", "18", "--generate-mipmap", str(flipped), str(out)],
                           env=env, check=True)
    print(f"{src} -> {out}: {src.stat().st_size / 1e3:.0f} kB -> {out.stat().st_size / 1e3:.0f} kB"
          f"  ({'sRGB' if colour_data else 'linear'}{', RGBA' if has_alpha else ''})")


def main():
    parser = argparse.ArgumentParser(add_help=True, description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--colour", dest="colour", action="store_true", default=None,
                       help="force sRGB (albedo/diffuse/base colour)")
    group.add_argument("--linear", dest="colour", action="store_false",
                       help="force linear (normal/AO/roughness/metalness)")
    parser.add_argument("--no-alpha", action="store_true",
                       help="drop the alpha channel; for a map whose silhouette another texture "
                            "already carries on the same UVs, such as an impostor's normal map")
    parser.add_argument("out_dir", help="directory to write the .ktx2 files into")
    parser.add_argument("image", nargs="*", help="source images")
    args = parser.parse_args()
    if len(args.out_dir) < 1 or not args.image:
        sys.exit(__doc__)
    env = ktx_env()
    out_dir = Path(args.out_dir)
    for arg in args.image:
        encode(Path(arg), out_dir, env, args.colour, args.no_alpha)


if __name__ == "__main__":
    main()