import { expect, test } from "bun:test";
import { isTourBeautyStop } from "../src/sky/Weather";

test("the tour holds beauty only while the player is aboard the dwelling boat", () => {
  // Aboard a dwelling boat: the sights stay visible on the ride.
  expect(isTourBeautyStop(true, 120)).toBe(true);
  // Ashore (or swimming) during a dwell: weather does whatever it does.
  expect(isTourBeautyStop(false, 120)).toBe(false);
  // Aboard under way: no hold.
  expect(isTourBeautyStop(true, 0)).toBe(false);
  expect(isTourBeautyStop(false, 0)).toBe(false);
});
