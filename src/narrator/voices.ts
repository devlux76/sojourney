import type { KokoroDevice, KokoroReply, KokoroRequest } from "./kokoroWorker";
import type { LiquidPower } from "./writerWorker";
import type { WriterKind } from "./writers";

// The voices the tour guide can speak with, and what the self-test found out about this machine.
// "recorded" is the recordings in the pack (tools/build_narration.py), which always work; "browser"
// is the browser's own speech (the Web Speech API); "kokoro" is Kokoro-82M run live here.
export type VoiceKind = "recorded" | "browser" | "kokoro";
export const KOKORO_VOICE = "af_heart";
export const KOKORO_SPEED = 0.95;
// What each way of running Kokoro downloads, in megabytes, for the player to be told.
export const KOKORO_DOWNLOAD_MB: Record<KokoroDevice, number> = { webnn: 310, "webgpu-low": 310, "webgpu-high": 310, wasm: 88 };
// Speech from Kokoro peaks at 0.5 to 0.8 and its loudness measured 0.07 to 0.085. A faulty card gives
// anything from a quiet hiss just over 1 to peaks in the millions, with no error raised
// (docs/specs/2026-10-03-voice-self-test-design.md), so the limits sit close to real speech.
const PEAK_LIMIT = 1;
const LOUDNESS_RANGE = [0.03, 0.3];
const STORAGE_KEY = "sojourney.narrator";

export interface NarratorChoice {
  voice: VoiceKind;
  // How Kokoro passed the self-test here, when it did.
  kokoroDevice: KokoroDevice | null;
  // Set for good once the live voice has taken the page down while on a graphics card: from then on
  // it runs on the processor only, slower as that is.
  gpuUnstable: boolean;
  // Who writes what the guide says (see writers.ts), and the card our narrator model passed on.
  writer: WriterKind;
  liquidPower: LiquidPower | null;
  // 0 to 1, the guide's loudness as the player set it.
  volume: number;
  // The browser and graphics cards the self-test last ran on; a change runs it again.
  signature: string;
}

// The loudness the guide starts at; the pack's own volume for the guide is what this setting gives.
export const DEFAULT_VOLUME = 0.8;
const DEFAULT_CHOICE: NarratorChoice = { voice: "recorded", kokoroDevice: null, gpuUnstable: false, writer: "script", liquidPower: null, volume: DEFAULT_VOLUME, signature: "" };

export function loadChoice(): NarratorChoice {
  try {
    return { ...DEFAULT_CHOICE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_CHOICE };
  }
}

export function saveChoice(choice: NarratorChoice) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
  }
}

// A live voice can hang a graphics card, which takes the browser's drawing down with it: the game goes
// blank and nothing here gets the chance to say so (seen on Intel UHD 630 on Linux, 2026-10-03). So a
// mark is left while the voice is at work and wiped when it is done; a mark still there at the next
// start means the page died under it. Once is enough: the graphics card is marked unstable for the
// voice and the voice moves to the processor, and if it died there too the recorded guide is put back.
const BUSY_KEY = "sojourney.narrator.busy";

export function markLiveVoiceBusy(busy: boolean) {
  try {
    if (busy) localStorage.setItem(BUSY_KEY, "1");
    else localStorage.removeItem(BUSY_KEY);
  } catch {
  }
}

// True once after a start that found the mark; the choice is changed as above and saved.
export function liveVoiceDiedLastTime(choice: NarratorChoice): boolean {
  let died = false;
  try {
    died = localStorage.getItem(BUSY_KEY) !== null;
  } catch {
  }
  if (!died) return false;
  markLiveVoiceBusy(false);
  if (choice.voice === "kokoro" && choice.kokoroDevice !== "wasm") Object.assign(choice, { gpuUnstable: true, kokoroDevice: "wasm" });
  else Object.assign(choice, { gpuUnstable: true, voice: "recorded", writer: "script", kokoroDevice: null });
  saveChoice(choice);
  return true;
}

export interface Detected {
  // The cards WebGPU offers, low-power first; the same card twice where there is only one.
  adapters: { low: string | null; high: string | null };
  webnn: boolean;
  browserVoices: SpeechSynthesisVoice[];
  signature: string;
}

async function adapterName(powerPreference: GPUPowerPreference): Promise<string | null> {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference }).catch(() => null);
  return adapter ? `${adapter.info.vendor} ${adapter.info.architecture}`.trim() : null;
}

// The browser lists its voices late, on an event, so they are waited for a little.
function browserVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!("speechSynthesis" in window)) return Promise.resolve([]);
  return new Promise(resolve => {
    const now = speechSynthesis.getVoices();
    if (now.length) return resolve(now);
    speechSynthesis.addEventListener("voiceschanged", () => resolve(speechSynthesis.getVoices()), { once: true });
    setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
  });
}

export async function detect(): Promise<Detected> {
  const [low, high, voices] = await Promise.all([adapterName("low-power"), adapterName("high-performance"), browserVoices()]);
  const browser = navigator.userAgent.match(/(Chrome|Firefox|Version)\/[\d.]+/)?.[0] ?? navigator.userAgent;
  return { adapters: { low, high }, webnn: "ml" in navigator, browserVoices: voices, signature: `${browser} | ${low} | ${high}` };
}

// The ways of running Kokoro worth trying here, best first; the processor alone once a graphics card
// has been marked unstable for the voice.
export function kokoroCandidates(detected: Detected, gpuUnstable: boolean): KokoroDevice[] {
  if (gpuUnstable) return ["wasm"];
  const { low, high } = detected.adapters;
  return [
    ...(detected.webnn ? ["webnn" as const] : []),
    ...(low ? ["webgpu-low" as const] : []),
    ...(high && high !== low ? ["webgpu-high" as const] : []),
    "wasm",
  ];
}

export interface Spoken { samples: Float32Array; sampleRate: number; tookMs: number }

// Kokoro in its worker: loaded once for a device, then asked for one line after another.
export class Kokoro {
  private worker = new Worker(new URL("./kokoroWorker.ts", import.meta.url), { type: "module" });
  private waiting = new Map<number, { resolve(spoken: Spoken): void; reject(error: Error): void }>();
  private nextId = 0;
  readonly ready: Promise<void>;
  // The graphics card the voice was put on, once it is ready.
  card = "";

  constructor(readonly device: KokoroDevice, onProgress?: (loaded: number, total: number) => void) {
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<KokoroReply>) => {
        const reply = e.data;
        if (reply.type === "progress") onProgress?.(reply.loaded, reply.total);
        else if (reply.type === "loaded") { this.card = reply.card; resolve(); }
        else if (reply.type === "spoken") this.waiting.get(reply.id)?.resolve(reply);
        else if (reply.id === undefined) reject(new Error(reply.message));
        else this.waiting.get(reply.id)?.reject(new Error(reply.message));
        if (reply.type === "spoken" || (reply.type === "error" && reply.id !== undefined)) this.waiting.delete(reply.id!);
      };
      this.worker.onerror = e => reject(new Error(e.message));
    });
    this.send({ type: "load", device, voice: KOKORO_VOICE });
  }

  private send(request: KokoroRequest) {
    this.worker.postMessage(request);
  }

  async speak(text: string): Promise<Spoken> {
    await this.ready;
    const id = this.nextId++;
    markLiveVoiceBusy(true);
    return new Promise<Spoken>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.send({ type: "speak", id, text, speed: KOKORO_SPEED });
    }).finally(() => { if (!this.waiting.size) markLiveVoiceBusy(false); });
  }

  dispose() {
    this.worker.terminate();
    markLiveVoiceBusy(false);
  }
}

// Whether what a voice produced is speech, by its numbers alone.
export function fault(samples: Float32Array): string | null {
  let sum = 0, peak = 0;
  for (const v of samples) {
    if (!Number.isFinite(v)) return "it produced values that are not numbers";
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  const loudness = Math.sqrt(sum / Math.max(1, samples.length));
  if (peak > PEAK_LIMIT) return "it produced noise, not speech";
  if (loudness < LOUDNESS_RANGE[0]) return "it produced silence";
  if (loudness > LOUDNESS_RANGE[1]) return "it produced noise, not speech";
  return null;
}

// A longer sentence for the test as well as the caller's phrase: a faulty card can speak one length
// of line properly and turn another into noise.
const LONGER_PHRASE = "Seven thousand seven hundred years ago a mountain stood here, a mile higher than the rim above us.";
// A voice that takes longer than this over one of the test phrases is no use here, whatever it produces.
const TEST_LIMIT_SECONDS = 90;

function within<T>(seconds: number, work: Promise<T>): Promise<T> {
  return Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("it took too long")), seconds * 1000))]);
}

export interface KokoroResult {
  device: KokoroDevice;
  // Null when it works; otherwise why it does not, in words for the player.
  fault: string | null;
  // Seconds of work for each second of speech, once warmed up; under 1 keeps up with talking.
  pace: number;
  sample: Spoken | null;
}

// Tries each way of running Kokoro in turn on one phrase and stops at the first that speaks properly,
// which is handed back still loaded, to speak more; the caller disposes of it.
export async function testKokoro(detected: Detected, gpuUnstable: boolean, phrase: string, onStep: (text: string) => void): Promise<{ results: KokoroResult[]; kokoro: Kokoro | null }> {
  const results: KokoroResult[] = [];
  for (const device of kokoroCandidates(detected, gpuUnstable)) {
    const megabytes = (bytes: number) => Math.round(bytes / 1e6);
    const kokoro = new Kokoro(device, (loaded, total) => onStep(`Downloading the voice: ${megabytes(loaded)} of ${megabytes(total)} MB`));
    try {
      await kokoro.ready;
      onStep("Trying the voice…");
      // The first line pays for setting the card up, so the second is the one timed.
      const first = await within(TEST_LIMIT_SECONDS, kokoro.speak(phrase));
      const sample = await within(TEST_LIMIT_SECONDS, kokoro.speak(LONGER_PHRASE));
      const problem = fault(first.samples) ?? fault(sample.samples);
      results.push({ device, fault: problem, pace: sample.tookMs / 1000 / (sample.samples.length / sample.sampleRate), sample: problem ? null : first });
      if (!problem) return { results, kokoro };
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      results.push({ device, fault: message === "it took too long" ? message : `it would not run (${message.slice(-70).trim()})`, pace: Infinity, sample: null });
    }
    kokoro.dispose();
  }
  return { results, kokoro: null };
}

// Speaks with the browser's own voice. It answers when the speech ends, or says why it could not.
export function browserSpeak(text: string, volume: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = Math.min(1, volume);
    utterance.rate = KOKORO_SPEED;
    utterance.onend = () => resolve();
    utterance.onerror = e => reject(new Error(e.error));
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  });
}

export function toAudioBuffer(spoken: Spoken): AudioBuffer {
  const buffer = new AudioBuffer({ length: spoken.samples.length, sampleRate: spoken.sampleRate, numberOfChannels: 1 });
  buffer.copyToChannel(spoken.samples as Float32Array<ArrayBuffer>, 0);
  return buffer;
}
