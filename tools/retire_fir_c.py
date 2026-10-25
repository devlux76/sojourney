"""Migrate already-authored forest placements off the retired fir variant C.

Fir variant C (fir_tree_01_c.glb) is retired from future authoring; the pine keeps its C.
This tool rewrites the per-leaf placement files under the flora pack so no record points
at fir_c any more: each fir_c record becomes fir_a or fir_b, rescaled to keep its surveyed
tree height, and the remaining species indices shift down past the removed entry.

Usage:
    python3 tools/retire_fir_c.py                  # dry run: validate and summarise, no writes
    python3 tools/retire_fir_c.py --apply          # validate everything first, then rewrite files

The replacement is deterministic from each record's own quantized x/z/yaw plus the leaf id,
so the near (leaves/<id>.bin) and middle-band (mid/<id>.bin) copies of a tree agree.
"""
import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent

# Same record layout as tools/build_forest.py RECORD: species lives at byte 11, scale at bytes 8:10.
RECORD = np.dtype([("y", "<f4"), ("x", "<u2"), ("z", "<u2"), ("scale", "<u2"), ("yaw", "u1"),
                   ("species", "u1"), ("tiltX", "i1"), ("tiltZ", "i1")])
SCALE_UNIT = 0.001
CELL_METRES = 31.25
RETIRED = "fir_c"
RETAINED = ("fir_a", "fir_b")


class MigrationError(ValueError):
    pass


def check_record_layout():
    if RECORD.itemsize != 14:
        raise MigrationError(f"record size {RECORD.itemsize} != 14")
    if RECORD.fields["species"][1] != 11:
        raise MigrationError("species field is not at byte 11")
    if RECORD.fields["scale"][1] != 8:
        raise MigrationError("scale field is not at bytes 8:10")


def sort_like_author(recs, leaf_size, cell_metres=CELL_METRES):
    # Same ordering invariant the author writes: species, then cells from the leaf's
    # south-west corner, then largest first.
    cells = round(leaf_size / cell_metres)
    cell_x = recs["x"].astype(np.int64) * cells // 65536
    cell_z = recs["z"].astype(np.int64) * cells // 65536
    return recs[np.lexsort((-recs["scale"].astype(np.int64), cell_x, cell_z, recs["species"]))]


def migrate_records(records, *, leaf_id, leaf_size, removed_index, replacement_a, replacement_b,
                    height_c, height_a, height_b, cell_metres=CELL_METRES):
    """Pure per-leaf migration: replace removed_index records with A/B, shift others, re-sort.

    Returns (new_records, info) where info holds fir_c/fir_a/fir_b counts and the worst height
    error in metres. Only numpy; no file or pack imports, so tests stay light.
    """
    recs = records.copy()
    old_scale = recs["scale"].astype(np.int64)
    old_species = recs["species"].astype(np.int64)
    is_c = old_species == removed_index
    n_c = int(is_c.sum())
    # Parity from the record's own quantized position plus the leaf id: the near and mid copies
    # of a tree quantize identically, so both files make the same A/B choice.
    parity = ((recs["x"].astype(np.int64) + recs["z"].astype(np.int64)
               + recs["yaw"].astype(np.int64) + int(leaf_id)) % 2)
    to_b = is_c & (parity == 1)
    to_a = is_c & (parity == 0)
    repl_index = np.where(to_b, replacement_b, replacement_a)
    repl_height = np.where(to_b, height_b, height_a)
    if n_c:
        new_scale = np.rint(old_scale[is_c] * height_c / repl_height[is_c])
        if (new_scale < 1).any() or (new_scale > 65535).any():
            raise MigrationError("rescaled fir_c record falls outside 1..65535")
        recs["scale"][is_c] = new_scale.astype(np.uint16)
        recs["species"][is_c] = repl_index[is_c].astype(np.uint8)
        err = np.abs(new_scale * repl_height[is_c] - old_scale[is_c] * height_c) * SCALE_UNIT
        max_err = float(err.max())
    else:
        max_err = 0.0
    # Species after the removed entry shift down one; C records already hold their new index.
    later = (~is_c) & (old_species > removed_index)
    recs["species"][later] = (old_species[later] - 1).astype(np.uint8)
    info = {"fir_c": n_c, "fir_a": int(to_a.sum()), "fir_b": int(to_b.sum()), "max_err": max_err}
    return sort_like_author(recs, leaf_size, cell_metres), info


def read_bins(path, expected):
    if expected == 0:
        if path.exists():
            if path.stat().st_size != 0:
                raise MigrationError(f"{path}: expected 0 records, file is not empty")
            data = np.zeros(0, RECORD)
        else:
            data = np.zeros(0, RECORD)
        return data, path.read_bytes() if path.exists() else None
    if not path.exists():
        raise MigrationError(f"{path}: expected {expected} records, file is missing")
    raw = path.read_bytes()
    if len(raw) != expected * RECORD.itemsize:
        raise MigrationError(f"{path}: expected {expected} records ({expected * RECORD.itemsize} bytes), "
                             f"found {len(raw)} bytes")
    return np.frombuffer(raw, dtype=RECORD).copy(), raw


def main(argv=None):
    ap = argparse.ArgumentParser(description="Migrate fir_c placements to fir_a/fir_b (dry run unless --apply).")
    ap.add_argument("--pack", default=str(ROOT / "public" / "packs" / "crater-lake" / "flora"))
    ap.add_argument("--ground", default=str(ROOT / "public" / "packs" / "crater-lake" / "ground" / "ground.json"))
    ap.add_argument("--stats", default=str(ROOT / "tools" / ".cache" / "flora" / "species_stats.json"))
    ap.add_argument("--apply", action="store_true", help="rewrite the pack files (default is a dry run)")
    args = ap.parse_args(argv)

    check_record_layout()
    pack = Path(args.pack)
    try:
        manifest = json.loads((pack / "forest.json").read_text())
        ground = json.loads(Path(args.ground).read_text())
        stats = json.loads(Path(args.stats).read_text())
    except FileNotFoundError as e:
        raise SystemExit(f"error: {e}") from e

    if manifest.get("format") != 1:
        raise SystemExit(f"error: forest format {manifest.get('format')} != 1")
    if manifest.get("recordBytes") != 14:
        raise SystemExit(f"error: recordBytes {manifest.get('recordBytes')} != 14")
    if abs(float(manifest.get("scaleUnit", -1)) - SCALE_UNIT) > 1e-12:
        raise SystemExit(f"error: scaleUnit {manifest.get('scaleUnit')} != {SCALE_UNIT}")
    if abs(float(manifest.get("cellMetres", -1)) - CELL_METRES) > 1e-12:
        raise SystemExit(f"error: cellMetres {manifest.get('cellMetres')} != {CELL_METRES}")

    species_ids = [s["id"] for s in manifest.get("species", [])]
    if RETIRED not in species_ids:
        print(f"no-op: {RETIRED} already absent from {pack / 'forest.json'}")
        return 0
    for name in RETAINED:
        if name not in species_ids:
            raise SystemExit(f"error: retained species {name} missing from the forest manifest")
    try:
        height_c = float(stats[RETIRED]["height"])
        height_a = float(stats[RETAINED[0]]["height"])
        height_b = float(stats[RETAINED[1]]["height"])
    except KeyError as e:
        raise SystemExit(f"error: species stats lack {e}") from e

    removed = species_ids.index(RETIRED)
    replacement_a = species_ids.index(RETAINED[0])
    replacement_b = species_ids.index(RETAINED[1])
    if replacement_a > removed:
        replacement_a -= 1
    if replacement_b > removed:
        replacement_b -= 1

    ground_leaves = ground.get("leaves", [])
    counts = manifest.get("leaves", [])
    if len(ground_leaves) != len(counts):
        raise SystemExit(f"error: {len(counts)} forest leaf counts != {len(ground_leaves)} ground leaves")
    n_species = len(species_ids)

    # Read and validate every file before touching anything, so a bad pack aborts with no writes.
    try:
        blobs = []
        for leaf_id, (leaf, (near_count, mid_count)) in enumerate(zip(ground_leaves, counts)):
            for folder, expected in (("leaves", near_count), ("mid", mid_count)):
                data, _ = read_bins(pack / folder / f"{leaf_id}.bin", expected)
                if len(data) and int(data["species"].max()) >= n_species:
                    raise MigrationError(f"{folder}/{leaf_id}.bin: species index out of range")
                blobs.append((folder, leaf_id, float(leaf["size"]), data))
    except MigrationError as e:
        raise SystemExit(f"error: {e}") from e

    # Migrate in memory; record counts must not change.
    total_c = total_a = total_b = 0
    total_records = 0
    files_with_c = 0
    max_err = 0.0
    migrated = []
    for folder, leaf_id, leaf_size, data in blobs:
        total_records += len(data)
        try:
            new, info = migrate_records(data, leaf_id=leaf_id, leaf_size=leaf_size, removed_index=removed,
                                        replacement_a=replacement_a, replacement_b=replacement_b,
                                        height_c=height_c, height_a=height_a, height_b=height_b)
        except MigrationError as e:
            raise SystemExit(f"error: {folder}/{leaf_id}.bin: {e}") from e
        assert len(new) == len(data)
        total_c += info["fir_c"]
        total_a += info["fir_a"]
        total_b += info["fir_b"]
        max_err = max(max_err, info["max_err"])
        files_with_c += 1 if info["fir_c"] else 0
        migrated.append((folder, leaf_id, new))

    mode = "apply" if args.apply else "dry-run"
    print(f"{mode}: {total_records} records in {len(blobs)} files, "
          f"fir_c={total_c} in {files_with_c} files "
          f"(-> fir_a {total_a}, fir_b {total_b}), max height error {max_err:.4f} m, no writes"
          if mode == "dry-run" else
          f"apply: {total_records} records in {len(blobs)} files, "
          f"fir_c={total_c} in {files_with_c} files "
          f"(-> fir_a {total_a}, fir_b {total_b}), max height error {max_err:.4f} m")
    if not args.apply:
        return 0

    # All data validated and migrated: publish per-file atomically, manifest last.
    for folder, leaf_id, new in migrated:
        path = pack / folder / f"{leaf_id}.bin"
        old_raw = new.tobytes()
        current = path.read_bytes() if path.exists() else b""
        if current == old_raw and len(new) > 0:
            continue
        if len(new) == 0:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
            continue
        tmp = path.with_suffix(".bin.tmp")
        tmp.write_bytes(old_raw)
        os.replace(tmp, path)
    manifest["species"] = [s for s in manifest["species"] if s["id"] != RETIRED]
    tmp = pack / "forest.json.tmp"
    tmp.write_text(json.dumps(manifest, separators=(",", ":")))
    os.replace(tmp, pack / "forest.json")
    print(f"wrote {pack / 'forest.json'} without {RETIRED}; record counts unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
