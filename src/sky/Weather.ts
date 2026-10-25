export type WeatherKind = "clear" | "cloudy" | "overcast" | "drizzle" | "rain" | "storm";
export const WEATHER_KINDS: WeatherKind[] = ["clear", "cloudy", "overcast", "drizzle", "rain", "storm"];

// rain is 1 in steady rain and more in a downpour; storm is the share of a thunderstorm, 0 to 1.
export interface WeatherParams { cloudCover: number; rain: number; wetness: number; wind: number; storm: number; }
export interface Spell { start: number; end: number; kind: WeatherKind; }
export interface DaySchedule { base: WeatherKind; spells: Spell[]; }

// Biomes choose when and how often weather spells happen; the sampler supplies the shared weather mechanics.
export interface WeatherPattern {
  rainWindow: [number, number];
  rainHours: [number, number];
  showerWindow: [number, number];
  showerHours: [number, number];
  showerChance: number;
  showerGap: number;
  calmWind: number;
  maxRainMinutes: number;
  baseWeather: { clear: number; cloudy: number; overcast: number };
  stormShare: number;
  rainShare: number;
}

// The tour holds clear weather and full beauty only while the player is aboard the dwelling
// boat, so the sights stay visible on the ride. From anywhere else — ashore, on a dock, or
// swimming — the ship's stops must not touch the scene: weather does whatever it does.
export function isTourBeautyStop(aboard: boolean, dwellLeft: number): boolean {
  return aboard && dwellLeft > 0;
}

// Reuse the two deterministic day schedules while sampling weather each frame; only a midnight or
// day-length change needs to regenerate their spell arrays.
export class WeatherSampler {
  readonly output: WeatherParams = { cloudCover: 0, rain: 0, wetness: 0, wind: 0, storm: 0 };
  private day = Number.NaN;
  private dayLengthMinutes = Number.NaN;
  private today!: DaySchedule;
  private tomorrow!: DaySchedule;

  constructor(private readonly seed: number, private readonly pattern: WeatherPattern) {}

  update(day: number, hour: number, dayLengthMinutes: number, weatherOverride: number, beautyStop = false): WeatherParams {
    // A tour dwell with the player aboard uses the existing clear target; explicit weather selection still wins.
    // Schedules are never rewritten, so departure resumes the weather for the current day/hour.
    if (beautyStop && weatherOverride < 0) weatherOverride = 0;
    if (weatherOverride >= 0) {
      const kind = WEATHER_KINDS[weatherOverride];
      const steady = STEADY[kind];
      this.output.cloudCover = steady.cloudCover;
      this.output.rain = steady.rain;
      this.output.wetness = Math.min(1, Math.sqrt(steady.rain));
      this.output.wind = windFor(steady.cloudCover, steady.rain, this.pattern.calmWind);
      this.output.storm = kind === "storm" ? 1 : 0;
      return this.output;
    }
    if (day !== this.day || dayLengthMinutes !== this.dayLengthMinutes) {
      this.day = day;
      this.dayLengthMinutes = dayLengthMinutes;
      this.today = daySchedule(this.seed, day, dayLengthMinutes, this.pattern);
      this.tomorrow = daySchedule(this.seed, day + 1, dayLengthMinutes, this.pattern);
    }
    sampleWeather(this.output, this.today, this.tomorrow, hour, this.pattern.calmWind);
    return this.output;
  }
}

const RAIN_EASE_OUT_MINUTES = 1;
export const DEFAULT_DAY_MINUTES = 120;
const CLOUD_LEAD = 1.2;
const CLOUD_TRAIL = 1.8;
const RAIN_RAMP = 0.5;
const WET_RISE = 1;
const WET_DRY = 3;
const BASE_BLEND_START = 22;
export const rainCapHours = (dayLengthMinutes: number, maxRainMinutes: number) =>
  (maxRainMinutes - RAIN_EASE_OUT_MINUTES) * 24 / dayLengthMinutes;

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

const windFor = (cloudCover: number, rain: number, calmWind: number) =>
  Math.min(1, calmWind + 0.35 * Math.max(0, cloudCover - 0.05) + 0.5 * rain);

export function kindParams(kind: WeatherKind, calmWind: number): WeatherParams {
  const { cloudCover, rain } = STEADY[kind];
  return { cloudCover, rain, wetness: Math.min(1, Math.sqrt(rain)), wind: windFor(cloudCover, rain, calmWind), storm: kind === "storm" ? 1 : 0 };
}

export function daySchedule(seed: number, day: number, dayLengthMinutes: number, pattern: WeatherPattern): DaySchedule {
  const rand = mulberry32((seed ^ Math.imul(day + 1, 0x9e3779b1)) >>> 0);
  const roll = rand();
  // Treat base values as weights so a biome need not maintain a sum of exactly one.
  const baseTotal = pattern.baseWeather.clear + pattern.baseWeather.cloudy + pattern.baseWeather.overcast;
  const clearEnd = pattern.baseWeather.clear / baseTotal;
  const cloudyEnd = clearEnd + pattern.baseWeather.cloudy / baseTotal;
  const base: WeatherKind = roll < clearEnd ? "clear" : roll < cloudyEnd ? "cloudy" : "overcast";
  const maxHours = rainCapHours(dayLengthMinutes, pattern.maxRainMinutes);
  const length = Math.min(maxHours, lerp(pattern.rainHours[0], pattern.rainHours[1], rand()));
  const start = lerp(pattern.rainWindow[0], pattern.rainWindow[1] - length, rand());
  const wet = rand();
  const spells: Spell[] = [{ start, end: start + length, kind: wet < pattern.stormShare ? "storm" : wet < pattern.rainShare ? "rain" : "drizzle" }];
  if (rand() < pattern.showerChance) {
    const showerLength = Math.min(maxHours, lerp(pattern.showerHours[0], pattern.showerHours[1], rand()));
    const showerStart = lerp(pattern.showerWindow[0], pattern.showerWindow[1] - showerLength, rand());
    if (showerStart + showerLength + pattern.showerGap <= start || showerStart >= start + length + pattern.showerGap) {
      spells.push({ start: showerStart, end: showerStart + showerLength, kind: "drizzle" });
    }
  }
  return { base, spells };
}

export function weatherAt(seed: number, day: number, hour: number, dayLengthMinutes: number, pattern: WeatherPattern): WeatherParams {
  const today = daySchedule(seed, day, dayLengthMinutes, pattern), tomorrow = daySchedule(seed, day + 1, dayLengthMinutes, pattern);
  return sampleWeather({ cloudCover: 0, rain: 0, wetness: 0, wind: 0, storm: 0 }, today, tomorrow, hour, pattern.calmWind);
}

function sampleWeather(output: WeatherParams, today: DaySchedule, tomorrow: DaySchedule, hour: number, calmWind: number): WeatherParams {
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
  output.wind = windFor(cloudCover, rain, calmWind);
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
