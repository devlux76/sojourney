import { describe, expect, test } from "bun:test";
import { daySchedule, WeatherSampler, weatherAt, type WeatherPattern } from "../src/sky/Weather";

const pattern: WeatherPattern = {
  rainWindow: [7.5, 19],
  rainHours: [2.4, 6],
  showerWindow: [2, 20],
  showerHours: [1, 2],
  showerChance: 0.3,
  showerGap: 1,
  calmWind: 0.15,
  maxRainMinutes: 10,
  baseWeather: { clear: 0.5, cloudy: 0.35, overcast: 0.15 },
  stormShare: 0.2,
  rainShare: 0.6,
};

describe("WeatherSampler", () => {
  test("reuses its output and matches weatherAt as time, day, and day length change", () => {
    const sampler = new WeatherSampler(98431, pattern);
    const output = sampler.output;

    for (const [day, hour, dayLength] of [[0, 0, 120], [0, 8, 120], [0, 23.9, 120], [1, 0.1, 120], [1, 12, 45]] as const) {
      sampler.update(day, hour, dayLength, -1);
      expect(sampler.output).toBe(output);
      expect({ ...output }).toEqual(weatherAt(98431, day, hour, dayLength, pattern));
    }
  });

  test("takes base conditions, spell times, spell type, and calm wind from the biome pattern", () => {
    const custom: WeatherPattern = {
      ...pattern,
      rainWindow: [9, 10],
      rainHours: [1, 1],
      showerChance: 0,
      calmWind: 0.4,
      maxRainMinutes: 100,
      baseWeather: { clear: 1, cloudy: 0, overcast: 0 },
      stormShare: 1,
      rainShare: 1,
    };

    expect(daySchedule(1, 0, 120, custom)).toEqual({
      base: "clear",
      spells: [{ start: 9, end: 10, kind: "storm" }],
    });

    const sampler = new WeatherSampler(1, custom);
    expect(sampler.update(0, 1, 120, -1)).toMatchObject({ cloudCover: 0.05, rain: 0, wind: 0.4 });
  });
});
