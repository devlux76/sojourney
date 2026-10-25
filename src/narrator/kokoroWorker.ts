import { env, StyleTextToSpeech2Model, AutoTokenizer, Tensor } from "@huggingface/transformers";
import { phonemize } from "../vendor/kokoro/phonemize";

// Kokoro-82M speaking in a worker, so neither the model's download nor a slow card holds up a frame.
// The page tells it where to run and what to say; it answers with the samples.
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE_URL = `https://huggingface.co/${MODEL}/resolve/main/voices/`;
const SAMPLE_RATE = 24000;
const STYLE_DIM = 256;
// The model takes at most 510 phonemes at once, so a line is spoken a sentence at a time, with this
// much silence between sentences.
const SENTENCE_GAP_SECONDS = 0.3;

export type KokoroDevice = "webnn" | "webgpu-low" | "webgpu-high" | "wasm";
export type KokoroRequest =
  | { type: "load"; device: KokoroDevice; voice: string }
  | { type: "speak"; id: number; text: string; speed: number };
export type KokoroReply =
  | { type: "progress"; loaded: number; total: number }
  // The card the model was put on, as the browser names it, or "" where there is none to name.
  | { type: "loaded"; card: string }
  | { type: "spoken"; id: number; samples: Float32Array; sampleRate: number; tookMs: number }
  | { type: "error"; id?: number; message: string };

const post = (reply: KokoroReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(reply, transfer);

let model: StyleTextToSpeech2Model, tokenizer: AutoTokenizer, style: Float32Array, language: "a" | "b";

async function load(device: KokoroDevice, voice: string): Promise<string> {
  // The runtime asks for the high-performance card and takes no telling otherwise: its own
  // powerPreference and adapter settings were both tried and both ignored (ONNX Runtime Web 1.31).
  // So the request itself is answered here, in this worker only, with the card that was asked for.
  // The low-power one keeps the voice off the card the game is drawn with where there are two.
  const onnx = env.backends.onnx as { webgpu?: { device?: GPUDevice } };
  let card = "";
  if (device.startsWith("webgpu")) {
    const powerPreference = device === "webgpu-low" ? "low-power" : "high-performance";
    const request = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = options => request({ ...options, powerPreference });
  }
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    post({ type: "progress", loaded, total });
  };
  // The 8-bit model is a quarter of the download and only the processor can run it.
  const runOn = device === "webnn" || device === "wasm" ? device : "webgpu";
  const options = { device: runOn, dtype: device === "wasm" ? "q8" : "fp32", progress_callback } as const;
  [model, tokenizer, style] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(MODEL, options),
    AutoTokenizer.from_pretrained(MODEL),
    fetch(VOICE_URL + voice + ".bin").then(async r => new Float32Array(await r.arrayBuffer())),
  ]);
  language = voice.startsWith("b") ? "b" : "a";
  // The card the runtime really made its device on, which is what matters, where it says.
  const used = onnx.webgpu?.device?.adapterInfo;
  if (used) card = `${used.vendor} ${used.architecture}`;
  return card;
}

async function speak(text: string, speed: number): Promise<Float32Array> {
  const parts: Float32Array[] = [];
  const gap = new Float32Array(Math.round(SENTENCE_GAP_SECONDS * SAMPLE_RATE));
  for (const sentence of text.split(/(?<=[.!?;:])\s+/).filter(s => s.trim())) {
    const phonemes = await phonemize(sentence, language);
    const { input_ids } = (tokenizer as unknown as (text: string, options: object) => { input_ids: Tensor })(phonemes, { truncation: true });
    // Kokoro has a voice style for each length of line.
    const tokens = Math.min(Math.max(input_ids.dims.at(-1)! - 2, 0), 509);
    const { waveform } = await (model as unknown as (inputs: object) => Promise<{ waveform: Tensor }>)({
      input_ids,
      style: new Tensor("float32", style.slice(tokens * STYLE_DIM, (tokens + 1) * STYLE_DIM), [1, STYLE_DIM]),
      speed: new Tensor("float32", [speed], [1]),
    });
    if (parts.length) parts.push(gap);
    parts.push(waveform.data as Float32Array);
  }
  const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { samples.set(part, at); at += part.length; }
  return samples;
}

// One request at a time, in the order they came.
let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<KokoroRequest>) => {
  const request = e.data;
  queue = queue.then(async () => {
    try {
      if (request.type === "load") {
        post({ type: "loaded", card: await load(request.device, request.voice) });
      } else {
        const started = performance.now();
        const samples = await speak(request.text, request.speed);
        post({ type: "spoken", id: request.id, samples, sampleRate: SAMPLE_RATE, tookMs: performance.now() - started }, [samples.buffer]);
      }
    } catch (error) {
      post({ type: "error", id: request.type === "speak" ? request.id : undefined, message: String(error) });
    }
  });
};
