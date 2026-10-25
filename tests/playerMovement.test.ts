import { describe, expect, test } from "bun:test";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { setMovementVectors, swimVelocityToRef } from "../src/engine/player/movement";

describe("setMovementVectors", () => {
  test("fills reusable forward, right, and diagonal movement vectors", () => {
    const forward = new Vector3(), right = new Vector3(), wish = new Vector3();
    setMovementVectors(Math.PI / 2, 1, 1, 4, forward, right, wish);
    expect(forward.x).toBeCloseTo(1, 12);
    expect(forward.z).toBeCloseTo(0, 12);
    expect(right.x).toBeCloseTo(0, 12);
    expect(right.z).toBeCloseTo(-1, 12);
    expect(wish.x).toBeCloseTo(4 / Math.sqrt(2), 12);
    expect(wish.z).toBeCloseTo(-4 / Math.sqrt(2), 12);
  });

  test("zeros wish when neither axis is requested", () => {
    const forward = new Vector3(), right = new Vector3(), wish = new Vector3(1, 1, 1);
    setMovementVectors(0, 0, 0, 4, forward, right, wish);
    expect(wish.asArray()).toEqual([0, 0, 0]);
  });

  test("looking down dives and looking up climbs without a diagonal speed bonus", () => {
    const forward = new Vector3(), right = new Vector3(), wish = new Vector3();
    setMovementVectors(0, 1, 1, 1.2, forward, right, wish, Math.PI / 4);
    expect(wish.y).toBeLessThan(0);
    expect(wish.length()).toBeCloseTo(1.2, 12);
    setMovementVectors(0, 1, 0, 1.2, forward, right, wish, -Math.PI / 4);
    expect(wish.y).toBeGreaterThan(0);
  });
});

test("idle water motion sinks instead of resurfacing, with step-independent drag", () => {
  const one = new Vector3(), many = new Vector3(), rest = Vector3.Zero();
  swimVelocityToRef(rest, rest, 9.81, 1, one);
  for (let i = 0; i < 100; i++) swimVelocityToRef(many, rest, 9.81, 0.01, many);
  expect(one.y).toBeLessThan(0);
  expect(one.y).toBeGreaterThan(-9.81);
  expect(many.y).toBeCloseTo(one.y, 12);
  expect(one.x).toBe(0);
  expect(one.z).toBe(0);
});

test("upward strokes overcome sinking and released strokes settle downward", () => {
  const velocity = new Vector3();
  const up = new Vector3(0, 3.6, 0), rest = Vector3.Zero();
  swimVelocityToRef(velocity, up, 9.81, 0.5, velocity);
  expect(velocity.y).toBeGreaterThan(0);
  swimVelocityToRef(velocity, rest, 9.81, 1, velocity);
  expect(velocity.y).toBeLessThan(0);
});
