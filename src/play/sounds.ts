const VOLUME = 0.35;
let context: AudioContext | null | undefined;

function audio(): AudioContext | null {
  if (context === undefined) {
    try {
      context = new AudioContext();
    } catch (e) {
      console.warn("Play sounds unavailable:", e);
      context = null;
    }
  }
  return context;
}

function burst(seconds: number, type: BiquadFilterType, frequency: number, volume: number, delay = 0) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
  source.buffer = buffer;
  filter.type = type;
  filter.frequency.value = frequency;
  gain.gain.setValueAtTime(volume * VOLUME, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
  source.connect(filter).connect(gain).connect(c.destination);
  source.start(t);
}

function tone(from: number, to: number, seconds: number, volume: number, type: OscillatorType = "sine", delay = 0) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const osc = c.createOscillator(), gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + seconds);
  gain.gain.setValueAtTime(volume * VOLUME, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + seconds);
}

function wash(seconds: number, from: number, to: number, volume: number, delay = 0) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
  source.buffer = buffer;
  filter.type = "lowpass";
  filter.Q.value = 1.5;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + seconds);
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.exponentialRampToValueAtTime(volume * VOLUME, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
  source.connect(filter).connect(gain).connect(c.destination);
  source.start(t);
}

function spool(seconds: number, volume: number) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = c.createBufferSource(), filter = c.createBiquadFilter();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.Q.value = 2;
  filter.frequency.setValueAtTime(3500, t);
  filter.frequency.exponentialRampToValueAtTime(1500, t + seconds);
  const ticks = c.createGain(), tick = c.createOscillator(), depth = c.createGain();
  ticks.gain.value = 0.5;
  depth.gain.value = 0.5;
  tick.type = "square";
  tick.frequency.setValueAtTime(70, t);
  tick.frequency.exponentialRampToValueAtTime(12, t + seconds);
  tick.connect(depth).connect(ticks.gain);
  const gain = c.createGain();
  gain.gain.setValueAtTime(volume * VOLUME, t);
  gain.gain.linearRampToValueAtTime(volume * VOLUME * 0.6, t + seconds * 0.8);
  gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
  source.connect(filter).connect(ticks).connect(gain).connect(c.destination);
  source.start(t);
  tick.start(t);
  tick.stop(t + seconds);
}

export const sounds = {
  thunk: () => { tone(140, 60, 0.18, 0.8, "triangle"); burst(0.08, "bandpass", 900, 0.6); },
  treeFall: () => { burst(1.2, "lowpass", 400, 0.7); burst(0.6, "lowpass", 180, 0.9, 1.4); },
  spark: () => { burst(0.05, "highpass", 4000, 0.5); burst(0.04, "highpass", 5000, 0.3, 0.07); },
  cast: () => { tone(700, 250, 0.25, 0.15); burst(0.2, "highpass", 2500, 0.2); },
  spool: (seconds: number) => spool(seconds, 0.35),
  plop: () => {
    wash(0.35, 3000, 400, 0.7);
    tone(180, 420, 0.07, 0.3);
    for (const [delay, freq] of [[0.09, 2200], [0.15, 1700], [0.22, 2600]]) burst(0.03, "bandpass", freq, 0.15, delay);
  },
  reel: () => { for (let i = 0; i < 8; i++) burst(0.02, "highpass", 3000, 0.25, i * 0.06); },
  splash: () => burst(0.5, "bandpass", 800, 0.6),
  eat: () => { for (let i = 0; i < 3; i++) burst(0.07, "bandpass", 2500, 0.4, i * 0.18); },
  tick: (frequency: number, volume: number) => burst(0.015, "highpass", frequency, volume),
  click: () => burst(0.02, "highpass", 2000, 0.4),
  pack: () => burst(0.12, "lowpass", 600, 0.5),
};

// A recording from the pack, fetched and decoded the first time it is wanted. play() is a single shot;
// run() keeps it looping while on, fading in and out.
class Recording {
  private buffer: AudioBuffer | null = null;
  private loading = false;
  private loop: GainNode | null = null;
  private on = false;

  constructor(private url: string, private volume: number) {}

  private load(c: AudioContext, then: () => void) {
    if (this.buffer) { then(); return; }
    if (this.loading) return;
    this.loading = true;
    fetch(this.url).then(r => r.arrayBuffer()).then(data => c.decodeAudioData(data))
      .then(buffer => { this.buffer = buffer; then(); })
      .catch(e => console.warn(`Sound unavailable (${this.url}):`, e));
  }

  play() {
    const c = audio();
    if (!c) return;
    this.load(c, () => {
      const source = c.createBufferSource(), gain = c.createGain();
      source.buffer = this.buffer;
      gain.gain.value = this.volume * VOLUME;
      source.connect(gain).connect(c.destination);
      source.start();
    });
  }

  run(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    const c = audio();
    if (!c) return;
    this.load(c, () => {
      if (!this.loop) {
        const source = c.createBufferSource();
        source.buffer = this.buffer;
        source.loop = true;
        this.loop = c.createGain();
        this.loop.gain.value = 0;
        source.connect(this.loop).connect(c.destination);
        source.start();
      }
      this.loop.gain.setTargetAtTime(this.on ? this.volume * VOLUME : 0, c.currentTime, 0.08);
    });
  }
}

export interface FishingSounds {
  // The bait landing on the water.
  plop(): void;
  // Called every frame of a fight with whether the player is reeling. Returns true when recordings carry
  // the reeling, so the caller leaves out its synthesised ratchet.
  reeling(on: boolean): boolean;
}

// Fishing's sounds from the biome's recordings: the plop, and while the player reels a fish in, the reel
// and the fish splashing together. A biome without recordings gets the synthesised plop.
export function fishingSounds(recordings: { plop: { url: string; volume: number }; reel: { url: string; volume: number }; fish: { url: string; volume: number } } | null): FishingSounds {
  if (!recordings) return { plop: sounds.plop, reeling: () => false };
  const plop = new Recording(recordings.plop.url, recordings.plop.volume);
  const reel = new Recording(recordings.reel.url, recordings.reel.volume);
  const fish = new Recording(recordings.fish.url, recordings.fish.volume);
  return {
    plop: () => plop.play(),
    reeling: on => { reel.run(on); fish.run(on); return true; },
  };
}

// The crackle of the nearest fire: synthesised pops, and in rain a recording of a fire with a hiss in
// it, as loud as the rain is heavy.
export class Crackle {
  private level = 0;
  private rain = 0;
  private next = 0;
  private hiss: GainNode | null = null;
  private loading = false;

  constructor(private rainHiss: { url: string; volume: number } | null = null) {}

  setLevel(level: number, rain = 0) {
    this.level = level;
    this.rain = Math.min(1, rain);
  }

  // Fetches the recording the first time a fire burns in rain and loops it through its own gain.
  private async loadHiss(c: AudioContext, url: string) {
    this.loading = true;
    try {
      const source = c.createBufferSource();
      source.buffer = await c.decodeAudioData(await (await fetch(url)).arrayBuffer());
      source.loop = true;
      const gain = c.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(c.destination);
      source.start();
      this.hiss = gain;
    } catch (e) {
      console.warn("Campfire rain sound unavailable:", e);
    }
  }

  update(now: number) {
    const wet = this.level * this.rain;
    if (this.rainHiss) {
      const c = audio();
      if (c && !this.hiss && !this.loading && wet > 0.02) void this.loadHiss(c, this.rainHiss.url);
      if (c && this.hiss) this.hiss.gain.setTargetAtTime(wet * this.rainHiss.volume * VOLUME, c.currentTime, 0.3);
    }
    if (this.level < 0.02 || now < this.next) return;
    this.next = now + 0.04 + Math.random() * 0.25;
    burst(0.02 + Math.random() * 0.05, "bandpass", 1500 + Math.random() * 3000, this.level * (0.2 + Math.random() * 0.5));
  }
}
