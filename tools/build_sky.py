import gzip
import pathlib
import shutil
import struct
import urllib.request

from PIL import Image

CACHE = pathlib.Path("tools/.cache")
OUT = pathlib.Path("public/sky")
CATALOGUE_URL = "https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz"
MILKY_WAY_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_4k_print.jpg"
MOON_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_1k.jpg"
DEFAULT_B_V = 0.6


def fetch(url: str) -> pathlib.Path:
    path = CACHE / url.rsplit("/", 1)[1]
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        print(f"downloading {url}")
        urllib.request.urlretrieve(url, path)
    return path


def parse(line: str):
    if not line[75:77].strip() or not line[102:107].strip():
        return None
    ra = (int(line[75:77]) + int(line[77:79]) / 60 + float(line[79:83]) / 3600) * 15
    dec = int(line[84:86]) + int(line[86:88]) / 60 + int(line[88:90]) / 3600
    if line[83] == "-":
        dec = -dec
    b_v = float(line[109:114]) if line[109:114].strip() else DEFAULT_B_V
    return int(line[0:4]), ra, dec, float(line[102:107]), b_v


def build_stars():
    lines = gzip.open(fetch(CATALOGUE_URL), "rt", encoding="latin-1").read().splitlines()
    stars = {s[0]: s for s in map(parse, lines) if s}
    _, ra, dec, vmag, _ = stars[2491]
    assert abs(ra - 101.287) < 0.01 and abs(dec + 16.716) < 0.01 and abs(vmag + 1.46) < 0.01, stars[2491]
    assert abs(stars[424][2] - 89.264) < 0.01, stars[424]
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "stars.bin", "wb") as f:
        for _, ra, dec, vmag, b_v in stars.values():
            f.write(struct.pack("<4f", ra, dec, vmag, b_v))
    print(f"{len(stars)} stars")


def brightness(im: Image.Image, ra: float, dec: float) -> float:
    w, h = im.size
    x = int(((0.5 - ra / 360) % 1) * w)
    y = int((0.5 - dec / 180) * h)
    pixels = [im.getpixel(((x + dx) % w, min(h - 1, max(0, y + dy)))) for dx in range(-20, 21, 5) for dy in range(-20, 21, 5)]
    return sum(pixels) / len(pixels)


def build_textures():
    milky_way = fetch(MILKY_WAY_URL)
    grey = Image.open(milky_way).convert("L")
    centre = brightness(grey, 266.4, -28.9)
    pole = brightness(grey, 192.86, 27.13)
    assert centre > 5 * pole, f"Milky Way layout is not RA-left/north-up: centre {centre}, pole {pole}"
    shutil.copy(milky_way, OUT / "milkyway.jpg")
    shutil.copy(fetch(MOON_URL), OUT / "moon.jpg")


if __name__ == "__main__":
    build_stars()
    build_textures()
