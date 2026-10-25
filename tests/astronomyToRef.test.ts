import { describe, expect, test } from "bun:test";
import { horizontalToVector, horizontalToVectorToRef, sunPosition, sunPositionToRef } from "../src/sky/Astronomy";

describe("astronomy ToRef helpers", () => {
  test("writes the same solar position and vector into reusable outputs", () => {
    const position = { alt: 0, az: 0 };
    const vector = { x: 0, y: 0, z: 0 };
    const dates = [new Date("2026-06-15T16:30:00Z"), new Date("2026-12-21T04:00:00Z")];
    for (const date of dates) {
      const expected = sunPosition(date, 42.94, -122.11);
      sunPositionToRef(date, 42.94, -122.11, position);
      expect(position.alt).toBeCloseTo(expected.alt, 10);
      expect(position.az).toBeCloseTo(expected.az, 10);
      const expectedVector = horizontalToVector(expected);
      horizontalToVectorToRef(position, vector);
      expect(vector.x).toBeCloseTo(expectedVector.x, 10);
      expect(vector.y).toBeCloseTo(expectedVector.y, 10);
      expect(vector.z).toBeCloseTo(expectedVector.z, 10);
    }
  });
});
