import { env, AutoModelForCausalLM, AutoTokenizer, type PreTrainedModel, type PreTrainedTokenizer, type Tensor } from "@huggingface/transformers";

// Our own narrator model, Liquid AI's LFM2.5-1.2B-Instruct, writing in a worker on the graphics card.
// The page gives it the guide's brief and what to write about; it answers with the words.
const MODEL = "LiquidAI/LFM2.5-1.2B-Instruct-ONNX";
const LONGEST_ANSWER_TOKENS = 220;

export type LiquidPower = "low-power" | "high-performance";
export type WriterRequest =
  | { type: "load"; power: LiquidPower }
  | { type: "write"; id: number; brief: string; ask: string };
export type WriterReply =
  | { type: "progress"; loaded: number; total: number }
  // The card the model was put on, as the browser names it.
  | { type: "loaded"; card: string }
  | { type: "written"; id: number; text: string; tookMs: number }
  | { type: "error"; id?: number; message: string };

const post = (reply: WriterReply) => (self as unknown as Worker).postMessage(reply);
let model: PreTrainedModel, tokenizer: PreTrainedTokenizer;

async function load(power: LiquidPower): Promise<string> {
  // The runtime asks for the high-performance card and ignores its own settings for choosing another
  // (see kokoroWorker.ts), so the request is answered here, in this worker only, with the card wanted.
  const request = navigator.gpu.requestAdapter.bind(navigator.gpu);
  navigator.gpu.requestAdapter = options => request({ ...options, powerPreference: power });
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    post({ type: "progress", loaded, total });
  };
  [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(MODEL),
    AutoModelForCausalLM.from_pretrained(MODEL, { device: "webgpu", dtype: "q4", progress_callback }),
  ]);
  const used = (env.backends.onnx as { webgpu?: { device?: GPUDevice } }).webgpu?.device?.adapterInfo;
  return used ? `${used.vendor} ${used.architecture}` : "";
}

async function write(brief: string, ask: string): Promise<string> {
  const input = tokenizer.apply_chat_template([{ role: "system", content: brief }, { role: "user", content: ask }],
    { add_generation_prompt: true, return_dict: true }) as { input_ids: Tensor };
  // The same words every time for the same request: no sampling.
  const output = await model.generate({ ...input, max_new_tokens: LONGEST_ANSWER_TOKENS, do_sample: false }) as Tensor;
  const asked = input.input_ids.dims.at(-1)!;
  return tokenizer.decode((output.tolist() as bigint[][])[0].slice(asked), { skip_special_tokens: true }).trim();
}

let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<WriterRequest>) => {
  const request = e.data;
  queue = queue.then(async () => {
    try {
      if (request.type === "load") {
        post({ type: "loaded", card: await load(request.power) });
      } else {
        const started = performance.now();
        post({ type: "written", id: request.id, text: await write(request.brief, request.ask), tookMs: performance.now() - started });
      }
    } catch (error) {
      post({ type: "error", id: request.type === "write" ? request.id : undefined, message: String(error) });
    }
  });
};
