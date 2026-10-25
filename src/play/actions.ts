import { Tool, SLOTS, MAX_LOGS } from "./rucksack";
import { FirePhase, LOGS_TO_LAY } from "./fireRules";
import type { LineState } from "./fish";

export type Target =
  | { kind: "none" } | { kind: "tree" } | { kind: "log" } | { kind: "water" } | { kind: "seat" }
  | { kind: "ground"; fireOk: boolean }
  | { kind: "fire"; phase: FirePhase; canAddLog: boolean; cooking: boolean };

export interface PackView {
  held: Tool | null;
  tools: ReadonlySet<Tool>;
  logs: number;
  rawFish: number;
  food: string | null;
  lightOn: boolean;
  line: LineState["kind"];
}

export type Action =
  | "chop" | "pack log" | "lay fire" | "strike" | "add log" | "cook fish" | "cast" | "reel" | "eat" | "light on" | "light off"
  | "sit" | "stand up";

// The action Enter does now.
export function decide(target: Target, pack: PackView): Action | null {
  return decideAll(target, pack)[0] ?? null;
}

// Every action possible now, the most wanted first. A tool counts whether it is in hand or in the rucksack:
// doing the action takes it out, so the player never has to pick the tool first. Fishing in progress and food
// chosen to eat come before what the player is looking at; the flashlight's switch comes after everything.
export function decideAll(target: Target, pack: PackView): Action[] {
  const wanted = [
    pack.line !== "idle" ? "reel" : null,
    pack.held === "rations" && pack.food ? "eat" : null,
    toolAction(target, pack),
    handsFreeAction(target, pack),
    pack.held === "flashlight" ? (pack.lightOn ? "light off" : "light on") : null,
  ];
  return wanted.filter((action): action is Action => action !== null);
}

export const ACTION_ICON: Record<Action, string> = {
  cast: "🎣", reel: "🎣", chop: "🪓", strike: "✨",
  "pack log": "🪵", "add log": "🪵", "lay fire": "🔥", "cook fish": "🐟",
  eat: "🍽️", "light on": "🔦", "light off": "🔦",
  sit: "💺", "stand up": "🧍",
};

export const ACTION_TOOL: Record<Action, Tool | null> = {
  cast: "pole", reel: "pole", chop: "axe", strike: "flint", eat: "rations",
  "light on": "flashlight", "light off": "flashlight",
  "pack log": null, "add log": null, "lay fire": null, "cook fish": null,
  sit: null, "stand up": null,
};

export const HOLD_ACTIONS: readonly Action[] = ["cast", "reel"];

export function isHoldAction(action: Action): boolean {
  return HOLD_ACTIONS.includes(action);
}

export function slotFor(action: Action, tools: ReadonlySet<Tool>): number | null {
  const tool = ACTION_TOOL[action];
  if (!tool || !tools.has(tool)) return null;
  return SLOTS.indexOf(tool) + 1 || null;
}

const CLUSTER_SLOTS: Partial<Record<Action, number>> = {
  cast: 0, reel: 0, eat: 3, "light on": 3, "light off": 3,
  chop: 1, strike: 1, sit: 1,
  "pack log": 2, "add log": 2, "lay fire": 2, "cook fish": 2,
};

export function clusterSlot(action: Action): number {
  return CLUSTER_SLOTS[action] ?? 2;
}

// What a tool the player owns can do to the thing looked at.
function toolAction(t: Target, p: PackView): Action | null {
  switch (t.kind) {
    case "water": return p.tools.has("pole") && p.line === "idle" ? "cast" : null;
    case "fire": return p.tools.has("flint") && t.phase === "laid" ? "strike" : null;
    case "tree": return p.tools.has("axe") ? "chop" : null;
    default: return null;
  }
}

function handsFreeAction(t: Target, p: PackView): Action | null {
  switch (t.kind) {
    case "log": return p.logs < MAX_LOGS ? "pack log" : null;
    case "seat": return "sit";
    case "ground": return t.fireOk && p.logs >= LOGS_TO_LAY ? "lay fire" : null;
    case "fire":
      if (t.phase === "burning" && p.rawFish > 0 && !t.cooking) return "cook fish";
      return p.logs > 0 && t.canAddLog ? "add log" : null;
    default: return null;
  }
}
