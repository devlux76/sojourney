import hashlib
import json
import os
import struct
import subprocess
import shutil
import glob
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

CACHE = Path(__file__).resolve().parent / ".cache" / "flora"
KTX_CACHE = CACHE / "ktx"
PNG_CACHE = CACHE / "png"


def ktx_env():
    env = dict(os.environ)
    if shutil.which("ktx"):
        return env
    home = sorted(glob.glob(os.path.expanduser("~/.local/opt/KTX-Software-*")))[-1]
    env["PATH"] = f"{home}/bin:{env.get('PATH', '')}"
    env["LD_LIBRARY_PATH"] = f"{home}/lib:{env.get('LD_LIBRARY_PATH', '')}"
    return env


def image_key(arr, tag):
    h = hashlib.sha1(np.ascontiguousarray(arr).tobytes())
    h.update(str(arr.shape).encode())
    h.update(tag.encode())
    return h.hexdigest()[:20]


def encode_ktx2(arr, srgb):
    KTX_CACHE.mkdir(parents=True, exist_ok=True)
    PNG_CACHE.mkdir(parents=True, exist_ok=True)
    channels = arr.shape[2]
    key = image_key(arr, f"{'srgb' if srgb else 'lin'}{channels}")
    out = KTX_CACHE / f"{key}.ktx2"
    if out.exists():
        return out.read_bytes()
    src = PNG_CACHE / f"{key}.png"
    Image.fromarray(arr, "RGBA" if channels == 4 else "RGB").save(src)
    fmt = ("R8G8B8A8" if channels == 4 else "R8G8B8") + ("_SRGB" if srgb else "_UNORM")
    tmp = out.with_suffix(".part")
    subprocess.run(["ktx", "create", "--format", fmt, "--assign-tf", "srgb" if srgb else "linear",
                    "--encode", "uastc", "--uastc-quality", "2", "--zstd", "18", "--generate-mipmap",
                    str(src), str(tmp)], env=ktx_env(), check=True, capture_output=True)
    tmp.rename(out)
    src.unlink()
    return out.read_bytes()


def encode_all(jobs):
    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(lambda j: encode_ktx2(*j), jobs))


def pad4(data, fill=b"\0"):
    return data + fill * (-len(data) % 4)


class Glb:
    def __init__(self, compressed):
        self.compressed = compressed
        self.bin = bytearray()
        self.views, self.accessors, self.images, self.textures = [], [], [], []
        self.materials, self.meshes, self.nodes = [], [], []
        self.image_slots = {}
        self.pending = []

    def view(self, data, target=None):
        self.bin += b"\0" * (-len(self.bin) % 4)
        v = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target:
            v["target"] = target
        self.bin += data
        self.views.append(v)
        return len(self.views) - 1

    def accessor(self, arr, kind, target, bounds=False):
        arr = np.ascontiguousarray(arr)
        ctype = {np.dtype("float32"): 5126, np.dtype("uint32"): 5125, np.dtype("uint16"): 5123}[arr.dtype]
        count = arr.shape[0]
        a = {"bufferView": self.view(arr.tobytes(), target), "componentType": ctype, "count": count, "type": kind}
        if bounds:
            a["min"] = [float(x) for x in arr.min(0)]
            a["max"] = [float(x) for x in arr.max(0)]
        self.accessors.append(a)
        return len(self.accessors) - 1

    def texture(self, name, arr, srgb):
        key = (name, srgb)
        if key in self.image_slots:
            return self.image_slots[key]
        self.images.append({"name": name})
        self.textures.append({"sampler": 0})
        slot = len(self.images) - 1
        self.pending.append((slot, arr, srgb))
        self.image_slots[key] = slot
        return slot

    def material(self, name, base_tex=None, normal_tex=None, orm_tex=None, base_factor=(1, 1, 1, 1),
                 mask=False, roughness=1.0):
        pbr = {"baseColorFactor": [float(x) for x in base_factor], "metallicFactor": 0.0, "roughnessFactor": roughness}
        m = {"name": name, "pbrMetallicRoughness": pbr, "doubleSided": True}
        if base_tex is not None:
            pbr["baseColorTexture"] = {"index": base_tex}
        if orm_tex is not None:
            pbr["metallicFactor"] = 1.0
            pbr["metallicRoughnessTexture"] = {"index": orm_tex}
            m["occlusionTexture"] = {"index": orm_tex}
            pbr["roughnessFactor"] = 1.0
        if normal_tex is not None:
            m["normalTexture"] = {"index": normal_tex}
        if mask:
            m["alphaMode"] = "MASK"
            m["alphaCutoff"] = 0.5
        self.materials.append(m)
        return len(self.materials) - 1

    def mesh(self, names, primitives):
        prims = []
        for material, pos, nor, uv, idx in primitives:
            idx = idx.ravel().astype(np.uint32)
            prims.append({
                "attributes": {
                    "POSITION": self.accessor(pos.astype(np.float32), "VEC3", 34962, True),
                    "NORMAL": self.accessor(nor.astype(np.float32), "VEC3", 34962),
                    "TEXCOORD_0": self.accessor(uv.astype(np.float32), "VEC2", 34962),
                },
                "indices": self.accessor(idx, "SCALAR", 34963),
                "material": material,
            })
        self.meshes.append({"name": names[0], "primitives": prims})
        for name in names:
            self.nodes.append({"name": name, "mesh": len(self.meshes) - 1})

    def finish(self, path):
        if self.compressed:
            jobs = [(arr, srgb) for _, arr, srgb in self.pending]
            blobs = encode_all(jobs)
            mime = "image/ktx2"
        else:
            blobs = []
            for _, arr, srgb in self.pending:
                import io
                buf = io.BytesIO()
                Image.fromarray(arr, "RGBA" if arr.shape[2] == 4 else "RGB").save(buf, "PNG")
                blobs.append(buf.getvalue())
            mime = "image/png"
        for (slot, _, _), blob in zip(self.pending, blobs):
            self.images[slot]["bufferView"] = self.view(blob)
            self.images[slot]["mimeType"] = mime
        for slot, tex in enumerate(self.textures):
            if self.compressed:
                tex["extensions"] = {"KHR_texture_basisu": {"source": slot}}
            else:
                tex["source"] = slot
        gltf = {
            "asset": {"version": "2.0", "generator": "sojourney build_flora"},
            "scene": 0,
            "scenes": [{"nodes": list(range(len(self.nodes)))}],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "materials": self.materials,
            "accessors": self.accessors,
            "bufferViews": self.views,
            "buffers": [{"byteLength": len(self.bin)}],
        }
        if self.images:
            gltf["images"] = self.images
            gltf["textures"] = self.textures
            gltf["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
        if self.compressed and self.images:
            gltf["extensionsUsed"] = ["KHR_texture_basisu"]
            gltf["extensionsRequired"] = ["KHR_texture_basisu"]
        js = pad4(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
        binary = pad4(bytes(self.bin))
        total = 12 + 8 + len(js) + 8 + len(binary)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, total))
            f.write(struct.pack("<II", len(js), 0x4E4F534A))
            f.write(js)
            f.write(struct.pack("<II", len(binary), 0x004E4942))
            f.write(binary)
