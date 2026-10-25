import { expect, test } from "bun:test";
import { HAZE_RAIN, MAX_HAZE, STILL_SHUTOFF_SECONDS, TRAVEL_MS, downgradeFloor, getHazeLevel, hazeRain, isZoomedBeauty, setHazeLevel, shownHazeRain, snapHaze, stillIdle, updateHaze } from "../src/engine/optimizerHaze";

test("haze starts clear and clamps to its rungs", () => {
  setHazeLevel(0);
  expect(getHazeLevel()).toBe(0);
  expect(hazeRain()).toBe(0);
  setHazeLevel(99);
  expect(getHazeLevel()).toBe(MAX_HAZE);
  setHazeLevel(-1);
  expect(getHazeLevel()).toBe(0);
  setHazeLevel(0);
});

test("haze rungs rise toward storm rain", () => {
  expect(HAZE_RAIN[MAX_HAZE]).toBe(1.4);
  for (let i = 1; i <= MAX_HAZE; i++) expect(HAZE_RAIN[i]).toBeGreaterThan(HAZE_RAIN[i - 1]);
});

test("drawn haze eases toward its rung instead of jumping", () => {
  setHazeLevel(0);
  updateHaze(0);
  expect(shownHazeRain()).toBe(0);
  setHazeLevel(MAX_HAZE);
  expect(shownHazeRain()).toBe(0);
  updateHaze(1);
  const rolling = shownHazeRain();
  expect(rolling).toBeGreaterThan(0);
  expect(rolling).toBeLessThan(0.5);
  updateHaze(1000);
  expect(shownHazeRain()).toBeCloseTo(1.4, 3);
  setHazeLevel(0);
  updateHaze(0);
  expect(shownHazeRain()).toBe(0);
});

test("snapped haze jumps to its rung at once", () => {
  setHazeLevel(0);
  updateHaze(0);
  setHazeLevel(MAX_HAZE);
  updateHaze(1);
  expect(shownHazeRain()).toBeLessThan(1.4);
  snapHaze();
  expect(shownHazeRain()).toBe(1.4);
  setHazeLevel(0);
  snapHaze();
  expect(shownHazeRain()).toBe(0);
});

test("downgrade floor rises with camera speed", () => {
  expect(downgradeFloor(60, 0)).toBeCloseTo(48, 6);
  expect(downgradeFloor(60, 999)).toBeCloseTo(54, 6);
  const mid = downgradeFloor(60, TRAVEL_MS / 2);
  expect(mid).toBeGreaterThan(48);
  expect(mid).toBeLessThan(54);
});

test("the optimizer shuts off after several seconds without camera travel", () => {
  const now = 100000;
  expect(stillIdle(now, now - STILL_SHUTOFF_SECONDS * 1000)).toBe(true);
  expect(stillIdle(now, now - STILL_SHUTOFF_SECONDS * 1000 + 1)).toBe(false);
  expect(stillIdle(now, now)).toBe(false);
});

test("binoculars count as standing still for the view", () => {
  expect(isZoomedBeauty(1)).toBe(false);
  expect(isZoomedBeauty(1.5)).toBe(true);
  expect(isZoomedBeauty(10)).toBe(true);
});
