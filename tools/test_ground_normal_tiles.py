"""Registration and shared-mip checks for authored regional terrain maps."""
import unittest

import numpy as np
from PIL import Image

from tile_ground_normalmap import crop_rect, pyramid, regions, sample_crop


class RegionalNormals(unittest.TestCase):
    def test_shared_region_and_larger_authored_leaf_keep_registered_bounds(self):
        manifest = {"sizeMetres": 18000, "leaves": [
            {"x": -9000, "z": -9000, "size": 250},
            {"x": -8750, "z": -9000, "size": 250},
            {"x": 3000, "z": -1000, "size": 2000}]}
        crops, tiles = regions(manifest, 8192)
        self.assertEqual(len(crops), 2)
        self.assertEqual(tiles[0], tiles[1])
        west, south, width, height = tiles[2]["bounds"]
        self.assertLessEqual(west, 3000)
        self.assertLessEqual(south, -1000)
        self.assertGreaterEqual(west + width, 5000)
        self.assertGreaterEqual(south + height, 1000)

    def test_crop_keeps_source_density_and_covers_leaf_with_gutters(self):
        span, n = 18000, 8192
        for leaf in [{"x": 4750, "z": 4250, "size": 250},
                     {"x": -9000, "z": -9000, "size": 1000},
                     {"x": 8750, "z": 8750, "size": 250}]:
            x, y, width, height, (west, south, w, h) = crop_rect(leaf, n, span)
            self.assertAlmostEqual(w / width, span / n)
            self.assertAlmostEqual(h / height, span / n)
            self.assertLessEqual(west + 16 * span / n, leaf["x"])
            self.assertLessEqual(south + 16 * span / n, leaf["z"])
            self.assertGreaterEqual(west + w - 16 * span / n, leaf["x"] + leaf["size"])
            self.assertGreaterEqual(south + h - 16 * span / n, leaf["z"] + leaf["size"])
            self.assertEqual(x % 16, 0)
            self.assertEqual(y % 16, 0)

    def test_neighbor_mips_share_original_pixels_not_crop_edge_filters(self):
        rng = np.random.default_rng(4)
        original = rng.integers(0, 256, (256, 256, 3), dtype=np.uint8)
        levels = pyramid(Image.fromarray(original))
        for lod in range(5):
            scale = 2 ** lod
            # Adjacent crops overlap by 32 source texels. The overlap must
            # remain identical at every aligned mip, even for noisy normals.
            left = sample_crop(levels[lod], 16 / scale, 16 / scale, 128 // scale, 128 // scale)
            right = sample_crop(levels[lod], 112 / scale, 16 / scale, 128 // scale, 128 // scale)
            np.testing.assert_array_equal(left[:, 96 // scale:], right[:, :32 // scale])

    def test_map_edge_extends_valid_normals_instead_of_black_padding(self):
        pixels = np.full((16, 16, 3), [128, 128, 255], dtype=np.uint8)
        result = sample_crop(pixels, -8, -8, 32, 32)
        np.testing.assert_array_equal(result, np.broadcast_to([128, 128, 255], result.shape))


if __name__ == "__main__":
    unittest.main()
