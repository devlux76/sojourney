# Weather

Weather has two inputs with different jobs:

- The weather engine in [`src/sky/Weather.ts`](./src/sky/Weather.ts) defines the shared mechanics: weather kinds and their physical values, deterministic sampling, transitions, and the scalar values sent to the rest of the scene.
- Each biome's `climate` data defines its pattern: the daily base-weather odds, rain and shower timing, event odds, storm/rain shares, calm wind, rain-duration cap, and random seed. The Crater Lake pattern lives in [`src/biomes/crater-lake/index.ts`](./src/biomes/crater-lake/index.ts).

The sampler does not create clouds, rain, fog, or lightning. The environment reads its values and those scene systems render or react to them. This is the boundary between weather as engine behavior and weather as biome content.

## Pattern data

`WeatherPattern` is the biome-facing contract. `weatherSeed` is passed separately to the sampler; changing it picks a different deterministic sequence without changing the pattern's probabilities.

| Field | Meaning |
|---|---|
| `baseWeather` | Relative weights for clear, cloudy, and overcast daily background conditions. The engine normalizes the weights, so they need not add to exactly one. |
| `rainWindow` | The allowed in-game-hour interval in which the main daily rain spell can start. |
| `rainHours` | The main spell's duration range in in-game hours. |
| `stormShare`, `rainShare` | Cumulative thresholds for the main spell's type: below `stormShare` is a storm; below `rainShare` is rain; the rest is drizzle. |
| `showerChance` | Probability that the day also gets a shorter shower. An accepted extra shower is always drizzle. |
| `showerWindow`, `showerHours` | Allowed start interval and duration range for that extra shower. |
| `showerGap` | Minimum separation, in in-game hours, between the extra shower and the main spell. Overlapping candidates are discarded; they are not moved or retried. |
| `calmWind` | The biome's wind baseline. Cloud cover and rain raise it; the engine caps the resulting wind value at one. |
| `maxRainMinutes` | Maximum real-time spell budget used when translating the rain duration cap to in-game hours. The engine reserves one minute of that budget for the rain's end ramp. |

For Crater Lake, the base weights are 50% clear, 35% cloudy, and 15% overcast. Main spells are 2.4–6 in-game hours, between hours 7.5 and 19; 20% are storms, 40% are rain, and 40% are drizzle. There is a 30% chance of a 1–2 hour drizzle shower starting between hours 2 and 20, if it can fit with a one-hour gap around the main spell. These settings use the biome's seed `20260715`.

## Schedule and sampling

`WeatherSampler` retains today's and tomorrow's schedules and a reusable `WeatherParams` output object. It regenerates the schedules only when the game day or the configured day length changes. A seeded Mulberry32 generator makes the schedules repeatable for a given biome seed and game day; frame-by-frame sampling does not draw new random weather.

Each day receives one base condition and one main rain spell. The optional shower is generated after it. Rain durations are limited by:

```text
(maxRainMinutes - 1) * 24 / dayLengthMinutes
```

This converts the biome's real-time duration cap into in-game hours. A shorter game day therefore permits a longer spell in in-game hours while preserving the intended real-time cap.

The sampler emits five normalized weather values:

| Value | Engine meaning |
|---|---|
| `cloudCover` | 0–1 sky coverage. The base condition eases from today's value to tomorrow's between in-game hours 22 and 24. Every rain spell adds a cloud envelope that leads rain by 1.2 hours and trails it by 1.8 hours. |
| `rain` | 0 when dry, 0.35 for drizzle, 1 for rain, and 1.4 for a storm downpour. Rain ramps up and down over 0.5 in-game hours at each spell edge. |
| `wetness` | 0–1 ground wetness. It rises over one in-game hour, follows the spell, then dries over three hours. Its target is the square root of rain strength, capped at one. |
| `wind` | `min(1, calmWind + 0.35 * max(0, cloudCover - 0.05) + 0.5 * rain)`. |
| `storm` | 0–1 storm intensity, following the main storm spell's rain envelope. It controls lightning and the storm-specific ambient-audio share. |

The daily cloud base only blends across midnight; rain spells belong to the current day. All those values are then eased by the environment over 20 real-time seconds. Pausing the environment makes that transition snap to its target instead.

The developer weather override uses the order in `WEATHER_KINDS`: clear, cloudy, overcast, drizzle, rain, storm; `-1` means automatic weather. An override supplies that kind's steady scalar values directly, but the environment still eases the visible scene toward them. In particular, an override storm targets rain `1.4` and storm `1`.

## Scene effects

`createEnvironment` samples weather before notifying its `onSky` observers. `buildWorld` then passes the weather values through the world-level sky event. The effects are spread across these systems:

- **Cloud deck** ([`Clouds.ts`](./src/engine/environment/Clouds.ts)): a camera-following layer 800 m above the lake, covering the 19 km sky radius. Its shader calculates five-octave fractal noise per cloud fragment. `cloudCover` determines density, `rain` darkens/shades it, and `wind` changes its drift speed. It is disabled when coverage is effectively zero.
- **Rain** ([`Rain.ts`](./src/engine/environment/Rain.ts)): a shared particle system with a 6,000-particle capacity. Its emission rate is `2,500 * rain` particles per second, so a full storm target requests 3,500 per second. A separate additive ground shader draws ripples within 40 m; it is enabled while rain is present.
- **Fog and draw culling** ([`Fog.ts`](./src/engine/environment/Fog.ts), [`world.ts`](./src/engine/world.ts), [`groundStream.ts`](./src/engine/groundStream.ts)): rain fog density grows with the square of rain strength. Its rain-only density is `sqrt(-ln(0.05)) * rain^2 / 150`. Ground leaves are omitted only when both the rain fog on the leaf and the rain veil behind it fully hide them; terrain blocks are omitted once all their leaves are hidden. Fully hidden props are disabled for drawing and shadowing, while their collision remains. Flora receives the same computed rain reach. LOD selection and physical streaming still use their own distances.
- **Lighting** ([`environment/index.ts`](./src/engine/environment/index.ts), [`cloudLighting.ts`](./src/engine/environment/cloudLighting.ts)): cloud cover dims direct sun, rain dims it slightly more, and the cloud deck supplies grey sky irradiance. Lightning adds a short flash to that irradiance.
- **Lightning** ([`Lightning.ts`](./src/engine/environment/Lightning.ts)): storm intensity scales the rate at which strikes count down to their next event. A strike constructs a forked GreasedLine bolt and short flash phases; the environment lights the sky with those flashes. The world schedules thunder audio after the bolt's distance-based sound delay.
- **Ground, water, and audio** ([`world.ts`](./src/engine/world.ts), [`TerrainMaterial.ts`](./src/engine/TerrainMaterial.ts), [`AmbientAudio.ts`](./src/engine/AmbientAudio.ts), [`WeatherAudio.ts`](./src/engine/WeatherAudio.ts)): wetness is sent to the terrain material; wind drives water-ripple drift; rain scales the rain-noise track and ducks other ambience. Ambient tracks tagged `rain` crossfade against tracks tagged `storm`.

## Why storms can show higher FPS

The strongest candidate is **rain-fog visibility culling**, not a cheap storm rendering path. Storms also add work: their higher rain target requests more rain particles, the cloud and rain shaders continue to run, and lightning periodically creates a bolt. No storm-specific fast renderer or “storm mode” frame-rate switch exists.

Rain culling uses `rainReach = sqrt(ln(1000)) / rainFogDensity`. At full steady rain (`rain = 1`) this is about 228 m; at the maximum storm target (`rain = 1.4`) it is about 116 m. These are source-derived distances at which less than 0.1% of an object's own colour remains, not FPS measurements. At full storm strength the squared fog density therefore lets the scene omit many more distant terrain/forest draws and props than ordinary rain. In a foliage-heavy view this can plausibly outweigh the added rain work and raise the observed frame rate. The reach is lower during the storm's ramps and the 20-second transition, and underwater visibility can impose an even shorter limit.

The exact contribution has not been profiled, so this is the most likely mechanism, not a measured attribution. The optimizer already benefits indirectly from it: it samples the FPS that results from the current weather and restores degraded settings after the rate stays above its recovery threshold.

## Optimizer decision

The optimizer's first visible lever is now synthetic haze (`src/engine/optimizerHaze.ts`,
wired in `src/engine/Optimizer.ts`, `src/engine/environment/Fog.ts`, `src/engine/world.ts`).
Each downgrade steps one rung — clear, drizzle-equivalent, rain-equivalent, storm-equivalent
density — and the haze fogs and veils exactly like rain, so the existing `rainReach` culling
skips only what the haze already hides. Harsher measures (resolution, post, shadows,
particles, render targets) follow only once the haze sits at storm levels; improvement mode
walks the rungs back to clear. Standing still means immersion, not a performance problem:
after several seconds without camera travel, or while the binoculars are out, the optimizer
shuts off and restores full beauty at once instead of trading it for frame rate. Motion
resumes tuning with a fresh window. An earlier revision of this note rejected the idea for fear of
hiding visible scenery; the rung design answers that by never culling ahead of its own fog.

Storms can cause that existing optimizer to **restore** detail when average FPS stays over the recovery threshold; the optimizer does not force storms or alter the weather. See [`src/engine/Optimizer.ts`](./src/engine/Optimizer.ts) for its one-minute FPS window, hysteresis thresholds, and optimization order.

## Biome ownership correction

The previous wiring only passed `weatherSeed` from a biome into `WeatherSampler`. Although `Biome.climate` already declared the rain windows, shower parameters, calm wind, and duration cap, the sampler duplicated those values as engine constants; it also kept the base-weather weights and storm/rain shares out of biome data. Those fields did not affect runtime weather.

The current wiring passes the biome's full climate pattern into the sampler. The shared `WeatherPattern` contract now also contains the base-weather weights and cumulative storm/rain shares, so biome data determines the schedule while engine code continues to implement the common weather physics and scene integration.
