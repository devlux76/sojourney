import json
import struct

import numpy as np


def _pad(data, fill=b"\0"):
    return data + fill * (-len(data) % 4)


def write_glb(path, meshes):
    chunks, views, accessors, gltf_meshes, nodes = [], [], [], [], []
    offset = 0

    def add(array, target):
        nonlocal offset
        raw = _pad(array.tobytes())
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": array.nbytes, "target": target})
        chunks.append(raw)
        offset += len(raw)
        return len(views) - 1

    def accessor(array, target, component, kind, bounds=False):
        view = add(array, target)
        entry = {"bufferView": view, "componentType": component, "count": len(array), "type": kind}
        if bounds:
            entry["min"] = array.min(axis=0).tolist()
            entry["max"] = array.max(axis=0).tolist()
        accessors.append(entry)
        return len(accessors) - 1

    for m in meshes:
        attributes = {
            "POSITION": accessor(m["positions"].astype("<f4"), 34962, 5126, "VEC3", True),
            "NORMAL": accessor(m["normals"].astype("<f4"), 34962, 5126, "VEC3"),
        }
        if "uvs" in m:
            attributes["TEXCOORD_0"] = accessor(m["uvs"].astype("<f4"), 34962, 5126, "VEC2")
        index_type = "<u2" if len(m["positions"]) < 65535 else "<u4"
        indices = accessor(m["indices"].astype(index_type).reshape(-1), 34963,
                           5123 if index_type == "<u2" else 5125, "SCALAR")
        gltf_meshes.append({"name": m["name"], "primitives": [{"attributes": attributes, "indices": indices, "mode": 4}]})
        nodes.append({"name": m["name"], "mesh": len(gltf_meshes) - 1})

    document = {
        "asset": {"version": "2.0", "generator": "sojourney build_ground"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": gltf_meshes,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": offset}],
    }
    json_chunk = _pad(json.dumps(document, separators=(",", ":")).encode(), b" ")
    binary = b"".join(chunks)
    total = 12 + 8 + len(json_chunk) + 8 + len(binary)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(json_chunk), 0x4E4F534A) + json_chunk)
        f.write(struct.pack("<II", len(binary), 0x004E4942) + binary)
