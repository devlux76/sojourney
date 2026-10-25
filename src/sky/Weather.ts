export type WeatherKind = "clear" | "cloudy" | "overcast" | "drizzle" | "rain" | "storm";
export const WEATHER_KINDS: WeatherKind[] = ["clear", "cloudy", "overcast", "drizzle", "rain", "storm"];

// rain is 1 in steady rain and more in a downpour; storm is the share of a thunderstorm, 0 to 1.
export interface WeatherParams { cloudCover: number; rain: number; wetness: number; wind: number; storm: number; }
export interface Spell { start: number; end: number; kind: WeatherKind; }
export interface DaySchedule { base: WeatherKind; spells: Spell[]; }

// Reuse the two deterministic day schedules while sampling weather each frame; only a midnight or
// day-length change needs to regenerate their spell arrays.
export class WeatherSampler {
  readonly output: WeatherParams = { cloudCover: 0, rain: 0, wetness: 0, wind: 0, storm: 0 };
  private day = Number.NaN;
  private dayLengthMinutes = Number.NaN;
  private today!: DaySchedule;
  private tomorrow!: DaySchedule;

  constructor(private readonly seed: number) {}

  update(day: number, hour: number, dayLengthMinutes: number, weatherOverride: number): WeatherParams {
    if (weatherOverride >= 0) {
      const kind = WEATHER_KINDS[weatherOverride];
      const steady = STEADY[kind];
      this.output.cloudCover = steady.cloudCover;
      this.output.rain = steady.rain;
      this.output.wetness = Math.min(1, Math.sqrt(steady.rain));
      this.output.wind = windFor(steady.cloudCover, steady.rain);
      this.output.storm = kind === "storm" ? 1 : 0;
      return this.output;
    }
    if (day !== this.day || dayLengthMinutes !== this.dayLengthMinutes) {
      this.day = day;
      this.dayLengthMinutes = dayLengthMinutes;
      this.today = daySchedule(this.seed, day, dayLengthMinutes);
      this.tomorrow = daySchedule(this.seed, day + 1, dayLengthMinutes);
    }
    sampleWeather(this.output, this.today, this.tomorrow, hour);
    return this.output;
  }
}

export const RAIN_WINDOW = [7.5, 19];
export const RAIN_HOURS = [2.4, 6];
const SHOWER_WINDOW = [2, 20];
const SHOWER_HOURS = [1, 2];
const SHOWER_CHANCE = 0.3;
// Of the day's main rain spells, this share are thunderstorms and this share (storms included) rain.
const STORM_SHARE = 0.2;
const RAIN_SHARE = 0.6;
const SHOWER_GAP = 1;
export const MAX_RAIN_MINUTES = 10;
const RAIN_EASE_OUT_MINUTES = 1;
export const DEFAULT_DAY_MINUTES = 120;
const CLOUD_LEAD = 1.2;
const CLOUD_TRAIL = 1.8;
const RAIN_RAMP = 0.5;
const WET_RISE = 1;
const WET_DRY = 3;
const BASE_BLEND_START = 22;
export const CALM_WIND = 0.15;

export const rainCapHours = (dayLengthMinutes = DEFAULT_DAY_MINUTES) =>
  (MAX_RAIN_MINUTES - RAIN_EASE_OUT_MINUTES) * 24 / dayLengthMinutes;

const STEADY: Record<WeatherKind, { cloudCover: number; rain: number }> = {
  clear: { cloudCover: 0.05, rain: 0 },
  cloudy: { cloudCover: 0.45, rain: 0 },
  // Cover 1 closes the sky: the cloud layer leaves gaps at anything less (see the cloud shader).
  overcast: { cloudCover: 1, rain: 0 },
  drizzle: { cloudCover: 1, rain: 0.35 },
  rain: { cloudCover: 1, rain: 1 },
  // A thunderstorm is a downpour, heavier than steady rain, with lightning.
  storm: { cloudCover: 1, rain: 1.4 },
};

const windFor = (cloudCover: number, rain: number) => Math.min(1, CALM_WIND + 0.35 * Math.max(0, cloudCover - 0.05) + 0.5 * rain);

export function kindParams(kind: WeatherKind): WeatherParams {
  const { cloudCover, rain } = STEADY[kind];
  return { cloudCover, rain, wetness: Math.min(1, Math.sqrt(rain)), wind: windFor(cloudCover, rain), storm: kind === "storm" ? 1 : 0 };
}

export function daySchedule(seed: number, day: number, dayLengthMinutes = DEFAULT_DAY_MINUTES): DaySchedule {
  const rand = mulberry32((seed ^ Math.imul(day + 1, 0x9e3779b1)) >>> 0);
  const roll = rand();
  const base: WeatherKind = roll < 0.5 ? "clear" : roll < 0.85 ? "cloudy" : "overcast";
  const maxHours = rainCapHours(dayLengthMinutes);
  const length = Math.min(maxHours, lerp(RAIN_HOURS[0], RAIN_HOURS[1], rand()));
  const start = lerp(RAIN_WINDOW[0], RAIN_WINDOW[1] - length, rand());
  const wet = rand();
  const spells: Spell[] = [{ start, end: start + length, kind: wet < STORM_SHARE ? "storm" : wet < RAIN_SHARE ? "rain" : "drizzle" }];
  if (rand() < SHOWER_CHANCE) {
    const showerLength = Math.min(maxHours, lerp(SHOWER_HOURS[0], SHOWER_HOURS[1], rand()));
    const showerStart = lerp(SHOWER_WINDOW[0], SHOWER_WINDOW[1] - showerLength, rand());
    if (showerStart + showerLength + SHOWER_GAP <= start || showerStart >= start + length + SHOWER_GAP) {
      spells.push({ start: showerStart, end: showerStart + showerLength, kind: "drizzle" });
    }
  }
  return { base, spells };
}

export function weatherAt(seed: number, day: number, hour: number, dayLengthMinutes = DEFAULT_DAY_MINUTES): WeatherParams {
  const today = daySchedule(seed, day, dayLengthMinutes), tomorrow = daySchedule(seed, day + 1, dayLengthMinutes);
  return sampleWeather({ cloudCover: 0, rain: 0, wetness: 0, wind: 0, storm: 0 }, today, tomorrow, hour);
}

function sampleWeather(output: WeatherParams, today: DaySchedule, tomorrow: DaySchedule, hour: number): WeatherParams {
  let cloudCover = lerp(STEADY[today.base].cloudCover, STEADY[tomorrow.base].cloudCover,
    smoothstep(BASE_BLEND_START, 24, hour));
  let rain = 0, wetness = 0, storm = 0;
  for (const s of today.spells) {
    const steady = STEADY[s.kind];
    cloudCover = Math.max(cloudCover, steady.cloudCover * envelope(hour, s.start - CLOUD_LEAD, s.start, s.end, s.end + CLOUD_TRAIL));
    const falling = envelope(hour, s.start, s.start + RAIN_RAMP, s.end - RAIN_RAMP, s.end);
    rain = Math.max(rain, steady.rain * falling);
    if (s.kind === "storm") storm = Math.max(storm, falling);
    wetness = Math.max(wetness, Math.min(1, Math.sqrt(steady.rain)) * envelope(hour, s.start, s.start + WET_RISE, s.end, s.end + WET_DRY));
  }
  output.cloudCover = cloudCover;
  output.rain = rain;
  output.wetness = wetness;
  output.wind = windFor(cloudCover, rain);
  output.storm = storm;
  return output;
}

function envelope(t: number, a: number, b: number, c: number, d: number) {
  return smoothstep(a, b, t) * (1 - smoothstep(c, d, t));
}

function smoothstep(a: number, b: number, t: number) {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
