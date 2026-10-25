import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import flora_fetch as fetch
import flora_geometry as geo
import flora_models as models
import flora_place as place

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "packs" / "crater-lake" / "flora"
WORK = fetch.CACHE.parent
PREVIEW_GLB = WORK / "preview_glb"
PREVIEWS = ROOT / "tools" / ".cache" / "previews"
URL_BASE = "packs/crater-lake/flora/"
SEAWEED_TINT = (0.55, 0.9, 0.7)

# The camera distance beyond which each next level is drawn. Trees, shrubs and water plants are their
# cards (the last level) until the player is almost touching them; rocks have no card.
LOD_DISTANCES = {"tree": [8.0, 16.0, 30.0], "shrub": [6.0, 15.0], "waterPlant": [6.0, 15.0], "rock": [20.0, 60.0]}

TREE_SOURCES = {
    "fir_tree_01_a.glb": ("fir_a", "fir_tree_01", "a"), "fir_tree_01_b.glb": ("fir_b", "fir_tree_01", "b"),
    "pine_tree_01_a.glb": ("pine_a", "pine_tree_01", "a"),
    "pine_tree_01_b.glb": ("pine_b", "pine_tree_01", "b"), "pine_tree_01_c.glb": ("pine_c", "pine_tree_01", "c"),
}
ROCK_SOURCES = {
    "rock_07.glb": ("rock_07", None), "namaqualand_boulder_02.glb": ("namaqualand_boulder_02", None),
    "namaqualand_boulder_03.glb": ("namaqualand_boulder_03", None), "namaqualand_boulder_04.glb": ("namaqualand_boulder_04", None),
    "namaqualand_boulder_06.glb": ("namaqualand_boulder_06", None), "boulder_01.glb": ("boulder_01", None),
    "coast_land_rocks_04.glb": ("coast_land_rocks_04", None), "sand_rocks_small_01.glb": ("sand_rocks_small_01", None),
    "rock_boulder.glb": ("moon_rock_01", "moon_rock_01_LOD0"), "rock_pebble.glb": ("moon_rock_03", None),
}
ROCK_LONGEST = {"rock_patch": None, "pumice_patch": None, "rock_pebble": 0.3}
NO_SHADOWS = {"shrub", "seaweed", "rock_patch", "pumice_patch", "rock_boulder", "rock_pebble"}
PATCHES = {"rock_patch", "pumice_patch"}


def species_name(entry, variant):
    if entry["id"] == "tree":
        return TREE_SOURCES[Path(entry["variants"][variant]).name][0]
    if entry["id"] in ("shrub", "seaweed"):
        return entry["id"]
    return f"{entry['id']}_{variant}"


def species_list(flora):
    out = []
    for entry in flora:
        for v, url in enumerate(entry["variants"]):
            name = species_name(entry, v)
            kind = {"tree": "tree", "shrub": "shrub", "seaweed": "waterPlant"}.get(entry["id"], "rock")
            out.append({"name": name, "entry": entry, "variant": v, "url": url, "kind": kind})
    return out


def tint_code(tint):
    return "".join(f"{int(round(c * 100)):02d}" for c in tint)


def card_for(species, preview_glb, corners):
    digest = hashlib.sha1(Path(preview_glb).read_bytes()).hexdigest()[:16]
    cache = WORK / f"card_{species}_{digest}.npz"
    if cache.exists():
        d = np.load(cache, allow_pickle=True)
        c = d["corners"]
        return {"albedo": d["albedo"], "normal": d["normal"], "meta": json.loads(str(d["meta"])),
                "corners": geo.Corners(d["cpos"], d["cnor"], d["cuv"], d["cmat"])}
    card = models.build_card(preview_glb, species, corners)
    cc = card["corners"]
    np.savez(cache, albedo=card["albedo"], normal=card["normal"], meta=json.dumps(card["meta"]), corners=0,
             cpos=cc.pos, cnor=cc.nor, cuv=cc.uv, cmat=cc.mat)
    return card


def render_previews(species, glb):
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    subprocess.run([models.BLENDER, "--background", "--python", str(models.TOOLS / "flora_render.py"), "--", "preview",
                    str(glb), str(PREVIEWS / species), json.dumps({"px": 900, "prefix": species})], check=True,
                   capture_output=True)


def tree_collider(corners, mats):
    trunk = next(i for i, n in enumerate(mats) if "trunk" in n)
    pos = corners.take(corners.mat == trunk).pos
    band = pos[(pos[:, 1] > 1.0) & (pos[:, 1] < 2.0)]
    radius = float(np.percentile(np.hypot(band[:, 0], band[:, 2]), 90)) if len(band) else 0.4
    return {"radius": round(radius, 3), "height": round(float(pos[:, 1].max()), 3)}


# The longest side of a model's bounding box, its height above its origin, and its ground footprint, in
# metres at scale 1. tools/build_forest.py scales trees to their measured height and gives the engine each
# species' size; it also needs the footprint to fit the ground under a rock patch (ISSUES.md P3).
def extent(corners):
    pos = corners.pos
    span = pos.max(0) - pos.min(0)
    return {"size": round(float(span.max()), 3), "height": round(float(pos[:, 1].max()), 3),
            "footprint": [round(float(span[0]), 3), round(float(span[2]), 3)]}


def tri_total(prims):
    return sum(c.tris for _, c in prims)


def build_trees(stats, only):
    # Fir variant C is retired: the fir is authored from variants A/B only while the pine keeps
    # A/B/C. Names follow the chosen variants so the manifest never lists a missing species.
    for asset, prefix, variants in (("fir_tree_01", "fir", "ab"), ("pine_tree_01", "pine", "abc")):
        names = [f"{prefix}_{v}" for v in variants]
        if only and not only & set(names + [prefix]):
            continue
        t0 = time.time()
        built, materials = models.tree_file(asset, prefix, variants)
        PREVIEW_GLB.mkdir(parents=True, exist_ok=True)
        meshes = [([f"{sp}_LOD{k}"], lvl) for sp, b in built.items() for k, lvl in enumerate(b["levels"])]
        base = PREVIEW_GLB / f"{prefix}_levels.glb"
        models.write_model(base, meshes, materials, False)
        for sp, b in built.items():
            card = card_for(sp, base, b["corners"][0])
            materials[f"card_{sp}"] = {"base": card["albedo"], "normal": card["normal"], "mask": True}
            meshes.append(([f"{sp}_LOD3"], [(f"card_{sp}", card["corners"])]))
            b["card_tris"] = card["corners"].tris
        base.unlink()
        preview = PREVIEW_GLB / f"{prefix}.glb"
        models.write_model(preview, meshes, materials, False)
        for sp in built:
            render_previews(sp, preview)
        models.write_model(OUT / f"{prefix}.glb", meshes, materials, True)
        for sp, b in built.items():
            stats[sp] = {"file": f"{prefix}.glb", "levels": [tri_total(l) for l in b["levels"]] + [b["card_tris"]],
                         "collider": tree_collider(b["corners"][0], b["mats"]), "info": b["info"],
                         **extent(b["corners"][0])}
        if prefix == "fir":
            # Drop the retired variant's measurements when the fir is (re)authored, so a stale
            # fir_c entry cannot linger in species_stats.json after variant C is gone.
            stats.pop("fir_c", None)
        print(f"{prefix}: {[stats[s]['levels'] for s in names]} in {time.time() - t0:.0f}s", flush=True)


def build_shrubs(stats, only):
    if only and not only & {"shrub", "seaweed"}:
        return
    t0 = time.time()
    levels, material, info = models.shrub_levels()
    base = PREVIEW_GLB / "shrub_levels.glb"
    PREVIEW_GLB.mkdir(parents=True, exist_ok=True)
    meshes = [(["shrub_LOD0"], [("shrub", levels[0])]), (["shrub_LOD1"], [("shrub", levels[1])])]
    models.write_model(base, meshes, {"shrub": material}, False)
    card = card_for("shrub", base, levels[0])
    base.unlink()
    for name, tint in (("shrub", (1.0, 1.0, 1.0)), ("seaweed", SEAWEED_TINT)):
        mats = {name: {**material, "factor": tint}, f"card_{name}": {"base": card["albedo"], "normal": card["normal"],
                                                                      "mask": True, "factor": tint}}
        ms = [([f"{name}_LOD{k}"], [(name, levels[k])]) for k in range(2)]
        ms.append(([f"{name}_LOD2"], [(f"card_{name}", card["corners"])]))
        if name == "shrub":
            preview = PREVIEW_GLB / "shrub.glb"
            models.write_model(preview, ms, mats, False)
            render_previews("shrub", preview)
        models.write_model(OUT / f"{name}.glb", ms, mats, True)
        stats[name] = {"file": f"{name}.glb", "levels": [l.tris for l in levels] + [card["corners"].tris],
                       "collider": None, "info": info, **extent(levels[0])}
    print(f"shrub/seaweed: {stats['shrub']['levels']} in {time.time() - t0:.0f}s", flush=True)


def build_rocks(species, stats, only):
    groups = {}
    for sp in species:
        if sp["kind"] != "rock":
            continue
        asset, pick = ROCK_SOURCES[Path(sp["url"]).name]
        entry = sp["entry"]
        tint = tuple(entry.get("tint", (1.0, 1.0, 1.0)))
        longest = ROCK_LONGEST.get(entry["id"], 1.0)
        key = (asset, pick, longest, tint, entry["id"] in PATCHES)
        groups.setdefault(key, []).append(sp["name"])
    tints_per_asset = {}
    for key in groups:
        tints_per_asset.setdefault((key[0], key[1]), []).append(key)
    for key, names in groups.items():
        asset, pick, longest, tint, patch = key
        siblings = tints_per_asset[(asset, pick)]
        fname = asset if len(siblings) == 1 else f"{asset}_{tint_code(tint)}"
        if only and not only & set(names):
            for n in names:
                stats.setdefault(n, {})["file"] = f"{fname}.glb"
            continue
        t0 = time.time()
        levels, material = models.rock_levels(asset, longest, pick, patch)
        material = {**material, "factor": tint}
        ms = [([f"{n}_LOD{k}" for n in names], [("rock", levels[k])]) for k in range(3)]
        models.write_model(OUT / f"{fname}.glb", ms, {"rock": material}, True)
        for n in names:
            stats[n] = {"file": f"{fname}.glb", "levels": [l.tris for l in levels], "collider": None, "info": {},
                        **extent(levels[0])}
        print(f"{fname} {names}: {[l.tris for l in levels]} in {time.time() - t0:.0f}s", flush=True)


def main():
    ap = argparse.ArgumentParser(description="Builds the Crater Lake flora models (glbs) and records their sizes; "
                                             "tools/build_forest.py then places them.")
    ap.add_argument("--only", default="", help="comma-separated species or tree-file names (fir, pine) to rebuild")
    args = ap.parse_args()
    started = time.time()
    species = species_list(place.load_flora())
    only = set(filter(None, args.only.split(",")))
    stats_path = WORK / "species_stats.json"
    stats = json.loads(stats_path.read_text()) if stats_path.exists() else {}
    OUT.mkdir(parents=True, exist_ok=True)
    build_trees(stats, only)
    build_shrubs(stats, only)
    build_rocks(species, stats, only)
    stats_path.write_text(json.dumps(stats, default=float))
    print(f"done in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
