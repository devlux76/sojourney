import type { Fish } from "./fish";

export type Tool = "pole" | "flint" | "axe" | "rations" | "flashlight";
export const SLOTS: Tool[] = ["pole", "flint", "axe", "rations", "flashlight"];
export const TOOL_NAMES: Record<Tool, string> = {
  pole: "fishing pole", flint: "flint and steel", axe: "axe", rations: "rations", flashlight: "flashlight",
};
export const MAX_LOGS = 12;

export interface StartingContents { tools: Tool[]; rations: number }
export const EASY_START: StartingContents = { tools: SLOTS, rations: 5 };

export class Rucksack {
  readonly tools: Set<Tool>;
  rations: number;
  logs = 0;
  rawFish: Fish[] = [];
  cookedFish: Fish[] = [];
  held: Tool | null = null;

  constructor(start: StartingContents) {
    this.tools = new Set(start.tools);
    this.rations = start.rations;
  }

  pressSlot(n: number) {
    const tool = SLOTS[n - 1];
    if (!tool || !this.tools.has(tool)) return;
    this.held = this.held === tool ? null : tool;
  }

  equip(tool: Tool) {
    if (!this.tools.has(tool) || this.held === tool) return;
    this.held = tool;
  }

  cycle(step: 1 | -1) {
    const order: (Tool | null)[] = [null, ...SLOTS.filter(t => this.tools.has(t))];
    const i = order.indexOf(this.held);
    this.held = order[(i + step + order.length) % order.length];
  }

  packLogs(n: number): number {
    const fit = Math.max(0, Math.min(n, MAX_LOGS - this.logs));
    this.logs += fit;
    return fit;
  }

  takeLogs(n: number): boolean {
    if (this.logs < n) return false;
    this.logs -= n;
    return true;
  }

  nextFood(): string | null {
    if (this.cookedFish.length) return `cooked ${this.cookedFish[0].species}`;
    return this.rations > 0 ? "a ration" : null;
  }

  eat(): string | null {
    const food = this.nextFood();
    if (this.cookedFish.length) this.cookedFish.shift();
    else if (this.rations > 0) this.rations--;
    return food;
  }

  lines(): string[] {
    const fish = (label: string, list: Fish[]) =>
      list.length ? [`  ${label}: ${list.map(f => `${f.species} ${f.lengthCm} cm`).join(", ")}`] : [];
    return [
      ...SLOTS.flatMap((t, i) => this.tools.has(t)
        ? [`${this.held === t ? "▸" : " "} ${i + 1} ${TOOL_NAMES[t]}${t === "rations" ? ` (${this.rations})` : ""}`]
        : []),
      `  logs ${this.logs}/${MAX_LOGS}`,
      ...fish("fish", this.rawFish),
      ...fish("cooked", this.cookedFish),
    ];
  }
}
