import { describe, expect, test } from "bun:test";
import { WeatherSampler, weatherAt } from "../src/sky/Weather";

describe("WeatherSampler", () => {
  test("reuses its output and matches weatherAt as time, day, and day length change", () => {
    const sampler = new WeatherSampler(98431);
    const output = sampler.output;

    for (const [day, hour, dayLength] of [[0, 0, 120], [0, 8, 120], [0, 23.9, 120], [1, 0.1, 120], [1, 12, 45]] as const) {
      sampler.update(day, hour, dayLength, -1);
      expect(sampler.output).toBe(output);
      expect({ ...output }).toEqual(weatherAt(98431, day, hour, dayLength));
    }
  });
});
