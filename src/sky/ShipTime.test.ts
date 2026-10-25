import { expect, test } from "bun:test";
import { clockTime, shipHours, type ShipLeg } from "./ShipTime";

// Three stops on a 1000 m loop: the dock at 0, then sights at 400 and 700.
const stops = [{ distance: 0, hours: 9.5 }, { distance: 400, hours: 11 }, { distance: 700, hours: 15 }];
const leg = (over: Partial<ShipLeg>): ShipLeg => ({ stops, length: 1000, returnHour: 19.5, stop: 0, distance: 0, dwelling: false, lapDone: false, ...over });

test("a dwelling ship shows the hour of the stop she lies at", () => {
  expect(shipHours(leg({ stop: 1, distance: 400, dwelling: true }))).toBe(11);
});

test("under way the hour runs from the stop left to the stop ahead with the distance covered", () => {
  expect(shipHours(leg({ stop: 0, distance: 200 }))).toBeCloseTo(10.25);
  expect(shipHours(leg({ stop: 1, distance: 550 }))).toBeCloseTo(13);
});

test("the last leg runs to the return hour, not to the next morning", () => {
  expect(shipHours(leg({ stop: 2, distance: 850 }))).toBeCloseTo(17.25);
});

test("back at the first dock she keeps the evening until she casts off again", () => {
  expect(shipHours(leg({ stop: 0, distance: 0, dwelling: true, lapDone: true }))).toBe(19.5);
  expect(shipHours(leg({ stop: 0, distance: 0, dwelling: true, lapDone: false }))).toBe(9.5);
});

test("a leg that crosses midnight wraps to the next day", () => {
  const late = [{ distance: 0, hours: 22 }, { distance: 500, hours: 2 }];
  expect(shipHours({ stops: late, length: 1000, returnHour: 23, stop: 0, distance: 250, dwelling: false, lapDone: false })).toBeCloseTo(0);
});

test("the time is told on a twelve-hour clock", () => {
  expect(clockTime(9.5)).toBe("9:30 am");
  expect(clockTime(15.67)).toBe("3:40 pm");
  expect(clockTime(0.1)).toBe("12:06 am");
  expect(clockTime(12)).toBe("12:00 pm");
});
