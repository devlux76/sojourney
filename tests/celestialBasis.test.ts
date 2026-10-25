import { describe, expect, test } from "bun:test";
import { celestialBasis, celestialBasisToRef } from "../src/sky/Astronomy";

describe("celestialBasisToRef", () => {
  test("matches the allocating reference calculation across time and latitude", () => {
    const output = new Float32Array(9);
    for (const [date, lat, lon] of [
      [new Date("2026-06-15T16:30:00Z"), 42.94, -122.11],
      [new Date("2026-12-21T04:00:00Z"), -33.9, 151.2],
      [new Date("2026-03-20T12:00:00Z"), 0, 0],
    ] as const) {
      celestialBasisToRef(date, lat, lon, output);
      const expected = celestialBasis(date, lat, lon);
      for (let i = 0; i < output.length; i++) expect(output[i]).toBeCloseTo(expected[i], 6);
    }
  });
});
