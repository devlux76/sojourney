"""Tests for tools/retire_fir_c.py: fir variant C retirement migration.

Only the migration's own contract is tested (synthetic records plus minimal temp packs):
no engine behaviour, no real pack writes.
"""
import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np

from retire_fir_c import RECORD, migrate_records, main

H_A, H_B, H_C = 18.954, 13.991, 14.458  # real fir_a/fir_b/fir_c model heights
REMOVED, NEW_A, NEW_B = 2, 0, 1
LEAF_SIZE = 250.0


def make_record(x, z, yaw, species, scale, y=12.5, tiltX=3, tiltZ=-2):
    r = np.zeros(1, RECORD)
    r["x"] = x
    r["z"] = z
    r["yaw"] = yaw
    r["species"] = species
    r["scale"] = scale
    r["y"] = y
    r["tiltX"] = tiltX
    r["tiltZ"] = tiltZ
    return r


def mixed_records():
    # Parities with leaf_id 0: (0,0,0)->A, (1,0,0)->B.
    return np.concatenate([
        make_record(0, 0, 0, REMOVED, 1333),          # fir_c -> fir_a
        make_record(1, 0, 0, REMOVED, 2500),          # fir_c -> fir_b
        make_record(10, 20, 30, 0, 1500),             # fir_a, untouched
        make_record(11, 21, 31, 1, 1600),             # fir_b, untouched
        make_record(12, 22, 32, 3, 1700),             # pine_a 3 -> 2
        make_record(13, 23, 33, 5, 1800),             # pine_c 5 -> 4
    ])


def migrate(records, leaf_id=0):
    return migrate_records(records, leaf_id=leaf_id, leaf_size=LEAF_SIZE, removed_index=REMOVED,
                           replacement_a=NEW_A, replacement_b=NEW_B,
                           height_c=H_C, height_a=H_A, height_b=H_B)


def by_position(records):
    return {(int(r["x"]), int(r["z"]), int(r["yaw"])): r for r in records}


class TestMigrateRecords(unittest.TestCase):
    def test_c_replaced_with_shifted_indices(self):
        out, info = migrate(mixed_records())
        self.assertEqual(info["fir_c"], 2)
        self.assertEqual(info["fir_a"], 1)
        self.assertEqual(info["fir_b"], 1)
        species = sorted(int(s) for s in out["species"])
        # fir_c gone; pine 3->2 and 5->4, so the set is {0,0,1,1,2,4} (2 is now pine_a).
        self.assertEqual(species, [0, 0, 1, 1, 2, 4])
        table = by_position(out)
        self.assertEqual(int(table[(0, 0, 0)]["species"]), NEW_A)
        self.assertEqual(int(table[(1, 0, 0)]["species"]), NEW_B)

    def test_height_preserved_within_quantization(self):
        out, _ = migrate(mixed_records())
        table = by_position(out)
        tol = max(H_A, H_B) * 0.0005
        for (x, old_scale, height) in ((0, 1333, H_A), (1, 2500, H_B)):
            rec = table[(x, 0, 0)]
            self.assertEqual(rec["scale"], round(old_scale * H_C / height))
            err = abs(int(rec["scale"]) * height - old_scale * H_C) * 0.001
            self.assertLessEqual(err, tol)

    def test_coordinates_yaw_tilt_y_unchanged(self):
        before = mixed_records()
        out, _ = migrate(before)
        table = by_position(out)
        self.assertEqual(len(table), len(before))  # positions unique, none lost or added
        for rec in before:
            key = (int(rec["x"]), int(rec["z"]), int(rec["yaw"]))
            same = table[key]
            self.assertEqual(float(same["y"]), float(rec["y"]))
            self.assertEqual(int(same["tiltX"]), int(rec["tiltX"]))
            self.assertEqual(int(same["tiltZ"]), int(rec["tiltZ"]))
            self.assertEqual(int(same["x"]), int(rec["x"]))
            self.assertEqual(int(same["z"]), int(rec["z"]))

    def test_non_c_scales_unchanged(self):
        before = mixed_records()
        out, _ = migrate(before)
        table = by_position(out)
        for x, scale in ((10, 1500), (11, 1600), (12, 1700), (13, 1800)):
            recs = [r for k, r in table.items() if k[0] == x]
            self.assertEqual(len(recs), 1)
            self.assertEqual(int(recs[0]["scale"]), scale)

    def test_sorted_invariant(self):
        out, _ = migrate(mixed_records())
        cells = round(LEAF_SIZE / 31.25)
        cell_x = out["x"].astype(np.int64) * cells // 65536
        cell_z = out["z"].astype(np.int64) * cells // 65536
        order = np.lexsort((-out["scale"].astype(np.int64), cell_x, cell_z, out["species"]))
        np.testing.assert_array_equal(order, np.arange(len(out)))

    def test_near_mid_agree(self):
        # The same tree quantizes identically in leaves/<id>.bin and mid/<id>.bin, so both
        # copies must draw the same replacement.
        rec = make_record(7, 9, 200, REMOVED, 1333)
        out_near, _ = migrate(rec, leaf_id=5)
        out_mid, _ = migrate(rec, leaf_id=5)
        self.assertEqual(int(out_near["species"][0]), int(out_mid["species"][0]))
        self.assertEqual(int(out_near["scale"][0]), int(out_mid["scale"][0]))

    def test_no_c_records_is_identity(self):
        recs = np.concatenate([make_record(10, 20, 30, 0, 1500), make_record(12, 22, 32, 3, 1700)])
        out, info = migrate(recs)
        self.assertEqual(info["fir_c"], 0)
        # Species 3 still shifts past the removed entry.
        self.assertEqual(sorted(int(s) for s in out["species"]), [0, 2])
        np.testing.assert_array_equal(np.sort(out["scale"]), [1500, 1700])


def write_pack(root, species_ids, leaf_counts, blobs, heights=None):
    pack = Path(root) / "pack"
    (pack / "leaves").mkdir(parents=True)
    (pack / "mid").mkdir(parents=True)
    manifest = {"format": 1, "leavesUrl": "packs/crater-lake/flora/leaves/",
                "midUrl": "packs/crater-lake/flora/mid/", "recordBytes": 14, "scaleUnit": 0.001,
                "cellMetres": 31.25, "nearMetres": 600.0, "midMetres": 2500.0, "pixelReach": 700.0,
                "species": [{"id": s} for s in species_ids], "leaves": leaf_counts}
    (pack / "forest.json").write_text(json.dumps(manifest))
    leaves = [{"x": 0.0, "z": 0.0, "size": LEAF_SIZE} for _ in leaf_counts]
    ground = Path(root) / "ground.json"
    ground.write_text(json.dumps({"leaves": leaves}))
    stats = {s: {"height": h} for s, h in
             zip(["fir_a", "fir_b", "fir_c"], [H_A, H_B, H_C] if heights is None else heights)}
    stats_path = Path(root) / "stats.json"
    stats_path.write_text(json.dumps(stats))
    for (folder, leaf_id), data in blobs.items():
        (pack / folder / f"{leaf_id}.bin").write_bytes(data.tobytes())
    return pack, ground, stats_path


def snapshot_files(root):
    return {str(p.relative_to(root)): p.read_bytes() for p in Path(root).rglob("*") if p.is_file()}


class TestPackCli(unittest.TestCase):
    def test_dry_run_changes_nothing(self):
        with TemporaryDirectory() as tmp:
            data = mixed_records()
            pack, ground, stats = write_pack(tmp, ["fir_a", "fir_b", "fir_c", "pine_a", "pine_b", "pine_c"],
                                             [[len(data), 0]], {("leaves", 0): data})
            before = snapshot_files(tmp)
            with redirect_stdout(io.StringIO()):
                rc = main(["--pack", str(pack), "--ground", str(ground), "--stats", str(stats)])
            self.assertEqual(rc, 0)
            self.assertEqual(snapshot_files(tmp), before)

    def test_apply_then_noop(self):
        with TemporaryDirectory() as tmp:
            data = mixed_records()
            pack, ground, stats = write_pack(tmp, ["fir_a", "fir_b", "fir_c", "pine_a", "pine_b", "pine_c"],
                                             [[len(data), 0]], {("leaves", 0): data})
            with redirect_stdout(io.StringIO()):
                self.assertEqual(main(["--pack", str(pack), "--ground", str(ground),
                                       "--stats", str(stats), "--apply"]), 0)
            manifest = json.loads((pack / "forest.json").read_text())
            self.assertEqual([s["id"] for s in manifest["species"]],
                             ["fir_a", "fir_b", "pine_a", "pine_b", "pine_c"])
            self.assertEqual(manifest["leaves"], [[len(data), 0]])  # record counts unchanged
            out = np.frombuffer((pack / "leaves" / "0.bin").read_bytes(), dtype=RECORD).copy()
            self.assertEqual(len(out), len(data))
            table = {(int(r["x"]), int(r["z"]), int(r["yaw"])): int(r["species"]) for r in out}
            self.assertEqual(table[(0, 0, 0)], 0)  # ex fir_c -> fir_a
            self.assertEqual(table[(1, 0, 0)], 1)  # ex fir_c -> fir_b
            buf = io.StringIO()
            with redirect_stdout(buf):
                self.assertEqual(main(["--pack", str(pack), "--ground", str(ground),
                                       "--stats", str(stats)]), 0)
            self.assertIn("no-op", buf.getvalue())

    def test_bad_byte_count_aborts_without_writes(self):
        with TemporaryDirectory() as tmp:
            data = mixed_records()
            pack, ground, stats = write_pack(tmp, ["fir_a", "fir_b", "fir_c"],
                                             [[len(data), 0]], {("leaves", 0): data})
            (pack / "leaves" / "0.bin").write_bytes(b"\x00" * 10)  # not a multiple of 14
            before = snapshot_files(tmp)
            with redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as cm:
                    main(["--pack", str(pack), "--ground", str(ground), "--stats", str(stats),
                          "--apply"])
            self.assertNotEqual(cm.exception.code, 0)
            self.assertEqual(snapshot_files(tmp), before)

    def test_wrong_manifest_count_aborts_without_writes(self):
        with TemporaryDirectory() as tmp:
            data = mixed_records()
            pack, ground, stats = write_pack(tmp, ["fir_a", "fir_b", "fir_c"],
                                             [[len(data) + 5, 0]], {("leaves", 0): data})
            before = snapshot_files(tmp)
            with redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as cm:
                    main(["--pack", str(pack), "--ground", str(ground), "--stats", str(stats),
                          "--apply"])
            self.assertNotEqual(cm.exception.code, 0)
            self.assertEqual(snapshot_files(tmp), before)

    def test_bad_species_index_aborts_without_writes(self):
        with TemporaryDirectory() as tmp:
            bad = make_record(4, 4, 4, 9, 1500)  # only 3 species in the manifest
            pack, ground, stats = write_pack(tmp, ["fir_a", "fir_b", "fir_c"],
                                             [[1, 0]], {("leaves", 0): bad})
            before = snapshot_files(tmp)
            with redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as cm:
                    main(["--pack", str(pack), "--ground", str(ground), "--stats", str(stats),
                          "--apply"])
            self.assertNotEqual(cm.exception.code, 0)
            self.assertEqual(snapshot_files(tmp), before)


if __name__ == "__main__":
    unittest.main()
