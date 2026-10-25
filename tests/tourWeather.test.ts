import { expect, test } from "bun:test";
import { WeatherSampler, kindParams } from "../src/sky/Weather";
import craterLake from "../src/biomes/crater-lake";

test("a tour dwell clears automatic weather and departure resumes the current schedule", () => {
  const sampler = new WeatherSampler(craterLake.climate.weatherSeed, craterLake.climate);
  const expected = new WeatherSampler(craterLake.climate.weatherSeed, craterLake.climate);
  sampler.update(1, 12, 120, -1);
  expect(sampler.update(1, 12, 120, -1, true)).toEqual(kindParams("clear", craterLake.climate.calmWind));
  // Midnight/day-length changes during a stop must not restore the schedule from arrival.
  expect(sampler.update(2, 14, 60, -1, false)).toEqual(expected.update(2, 14, 60, -1));
});

test("tour weather holds preserve explicit weather choices and reuse the sampler output", () => {
  const sampler = new WeatherSampler(craterLake.climate.weatherSeed, craterLake.climate);
  const output = sampler.output;
  expect(sampler.update(1, 12, 120, 5, true)).toBe(output);
  expect(output).toEqual(kindParams("storm", craterLake.climate.calmWind));
  expect(sampler.update(1, 12, 120, -1, true)).toBe(output);
  expect(output.rain).toBe(0);
  expect(output.storm).toBe(0);
});
