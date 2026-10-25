import { CreateAudioEngineAsync } from "@babylonjs/core/AudioV2/webAudio/webAudioEngine";
import { CreateSoundAsync, CreateStreamingSoundAsync, CreateSoundBufferAsync, CreateAudioBusAsync } from "@babylonjs/core/AudioV2/abstractAudio/audioEngineV2";
import { StaticSound } from "@babylonjs/core/AudioV2/abstractAudio/staticSound";
import type { StreamingSound } from "@babylonjs/core/AudioV2/abstractAudio/streamingSound";
import type { Biome, AmbientCondition } from "../biomes/Biome";

// The speed at which the footstep recording plays as recorded (the walking speed); the loop plays
// faster or slower with the player's speed, within these limits.
const FOOTSTEP_PACE = 2.5;
const FOOTSTEP_RATE = [0.8, 1.5];
// Slower than this is standing still.
const WALKING_ABOVE = 0.3;
// The footsteps carry on this long after the last walking frame: a walker leaves the ground for a frame or
// two on every bump, and stopping the loop each time chops the sound up.
const FOOTSTEP_HOLD_MS = 250;
// Footsteps on the ground come up from silence over this long once the walking starts, so the first
// step is not a jolt.
const FOOTSTEP_FADE_IN_SECONDS = 2.5;
// Metres between two steps on wood, where each step is its own recording.
const STRIDE = 0.8;
// Thunder is at full volume this close and falls to the least share this far off, where it is also
// played slower, so a distant strike is a low rumble.
const THUNDER_NEAR = 400;
const THUNDER_FAR = 6000;
const THUNDER_FAR_VOLUME = 0.25;
const THUNDER_FAR_RATE = 0.7;
// The ship's bell is at full volume this close to the ship and falls to the least share this far off:
// the place is so quiet that it carries everywhere. It is heard from the side the ship lies on, never
// wholly in one ear.
const BELL_NEAR = 30;
const BELL_FAR = 4000;
const BELL_FAR_VOLUME = 0.3;
const BELL_PAN = 0.8;
// The tour guide waits this long before speaking, so the bell that rings at the same moment is heard first.
export const GUIDE_DELAY_SECONDS = 3;
// A loop's volume is only sent to the audio engine when it has moved by this much.
const VOLUME_STEP = 0.01;
// A short recording is not looped whole: snippets of it are played, each this share of the recording
// long from a random start, fading in and out over this share of the snippet.
const SNIPPET_SHARE = [0.4, 0.9];
const SNIPPET_FADE = 0.1;

// What the ambient loops are mixed by, each 0 to 1.
// shore is how close the lake's edge is, 1 beside it or on the lake.
export interface AmbientConditions { daylight: number; rain: number; storm: number; underwater: boolean; aboard: boolean; shore: number; }

export interface AmbientAudio {
  // Scales the ambient loops, 0 to 1 (rain quietens them).
  setLevel(level: number): void;
  // Called every frame: sets each ambient loop's volume from the conditions it is for.
  setConditions(conditions: AmbientConditions): void;
  // Called every frame with the player's speed on foot (0 when not walking), what is underfoot and the
  // frame's seconds.
  setMovement(walkingSpeed: number, surface: "ground" | "wood", dt: number): void;
  // Plays a thunderclap for a strike this far away.
  thunder(distanceMetres: number): void;
  // Rings the ship's bell, heard from this far away and from this side: -1 is the ship straight to the
  // left, 1 straight to the right, 0 ahead or behind.
  bell(distanceMetres: number, side: number): void;
  // The tour guide speaks: a recording by its address, or a line a live voice has just made.
  // Answers when the line starts sounding and when it ends, so the game can turn the player to
  // what is talked about for exactly that long. A line still being spoken gives way to the next:
  // its waiters are released at once. Both promises always resolve, never reject.
  guide(line: string | AudioBuffer, volume: number): { started: Promise<void>; done: Promise<void> };
}

// A loop that is paused and resumed, so it carries on from where it stopped. Each time it resumes it
// fades in from silence to its volume.
class Loop {
  private playing = false;
  private started = false;
  constructor(readonly sound: StaticSound, private volume: number, private fadeInSeconds: number) {}

  run(on: boolean) {
    if (on === this.playing) return;
    this.playing = on;
    if (!on) return this.sound.pause();
    this.sound.setVolume(0);
    if (this.started) this.sound.resume();
    else this.sound.play();
    this.sound.setVolume(this.volume, { duration: this.fadeInSeconds });
    this.started = true;
  }
}

// Plays a short recording so that it does not sound like a loop (the project lead's method, from DJing):
// two decks on the same recording take turns with a snippet that starts and stops at random places,
// each fading in and out over a tenth of its length, and the next snippet starts as the last one fades.
class Snippets {
  private deck = 0;

  constructor(private decks: StaticSound[], private seconds: number) {}

  next = () => {
    const length = this.seconds * (SNIPPET_SHARE[0] + (SNIPPET_SHARE[1] - SNIPPET_SHARE[0]) * Math.random());
    const fade = length * SNIPPET_FADE;
    const sound = this.decks[this.deck];
    this.deck = 1 - this.deck;
    sound.setVolume(0);
    sound.play({ startOffset: Math.random() * (this.seconds - length), duration: length });
    sound.setVolume(1, { duration: fade });
    setTimeout(() => { sound.setVolume(0, { duration: fade }); this.next(); }, (length - fade) * 1000);
  };
}

// How much each condition holds, 0 to 1. A track's share is the product of the conditions it names, so
// tracks cross-fade as the weather and the light change. A storm takes over from rain.
function share(when: AmbientCondition[], c: AmbientConditions): number {
  const rain = Math.min(1, c.rain);
  let result = 1;
  for (const condition of when) {
    result *= condition === "day" ? c.daylight : condition === "night" ? 1 - c.daylight
      : condition === "dry" ? 1 - rain : condition === "rain" ? rain * (1 - c.storm)
      : condition === "storm" ? c.storm : condition === "underwater" ? +c.underwater : condition === "surface" ? +!c.underwater
      : condition === "aboard" ? +c.aboard : condition === "ashore" ? +!c.aboard : c.shore;
  }
  return result;
}

// Plays the biome's recordings on Babylon's audio engine: the ambient tracks by the conditions each is
// for, the footsteps while walking, and thunder when asked. A long ambient recording is streamed and
// looped whole; a short one is played in snippets through a bus that carries the track's volume.
export function startAmbientAudio(biome: Biome): AmbientAudio {
  let ambient: { out: { volume: number }; volume: number; when: AmbientCondition[]; sent: number }[] = [];
  let ground: Loop | null = null, wood: StaticSound[] = [], thunder: StaticSound | null = null, bell: StaticSound | null = null;
  let level = 1, lastStep = -Infinity, sinceStep = 0;
  let ready = false, voice: StreamingSound | StaticSound | null = null, voiceTimer = 0;
  // The waiters of the line currently counting down or sounding, released when it ends or gives way.
  let guideStart: (() => void) | null = null, guideEnd: (() => void) | null = null;
  (async () => {
    const engine = await CreateAudioEngineAsync({ volume: 0.3 });
    // Browsers keep audio locked until the player presses or touches something; the snippets start then.
    const snippets: Snippets[] = [];
    let begun = false;
    const begin = () => {
      window.removeEventListener("keydown", begin);
      window.removeEventListener("pointerdown", begin);
      void engine.unlockAsync().then(() => {
        if (begun) return;
        begun = true;
        for (const snippet of snippets) snippet.next();
      });
    };
    window.addEventListener("keydown", begin);
    window.addEventListener("pointerdown", begin);
    const steps = biome.footstepAudio;
    [ambient, ground, wood, thunder, bell] = await Promise.all([
      Promise.all(biome.ambientAudio.map(async (track, i) => {
        if (track.stream) {
          const sound = await CreateStreamingSoundAsync(`ambient${i}`, track.url, { loop: true, volume: 0 });
          setTimeout(() => sound.play(), track.delaySeconds * 1000);
          return { out: sound, volume: track.volume, when: track.when ?? [], sent: 0 };
        }
        const [buffer, bus] = await Promise.all([CreateSoundBufferAsync(track.url), CreateAudioBusAsync(`ambient${i}`, { volume: 0 })]);
        const decks = await Promise.all([0, 1].map(deck => CreateSoundAsync(`ambient${i}deck${deck}`, buffer, { volume: 0, maxInstances: 1, outBus: bus })));
        const snippet = new Snippets(decks, buffer.duration);
        snippets.push(snippet);
        // A recording that arrives after the audio was unlocked starts at once.
        if (begun) snippet.next();
        return { out: bus, volume: track.volume, when: track.when ?? [], sent: 0 };
      })),
      steps?.ground ? CreateSoundAsync("footsteps", steps.ground.url, { loop: true, volume: 0 }).then(s => new Loop(s, steps.ground!.volume, FOOTSTEP_FADE_IN_SECONDS)) : null,
      Promise.all((steps?.wood?.urls ?? []).map((url, i) => CreateSoundAsync(`woodStep${i}`, url, { volume: steps!.wood!.volume }))),
      biome.thunderAudio ? CreateSoundAsync("thunder", biome.thunderAudio.url, { volume: biome.thunderAudio.volume, maxInstances: 4 }) : null,
      biome.shipBellAudio ? CreateSoundAsync("shipBell", biome.shipBellAudio.url, { volume: biome.shipBellAudio.volume, stereoEnabled: true }) : null,
    ]);
    ready = true;
  })().catch(e => console.warn("Audio initialization failed:", e));

  return {
    setLevel: (l: number) => { level = l; },
    setConditions: conditions => {
      for (const track of ambient) {
        const volume = track.volume * level * share(track.when, conditions);
        if (Math.abs(volume - track.sent) < VOLUME_STEP && (volume > 0 || track.sent === 0)) continue;
        track.out.volume = track.sent = volume;
      }
    },
    setMovement: (walkingSpeed, surface, dt) => {
      const now = performance.now(), walking = walkingSpeed > WALKING_ABOVE;
      if (walking && surface === "ground") {
        lastStep = now;
        if (ground) ground.sound.playbackRate = Math.min(FOOTSTEP_RATE[1], Math.max(FOOTSTEP_RATE[0], walkingSpeed / FOOTSTEP_PACE));
      }
      ground?.run(now - lastStep < FOOTSTEP_HOLD_MS);
      if (!walking || surface !== "wood" || wood.length === 0) return;
      sinceStep += walkingSpeed * dt;
      if (sinceStep < STRIDE) return;
      sinceStep = 0;
      wood[Math.floor(Math.random() * wood.length)].play();
    },
    thunder: distanceMetres => {
      if (!thunder || !biome.thunderAudio) return;
      const far = Math.min(1, Math.max(0, (distanceMetres - THUNDER_NEAR) / (THUNDER_FAR - THUNDER_NEAR)));
      thunder.volume = biome.thunderAudio.volume * (1 - (1 - THUNDER_FAR_VOLUME) * far);
      thunder.playbackRate = 1 - (1 - THUNDER_FAR_RATE) * far;
      thunder.play();
    },
    bell: (distanceMetres, side) => {
      if (!bell || !biome.shipBellAudio) return;
      const far = Math.min(1, Math.max(0, (distanceMetres - BELL_NEAR) / (BELL_FAR - BELL_NEAR)));
      bell.volume = biome.shipBellAudio.volume * (1 - (1 - BELL_FAR_VOLUME) * far);
      // Close by, the bell is all around; the side it comes from grows with the distance to the ship.
      bell.stereo.pan = BELL_PAN * side * Math.min(1, distanceMetres / (4 * BELL_NEAR));
      bell.play();
    },
    guide: (line, volume) => {
      // Before the engine is ready nothing will sound: wait for nothing.
      if (!ready) return { started: Promise.resolve(), done: Promise.resolve() };
      // A line still being spoken gives way to the next: its waiters stop waiting now, and a
      // countdown that never sounded releases its starter too.
      clearTimeout(voiceTimer);
      voice?.dispose();
      voice = null;
      guideStart?.();
      guideStart = null;
      guideEnd?.();
      guideEnd = null;
      let start!: () => void, end!: () => void;
      const started = new Promise<void>(resolve => { start = resolve; });
      const done = new Promise<void>(resolve => { end = resolve; });
      guideStart = start;
      guideEnd = end;
      voiceTimer = window.setTimeout(() => {
        guideStart = null;
        const made: Promise<StreamingSound | StaticSound> = typeof line === "string"
          ? CreateStreamingSoundAsync("tourGuide", line, { volume }) : CreateSoundAsync("tourGuide", line, { volume });
        void made.then(sound => {
          voice = sound;
          sound.onEndedObservable.addOnce(() => {
            // An ended recording is done with: free it unless a newer line already took its place.
            if (voice === sound) { sound.dispose(); voice = null; }
            if (guideEnd === end) guideEnd = null;
            end();
          });
          sound.play();
          start();
        }).catch(e => {
          console.warn("Tour guide failed:", e);
          if (guideEnd === end) guideEnd = null;
          start();
          end();
        });
      }, GUIDE_DELAY_SECONDS * 1000);
      return { started, done };
    },
  };
}
