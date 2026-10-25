"""Author U19 relief from the registered USGS DS 716 lidar, then install its NME bake.

python3 tools/build_terrain_relief.py --prepare
Open /harness/terrainRelief.html on the Bun dev server and save the normal PNG.
python3 tools/build_terrain_relief.py --install <saved-terrain_relief_normal.png>

Height-to-normal conversion belongs to Babylon's NME graph, not Python or the game.
This tool removes the crop's large slope, makes its boundaries periodic, selects
metre-scale frequencies, and records the source registration and amplitude.
"""
import argparse
import base64
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from check_u19_relief import fill_voids

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "tools/.cache/ds716"
AUTHORING = ROOT / "assets/crater-lake/ground/relief"
GRAPHS = ROOT / "tools/materials/terrain-relief"
PACK = ROOT / "public/packs/crater-lake/ground"
TILE = 64
PIXELS = 512
CENTRE = (935, 3800)
TARGET_SLOPE_RMS = 0.35


def prepare():
    info = json.loads((SOURCE / "window1m.json").read_text())
    x0 = info["left"] + info["firstCol"] - info["origin"][0]
    zn0 = info["top"] - info["firstRow"] - info["origin"][1]
    col = round(CENTRE[0] - x0) - TILE // 2
    row = round(zn0 - CENTRE[1]) - TILE // 2
    window = np.load(SOURCE / "window1m.npy", mmap_mode="r")
    if not (0 <= col <= window.shape[1] - TILE and 0 <= row <= window.shape[0] - TILE):
        raise ValueError("Registered Llao crop is outside the lidar window")
    crop = fill_voids(np.asarray(window[row:row + TILE, col:col + TILE], dtype=np.float64))
    y, x = np.mgrid[:TILE, :TILE]
    design = np.column_stack((x.ravel(), y.ravel(), np.ones(TILE * TILE)))
    trend = design @ np.linalg.lstsq(design, crop.ravel(), rcond=None)[0]
    residual = crop - trend.reshape(crop.shape)
    # Separate the nonperiodic smooth component using boundary differences. This
    # prevents the crop's edges becoming invented fractures in a repeating tile.
    boundary = np.zeros_like(residual)
    boundary[0] = residual[-1] - residual[0]
    boundary[-1] = -boundary[0]
    boundary[:, 0] += residual[:, -1] - residual[:, 0]
    boundary[:, -1] -= residual[:, -1] - residual[:, 0]
    frequencies = np.fft.fftfreq(TILE)
    fy, fx = np.meshgrid(frequencies, frequencies, indexing="ij")
    denominator = 2 * np.cos(2 * np.pi * fx) + 2 * np.cos(2 * np.pi * fy) - 4
    denominator[0, 0] = 1
    smooth = np.fft.fft2(boundary) / denominator
    smooth[0, 0] = 0
    periodic = residual - np.fft.ifft2(smooth).real
    radius = np.hypot(fx, fy)
    spectrum = np.fft.fft2(periodic) * ((radius >= 1 / 16) & (radius <= 1 / 2))
    relief = np.fft.ifft2(spectrum).real
    dx = np.fft.ifft2(spectrum * (2j * np.pi * fx)).real
    dy = np.fft.ifft2(spectrum * (2j * np.pi * fy)).real
    slope_rms = float(np.sqrt(np.mean(dx * dx + dy * dy)))
    if not np.isfinite(slope_rms) or slope_rms <= 0:
        raise ValueError("Lidar crop has no finite relief slope")
    peak = float(np.max(np.abs(relief)))
    amplitude = 2 * peak * TARGET_SLOPE_RMS / slope_rms
    height = Image.fromarray(np.uint8(np.clip(0.5 + relief / (2 * peak), 0, 1) * 255 + 0.5))
    # The input keeps the source's 1 m sampling; bilinear sampling in NME supplies
    # subtexel interpolation. No high-resolution height signal is invented here.
    AUTHORING.mkdir(parents=True, exist_ok=True)
    height.save(AUTHORING / "terrain_relief_height.png")
    metadata = {"source": "USGS Data Series 716 (2012), registered 1 m lidar window",
                "centreWorldXZ": list(CENTRE), "sourceRow": row, "sourceColumn": col,
                "sourceSamples": TILE, "tileMetres": TILE, "normalPixels": PIXELS,
                "wavelengthMetres": [2, 16], "sourceSlopeRms": slope_rms,
                "targetSlopeRms": TARGET_SLOPE_RMS, "heightMetres": amplitude}
    (GRAPHS / "source.json").write_text(json.dumps(metadata, indent=2) + "\n")
    # Keep the image inside the portable NME exports so their editor previews work
    # without the ignored assets/ directory or a local HTTP image server.
    data_url = "data:image/png;base64," + base64.b64encode((AUTHORING / "terrain_relief_height.png").read_bytes()).decode()
    for name in ("normalBake", "materialPreview"):
        path = GRAPHS / f"{name}.json"
        graph = json.loads(path.read_text())
        amplitude_input = next(block for block in graph["blocks"] if block["name"] == "macroHeightMetres")
        amplitude_input["value"] = amplitude
        image_input = next(block for block in graph["blocks"] if block["name"] == "macroHeightSource")
        image_input["texture"] = {
            "name": "USGS DS716 Llao relief height", "url": data_url, "gammaSpace": False,
            "noMipmap": True, "invertY": False, "samplingMode": 2,
            "wrapU": 1, "wrapV": 1, "uScale": 1, "vScale": 1, "level": 1}
        path.write_text(json.dumps(graph, indent=2) + "\n")
    print(json.dumps(metadata, indent=2))
    print(f"Updated both NME exports: macroHeightMetres = {amplitude:.9f}; re-import to refresh live MCP sessions.")


def install(path):
    metadata = json.loads((GRAPHS / "source.json").read_text())
    with Image.open(path) as image:
        if image.size != (PIXELS, PIXELS):
            raise ValueError(f"Normal bake size {image.size}; expected {(PIXELS, PIXELS)}")
        rgb = np.asarray(image.convert("RGB"), dtype=np.float64)
        normal = rgb / 255 * 2 - 1
        length = np.linalg.norm(normal, axis=2)
        if np.max(np.abs(length - 1)) > 0.015 or normal[:, :, 2].min() <= 0:
            raise ValueError("Bake is not a unit tangent normal map with positive Z")
        if float(np.std(normal[:, :, :2])) < 0.03:
            raise ValueError("Bake has no useful relief; inspect image input and amplitude")
        staged = AUTHORING / "terrain_relief_normal.png"
        image.convert("RGB").save(staged)
    subprocess.run([sys.executable, str(ROOT / "tools/encode_ktx2.py"), "--linear",
                    str(PACK), str(staged)], check=True)
    # Two tangent normals need two signed XY pairs. Keep the micro normal in RG
    # and the medium-scale normal in BA, using the same BC7-sized texture binding.
    # Each pair is sampled at its own world repeat scale; positive Z is reconstructed
    # as in Babylon's native detail-normal shader (bumpFragment.js).
    micro_path = ROOT / "tools/.cache/ground_stage/rock_normal.png"
    with Image.open(micro_path) as micro, Image.open(staged) as macro:
        micro = micro.convert("RGB")
        macro = macro.convert("RGB").resize(micro.size, Image.Resampling.BILINEAR)
        packed = Image.merge("RGBA", (*micro.split()[:2], *macro.split()[:2]))
        packed_path = AUTHORING / "rock_normal_relief.png"
        packed.save(packed_path)
    subprocess.run([sys.executable, str(ROOT / "tools/encode_ktx2.py"), "--linear",
                    str(PACK), str(packed_path)], check=True)
    manifest_path = PACK / "ground.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["material"]["relief"] = {"normalUrl": "packs/crater-lake/ground/terrain_relief_normal.ktx2",
                                       "packedNormalUrl": "packs/crater-lake/ground/rock_normal_relief.ktx2",
                                       "tileMetres": metadata["tileMetres"]}
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    subprocess.run([sys.executable, str(ROOT / "tools/build_pack_index.py"), "crater-lake"], check=True)
    print(f"Installed NME normal bake; maximum normal length error {np.max(np.abs(length - 1)):.4f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--prepare", action="store_true")
    action.add_argument("--install", type=Path)
    args = parser.parse_args()
    if args.prepare:
        prepare()
    else:
        install(args.install)
