import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

import flora_fetch as fetch
import flora_geometry as geo

TOOLS = Path(__file__).resolve().parent
WORK = fetch.CACHE.parent
SCRATCH = WORK / "scratch"
DUMP = WORK / "dump"
BLENDER = "/snap/bin/blender"

# Triangles per tree level. The second and third levels are light because a forest puts hundreds of
# them on screen at once (docs/specs/2026-10-02-forest-from-canopy-design.md, decision 2).
TREE_TOTAL = (30000, 4000, 450)
TREE_TRUNK = (4000, 1000, 150)
TREE_BRANCH = (3000, 400, 0)
SHRUB_TOTAL = (1500, 400)
ROCK_TOTAL = (3000, 800, 200)
PATCH_TOTAL = (6000, 1500, 300)
MARGIN = 20
TREE_TEXTURE = 2048
SMALL_TEXTURE = 1024
ATLAS_CELL = 1024


def run_dump(job, blend=None):
    outs = [Path(o["out"]) for o in job["outputs"]]
    if all(o.exists() for o in outs):
        return
    DUMP.mkdir(parents=True, exist_ok=True)
    SCRATCH.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(json.dumps(job, sort_keys=True).encode()).hexdigest()[:12]
    path = SCRATCH / f"job_{key}.json"
    path.write_text(json.dumps(job))
    cmd = [BLENDER, "--background"] + ([str(blend)] if blend else []) + ["--python", str(TOOLS / "flora_dump.py"), "--", str(path)]
    subprocess.run(cmd, check=True, capture_output=True)
    for o in outs:
        if not o.exists():
            raise RuntimeError(f"blender produced no {o}")


def read_corners(npz_path, prefix, mat_index):
    d = np.load(npz_path)
    c = geo.load(d, prefix)
    remap = np.array([mat_index.setdefault(str(n), len(mat_index)) if n else -1 for n in d["mat_names"]], np.int32)
    return geo.Corners(c.pos, c.nor, c.uv, remap[c.mat] if c.tris else c.mat)


def join(parts):
    parts = [p for p in parts if p.tris]
    return geo.Corners.concat(parts)


def ph_materials(gltf_path):
    g = json.loads(Path(gltf_path).read_text())
    root = Path(gltf_path).parent
    tex_path = lambda t: root / g["images"][g["textures"][t["index"]]["source"]]["uri"]
    out = {}
    for m in g["materials"]:
        pbr = m["pbrMetallicRoughness"]
        spec = {"base": tex_path(pbr["baseColorTexture"]), "normal": tex_path(m["normalTexture"]),
                "orm": tex_path(pbr["metallicRoughnessTexture"]), "transform": None}
        tr = pbr["baseColorTexture"].get("extensions", {}).get("KHR_texture_transform")
        if tr:
            spec["transform"] = (np.array(tr["offset"], np.float32), np.array(tr["scale"], np.float32))
        out[m["name"]] = spec
    return out


def load_rgb(path, size=None):
    im = Image.open(path).convert("RGB")
    if size and im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im)


def load_rgba(path, alpha_path, size=None):
    rgb = Image.open(path).convert("RGB")
    a = Image.open(alpha_path)
    a = Image.fromarray((np.asarray(a) >> 8).astype(np.uint8)) if a.mode.startswith("I") else a.convert("L")
    if size and rgb.size[0] != size:
        rgb, a = rgb.resize((size, size), Image.LANCZOS), a.resize((size, size), Image.LANCZOS)
    return np.dstack([np.asarray(rgb), np.asarray(a)])


def fetch_tree(asset):
    blend = fetch.fetch_blend(asset, textures=False)
    entry = fetch.files_index(asset)["blend"]["4k"]["blend"]["include"][f"textures/{asset}_twig_alpha_4k.png"]
    fetch.download(entry, fetch.CACHE / asset / "blend" / f"textures/{asset}_twig_alpha_4k.png")
    gltf = fetch.fetch_gltf(asset, geometry=False)
    return blend, gltf


def tree_levels(asset, variant):
    blend, _ = fetch_tree(asset)
    obj = f"{asset}_{variant}_LOD2"
    outs = [DUMP / f"{asset}_{variant}_t{k}.npz" for k in range(3)]
    run_dump({"foliage": "twig", "decimate": "trunk", "origin": "object", "object": obj,
              "outputs": [{"out": str(o), "target": t} for o, t in zip(outs, TREE_TRUNK)]}, blend)
    mats = {}
    branch, fol = (read_corners(outs[0], p, mats) for p in ("branch", "foliage"))
    trunks = [read_corners(o, "solid", mats) for o in outs]
    branches = [geo.thin_islands(branch, b) if (b and branch.tris) else empty_corners() for b in TREE_BRANCH]
    quads = geo.QuadSet(fol)
    foliage = []
    for k in range(3):
        budget = TREE_TOTAL[k] - MARGIN - trunks[k].tris - branches[k].tris
        if k == 0 and fol.tris <= budget * 1.6:
            f, s = geo.thin(fol, budget)
        else:
            f, s = quads.select(budget, 4.5 if k == 2 else 3.0)
        foliage.append((f, s))
    levels = [join([trunks[k], branches[k], foliage[k][0]]) for k in range(3)]
    return levels, list(mats), {"foliage_scale": [float(s) for _, s in foliage]}


def sample_region(path, lo, hi, n):
    im = Image.open(path).convert("RGB")
    span = hi - lo
    su, sv = int(min(4096, np.ceil(n / span[0]))), int(min(4096, np.ceil(n / span[1])))
    if (su, sv) != im.size:
        im = im.resize((su, sv), Image.LANCZOS)
    xs = np.floor(((lo[0] + (np.arange(n) + 0.5) / n * span[0]) % 1.0) * su).astype(int)
    ys = np.floor(((lo[1] + (np.arange(n) + 0.5) / n * span[1]) % 1.0) * sv).astype(int)
    return np.asarray(im)[ys][:, xs]


def empty_corners():
    return geo.Corners(np.zeros((0, 3)), np.zeros((0, 3)), np.zeros((0, 2)), np.zeros(0, np.int32))


def tree_file(asset, prefix, variants):
    gltf = fetch.fetch_gltf(asset, geometry=False)
    specs = ph_materials(gltf)
    bark_tr = specs[f"{asset}_bark"]["transform"]
    per = {v: tree_levels(asset, v) for v in variants}
    regions = {}
    effective = {}

    def region_of(name):
        sp = specs[name]
        tr = bark_tr if "dead_branches" in name else sp["transform"]
        key = (str(sp["base"]), None if tr is None else (tuple(map(float, tr[0])), tuple(map(float, tr[1]))))
        return key, sp, tr

    ranges = {}
    for v, (levels, mats, _) in per.items():
        for corners in levels:
            for mi, name in enumerate(mats):
                if "twig" in name:
                    continue
                sel = corners.mat == mi
                if not sel.any():
                    continue
                key, sp, tr = region_of(name)
                uv = corners.take(sel).uv
                if tr is not None:
                    uv = tr[0] + tr[1] * uv
                lo, hi = uv.min(0), uv.max(0)
                old = ranges.get(key)
                ranges[key] = (lo, hi, sp) if old is None else (np.minimum(old[0], lo), np.maximum(old[1], hi), sp)
    keys = list(ranges)
    assert len(keys) <= 4, keys
    atlas = {m: np.zeros((2 * ATLAS_CELL, 2 * ATLAS_CELL, 3), np.uint8) for m in ("base", "normal", "orm")}
    placement = {}
    for i, key in enumerate(keys):
        lo, hi, sp = ranges[key]
        pad = (hi - lo) * 0.002 + 1e-6
        lo, hi = lo - pad, hi + pad
        ox, oy = (i % 2) * ATLAS_CELL, (i // 2) * ATLAS_CELL
        for m, field in (("base", "base"), ("normal", "normal"), ("orm", "orm")):
            atlas[m][oy:oy + ATLAS_CELL, ox:ox + ATLAS_CELL] = sample_region(sp[field], lo, hi, ATLAS_CELL)
        placement[key] = (lo, hi, np.array([ox, oy]) / (2.0 * ATLAS_CELL))
    twig = specs[f"{asset}_twig"]
    twig_alpha = fetch.CACHE / asset / "blend" / "textures" / f"{asset}_twig_alpha_4k.png"
    materials = {
        f"{asset}_wood": {"base": atlas["base"], "normal": atlas["normal"], "orm": atlas["orm"]},
        f"{asset}_foliage": {"base": load_rgba(twig["base"], twig_alpha, TREE_TEXTURE),
                             "normal": load_rgb(twig["normal"], TREE_TEXTURE),
                             "orm": load_rgb(twig["orm"], TREE_TEXTURE), "mask": True},
    }
    out = {}
    for v, (levels, mats, info) in per.items():
        lvls = []
        for corners in levels:
            wood_parts, fol = [], empty_corners()
            for mi, name in enumerate(mats):
                sel = corners.mat == mi
                if not sel.any():
                    continue
                part = corners.take(sel)
                if "twig" in name:
                    fol = geo.Corners(part.pos, part.nor, part.uv, np.full(part.tris, 1, np.int32))
                    continue
                key, sp, tr = region_of(name)
                uv = part.uv if tr is None else tr[0] + tr[1] * part.uv
                lo, hi, org = placement[key]
                wood_parts.append(geo.Corners(part.pos, part.nor, org + (uv - lo) / (hi - lo) / 2.0,
                                              np.zeros(part.tris, np.int32)))
            lvls.append([(f"{asset}_wood", join(wood_parts)), (f"{asset}_foliage", fol)])
        out[f"{prefix}_{v}"] = {"levels": lvls, "corners": levels, "mats": mats, "info": info}
    return out, materials


def shrub_levels():
    gltf = fetch.fetch_gltf("shrub_04")
    alpha = fetch.CACHE / "shrub_04" / "blend" / "textures" / "shrub_04_alpha_4k.png"
    fetch.fetch_blend("shrub_04", textures=False)
    fetch.download(fetch.files_index("shrub_04")["blend"]["4k"]["blend"]["include"]["textures/shrub_04_alpha_4k.png"], alpha)
    out = DUMP / "shrub_src.npz"
    run_dump({"gltf": str(gltf), "foliage": "shrub_04", "normalise": {"longest": 1.0},
              "outputs": [{"out": str(out), "target": -1}]})
    mats = {}
    fol = read_corners(out, "foliage", mats)
    quads = geo.QuadSet(fol)
    l0, s0 = quads.select(SHRUB_TOTAL[0] - MARGIN)
    l1, s1 = quads.select(SHRUB_TOTAL[1] - MARGIN, 4.0)
    spec = ph_materials(gltf)["shrub_04"]
    material = {"base": load_rgba(spec["base"], alpha, SMALL_TEXTURE), "normal": load_rgb(spec["normal"], SMALL_TEXTURE),
                "orm": load_rgb(spec["orm"], SMALL_TEXTURE), "mask": True}
    return [l0, l1], material, {"foliage_scale": [float(s0), float(s1)]}


def rock_levels(asset, longest, pick, patch):
    gltf = fetch.fetch_gltf(asset)
    totals = PATCH_TOTAL if patch else ROCK_TOTAL
    outs = [DUMP / f"rock_{asset}_{pick or 'x'}_{longest}_{k}_{totals[k]}.npz" for k in range(3)]
    run_dump({"gltf": str(gltf), "pick": pick, "normalise": {"longest": longest},
              "outputs": [{"out": str(o), "target": t, "merge": True} for o, t in zip(outs, totals)]})
    mats = {}
    levels = []
    for path in outs:
        c = read_corners(path, "solid", mats)
        levels.append(geo.Corners(c.pos, geo.smooth_normals(c.pos), c.uv, np.zeros(c.tris, np.int32)))
    spec = ph_materials(gltf)[list(mats)[0]]
    material = {"base": load_rgb(spec["base"], SMALL_TEXTURE), "normal": load_rgb(spec["normal"], SMALL_TEXTURE),
                "orm": load_rgb(spec["orm"], SMALL_TEXTURE)}
    return levels, material


def write_model(path, meshes, materials, compressed):
    from flora_glb import Glb
    glb = Glb(compressed)
    ids = {}
    for key, m in materials.items():
        ids[key] = glb.material(
            key, base_tex=glb.texture(f"{key}_base", m["base"], True),
            normal_tex=glb.texture(f"{key}_normal", m["normal"], False),
            orm_tex=glb.texture(f"{key}_orm", m["orm"], False) if m.get("orm") is not None else None,
            base_factor=(*m.get("factor", (1.0, 1.0, 1.0)), 1.0), mask=m.get("mask", False))
    for names, prims in meshes:
        out = []
        for key, corners in prims:
            if not corners.tris:
                continue
            pos, nor, uv, idx = geo.indexed(corners)
            out.append((ids[key], pos, nor, uv, idx))
        glb.mesh(names, out)
    glb.finish(path)


CARD_DARKEN = 0.82
CARD_VIEWS = 3
DILATE_PASSES = 12
CARD_MAX = 1024


def dilate(rgb, valid, passes=DILATE_PASSES):
    rgb = rgb.astype(np.float32)
    valid = valid.copy()
    for _ in range(passes):
        if valid.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(valid.shape, np.float32)
        w = valid.astype(np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                acc += np.roll(rgb * w[..., None], (dy, dx), (0, 1))
                cnt += np.roll(w, (dy, dx), (0, 1))
        fill = (~valid) & (cnt > 0)
        rgb[fill] = acc[fill] / cnt[fill][:, None]
        valid |= fill
    return rgb


def build_card(preview_glb, species, corners):
    pos = corners.pos
    height = float(pos[:, 1].max())
    radius = float(np.hypot(pos[:, 0], pos[:, 2]).max())
    tall = height > 2 * radius
    if tall:
        tile_w, tile_h = (CARD_MAX // CARD_VIEWS) // 4 * 4, CARD_MAX
    else:
        tile_w, tile_h = CARD_MAX, (CARD_MAX // CARD_VIEWS) // 4 * 4
    out = SCRATCH / f"card_{species}"
    SCRATCH.mkdir(parents=True, exist_ok=True)
    cmd = [BLENDER, "--background", "--python", str(TOOLS / "flora_render.py"), "--", "card", str(preview_glb), str(out),
           json.dumps({"tile_w": tile_w, "tile_h": tile_h, "views": CARD_VIEWS, "prefix": species})]
    subprocess.run(cmd, check=True, capture_output=True)
    meta = json.loads(Path(f"{out}_card.json").read_text())
    aw, ah = (tile_w * CARD_VIEWS, tile_h) if tall else (tile_w, tile_h * CARD_VIEWS)
    albedo = np.zeros((ah, aw, 4), np.uint8)
    normal = np.zeros((ah, aw, 3), np.uint8)
    for i in range(CARD_VIEWS):
        a = np.asarray(Image.open(f"{out}_albedo_{i}.png").convert("RGBA"))
        n = np.asarray(Image.open(f"{out}_normal_{i}.png").convert("RGBA"))
        sl = (slice(None), slice(i * tile_w, (i + 1) * tile_w)) if tall else (slice(i * tile_h, (i + 1) * tile_h), slice(None))
        albedo[sl] = a
        normal[sl] = n[..., :3]
    valid = albedo[..., 3] > 127
    albedo[..., :3] = np.clip(dilate(albedo[..., :3], valid) * CARD_DARKEN, 0, 255).astype(np.uint8)
    normal = dilate(normal, valid)
    vec = normal / 255.0 * 2 - 1
    vec[..., 2] = np.abs(vec[..., 2])
    vec /= np.maximum(np.linalg.norm(vec, axis=2, keepdims=True), 1e-6)
    normal = np.clip((vec * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8)
    cp, cn, cu, ci = [], [], [], []
    for i in range(CARD_VIEWS):
        theta = np.pi * i / CARD_VIEWS
        h = np.array([np.cos(theta), 0, np.sin(theta)])
        n = np.array([-np.sin(theta), 0, np.cos(theta)])
        w, ht = meta["width_m"] / 2, meta["height_m"]
        corner = [-h * w, h * w, h * w + [0, ht, 0], -h * w + [0, ht, 0]]
        if tall:
            u0, u1, v0, v1 = i / CARD_VIEWS, (i + 1) / CARD_VIEWS, 0.0, 1.0
        else:
            u0, u1, v0, v1 = 0.0, 1.0, i / CARD_VIEWS, (i + 1) / CARD_VIEWS
        base = len(cp)
        cp += corner
        cn += [n] * 4
        cu += [(u0, v1), (u1, v1), (u1, v0), (u0, v0)]
        ci += [[base, base + 1, base + 2], [base, base + 2, base + 3]]
    corners_card = geo.Corners(np.array(cp, np.float32)[np.array(ci).ravel()], np.array(cn, np.float32)[np.array(ci).ravel()],
                               np.array(cu, np.float32)[np.array(ci).ravel()], np.zeros(len(ci), np.int32))
    return {"albedo": albedo, "normal": normal, "corners": corners_card, "meta": meta}
