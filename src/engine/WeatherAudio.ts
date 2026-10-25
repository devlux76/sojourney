import type { Observable } from "@babylonjs/core/Misc/observable";
import type { WorldSky } from "./world";

const RAIN_VOLUME = 0.0625;
const AMBIENCE_DUCK = 0.3;
const OPEN_AIR_CUTOFF = 7000;
const UNDERWATER_CUTOFF = 500;
const NOISE_SECONDS = 4;

export class WeatherAudio {
  private gain?: GainNode;
  private filter?: BiquadFilterNode;
  private context?: AudioContext;

  constructor(dayNight: { onSky: Observable<WorldSky> }, setAmbienceLevel: (level: number) => void) {
    const start = () => {
      window.removeEventListener("keydown", start);
      window.removeEventListener("pointerdown", start);
      this.start();
    };
    window.addEventListener("keydown", start);
    window.addEventListener("pointerdown", start);

    dayNight.onSky.add((s: WorldSky) => {
      setAmbienceLevel(1 - AMBIENCE_DUCK * s.weather.rain);
      if (!this.context) return;
      const now = this.context.currentTime;
      this.gain!.gain.setTargetAtTime(RAIN_VOLUME * s.weather.rain, now, 0.5);
      this.filter!.frequency.setTargetAtTime(s.underwater ? UNDERWATER_CUTOFF : OPEN_AIR_CUTOFF, now, 0.1);
    });
  }

  private start() {
    try {
      const ctx = new AudioContext();
      const buffer = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = 0.6 * last + 0.4 * (Math.random() * 2 - 1);
        data[i] = last;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 400;
      this.filter = ctx.createBiquadFilter();
      this.filter.type = "lowpass";
      this.filter.frequency.value = OPEN_AIR_CUTOFF;
      this.gain = ctx.createGain();
      this.gain.gain.value = 0;
      source.connect(highpass).connect(this.filter).connect(this.gain).connect(ctx.destination);
      source.start();
      this.context = ctx;
    } catch (e) {
      console.warn("Rain audio unavailable:", e);
    }
  }
}
