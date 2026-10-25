import type { LiquidPower, WriterReply, WriterRequest } from "./writerWorker";
import type { Detected } from "./voices";

// Who writes what the guide says. "script" is our own written lines, word for word; "browser" is the
// language model built into the browser, where it has one (Chrome's Prompt API); "liquid" is our own
// narrator model, Liquid AI's LFM2.5-1.2B-Instruct, downloaded and run on the player's graphics card.
// A model is given our lines as its notes and asked to tell them in its own words, never to add facts.
export type WriterKind = "script" | "browser" | "liquid";
// The 4-bit model's files, for the player to be told.
export const LIQUID_DOWNLOAD_MB = 900;

export const GUIDE_BRIEF = "You are the guide on a boat tour of Crater Lake, speaking aloud to your passengers. "
  + "Be calm, warm and unhurried. Use only the facts in the notes you are given and add none of your own. "
  + "Answer in three to five plain sentences, under ninety words, with no lists, headings or stage directions.";

// What each narrator is asked at the sound check, for the player to compare their answers.
export const TRIAL_QUESTION = "How did Crater Lake form?";
export const TRIAL_ASK = `A passenger asks: "${TRIAL_QUESTION}" Answer from these notes: `
  + "Mount Mazama was a volcano about a mile higher than the rim is today. About 7,700 years ago it erupted, emptied itself "
  + "in a few days and collapsed, leaving a caldera. Rain and snow filled it over centuries; no river runs in or out. "
  + "The lake is 1,943 feet deep, the deepest in the United States.";
export function arrivalAsk(stop: string, notes: string): string {
  return `The ship has just stopped at ${stop}. Tell the passengers about it in your own words, from these notes: ${notes}`;
}

// Whether what a model wrote can be spoken as it stands: some words, not too many, in plain letters.
// A model on a faulty card writes nothing, or symbols.
export function unusable(text: string): string | null {
  const words = text.trim().split(/\s+/).length;
  if (words < 12) return "it wrote almost nothing";
  if (words > 160) return "it wrote far too much";
  const plain = (text.match(/[A-Za-z0-9 ,.;:'"!?()\n-]/g) ?? []).length / text.length;
  return plain < 0.97 ? "it wrote symbols, not sentences" : null;
}

export interface Writer {
  write(ask: string): Promise<string>;
  dispose(): void;
}

// The browser's own language model, as far as this code uses it (Chrome's Prompt API).
interface BrowserModel {
  availability(): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
  create(options: object): Promise<{ prompt(text: string): Promise<string>; destroy(): void }>;
}
const browserModel = (): BrowserModel | undefined => (globalThis as { LanguageModel?: BrowserModel }).LanguageModel;

// "available" when it can be used at once, "downloadable" when the browser must fetch it first.
export async function browserWriterState(): Promise<"none" | "downloadable" | "available"> {
  const state = await browserModel()?.availability().catch(() => "unavailable" as const);
  return state === "available" ? "available" : state === "downloadable" || state === "downloading" ? "downloadable" : "none";
}

export async function browserWriter(onProgress?: (share: number) => void): Promise<Writer> {
  const session = await browserModel()!.create({
    initialPrompts: [{ role: "system", content: GUIDE_BRIEF }],
    monitor: (m: EventTarget) => m.addEventListener("downloadprogress", e => onProgress?.((e as ProgressEvent).loaded)),
  });
  return { write: ask => session.prompt(ask), dispose: () => session.destroy() };
}

// Our narrator model in its worker: loaded once on a card, then asked for one piece after another.
export class Liquid implements Writer {
  private worker = new Worker(new URL("./writerWorker.ts", import.meta.url), { type: "module" });
  private waiting = new Map<number, { resolve(text: string): void; reject(error: Error): void }>();
  private nextId = 0;
  readonly ready: Promise<void>;
  // How long the last piece took to write, in seconds, and the graphics card the model is on.
  lastSeconds = 0;
  card = "";

  constructor(readonly power: LiquidPower, onProgress?: (loaded: number, total: number) => void) {
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<WriterReply>) => {
        const reply = e.data;
        if (reply.type === "progress") onProgress?.(reply.loaded, reply.total);
        else if (reply.type === "loaded") { this.card = reply.card; resolve(); }
        else if (reply.type === "written") { this.lastSeconds = reply.tookMs / 1000; this.waiting.get(reply.id)?.resolve(reply.text); }
        else if (reply.id === undefined) reject(new Error(reply.message));
        else this.waiting.get(reply.id)?.reject(new Error(reply.message));
        if (reply.type === "written" || (reply.type === "error" && reply.id !== undefined)) this.waiting.delete(reply.id!);
      };
      this.worker.onerror = e => reject(new Error(e.message));
    });
    this.send({ type: "load", power });
  }

  private send(request: WriterRequest) {
    this.worker.postMessage(request);
  }

  async write(ask: string): Promise<string> {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.send({ type: "write", id, brief: GUIDE_BRIEF, ask });
    });
  }

  dispose() {
    this.worker.terminate();
  }
}

export interface LiquidResult { power: LiquidPower; fault: string | null; text: string; seconds: number }

// Tries our narrator model on each graphics card in turn with the trial question and stops at the
// first that writes something usable. The stronger card comes first: the model is a gigabyte of work
// for each answer, and its answers are made ahead, between stops, so it need not keep off the game's card.
export async function testLiquid(detected: Detected, onStep: (text: string) => void): Promise<LiquidResult[]> {
  const { low, high } = detected.adapters;
  const powers: LiquidPower[] = [...(high ? ["high-performance" as const] : []), ...(low && low !== high ? ["low-power" as const] : [])];
  const results: LiquidResult[] = [];
  for (const power of powers) {
    const megabytes = (bytes: number) => Math.round(bytes / 1e6);
    const liquid = new Liquid(power, (loaded, total) => onStep(`Downloading the narrator: ${megabytes(loaded)} of ${megabytes(total)} MB`));
    try {
      await liquid.ready;
      onStep("Asking the narrator…");
      const text = await liquid.write(TRIAL_ASK);
      results.push({ power, fault: unusable(text), text, seconds: liquid.lastSeconds });
      if (!unusable(text)) break;
    } catch (error) {
      results.push({ power, fault: `it would not start (${String(error).slice(0, 80)})`, text: "", seconds: 0 });
    } finally {
      liquid.dispose();
    }
  }
  if (!powers.length) results.push({ power: "high-performance", fault: "this browser offers no graphics card to run it on", text: "", seconds: 0 });
  return results;
}
