import { TOUCH_MODES, type TouchMode } from "./touchControl";

const STORAGE_KEY = "sojourney.settings";

// Whether the tour boat's bell is heard, and likewise its guide's voice.
export const BELL_MODES = ["on", "off"] as const;
export type BellMode = (typeof BELL_MODES)[number];

// Lead-requested comparison control: off restores full detail and pauses tuning.
export const OPTIMIZATION_MODES = ["on", "off"] as const;
export type OptimizationMode = (typeof OPTIMIZATION_MODES)[number];

// Whether the sun casts shadows. Off is the instant test for blotches that might be shadows.
export const SHADOW_MODES = ["on", "off"] as const;
export type ShadowMode = (typeof SHADOW_MODES)[number];

// Whether the SSAO2 post-process runs. Off by default: on the classic render loop it has
// fought the optimizer before (ghosted frames, fog lighting the far shore).
export type SsaoMode = 0 | 1 | 2 | 3 | 4;

export const DEFAULT_SETTINGS = {
  underwaterVisibility: 40,
  underwaterHue: 205,
  underwaterBrightness: 0.45,
  underwaterCaustics: 0.6,
  dayLengthMinutes: 120,
  weatherOverride: -1,
  moonScale: 7,
  headBob: 1,
  targetFps: 50,
  sceneOptimization: "on" as OptimizationMode,
  touchUI: "auto" as TouchMode,
  shipBell: "on" as BellMode,
  tourGuide: "on" as BellMode,
  ssao: 1 as SsaoMode, // 1 is default
  sunShadows: "on" as ShadowMode,
};

// The values each setting that is a choice may take.
const CHOICES: Partial<Record<SettingKey, readonly string[]>> = { touchUI: TOUCH_MODES, shipBell: BELL_MODES, tourGuide: BELL_MODES, sunShadows: SHADOW_MODES, sceneOptimization: OPTIMIZATION_MODES };

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export type NumericSettingKey = {
  [K in SettingKey]: (typeof DEFAULT_SETTINGS)[K] extends number ? K : never;
}[SettingKey];

export const settings = { ...DEFAULT_SETTINGS, ...loadSettings() };

function loadSettings(): Partial<typeof DEFAULT_SETTINGS> {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return Object.fromEntries(Object.entries(stored).filter(([k, v]) => k in DEFAULT_SETTINGS && isStoredValue(k as SettingKey, v)));
  } catch {
    return {};
  }
}

function isStoredValue(key: SettingKey, value: unknown): value is number | string {
  if (typeof DEFAULT_SETTINGS[key] === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === "string" && (CHOICES[key] ?? []).includes(value);
}

export function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
  }
}
