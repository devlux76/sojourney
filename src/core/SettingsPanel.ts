import { settings, saveSettings, DEFAULT_SETTINGS, NumericSettingKey } from "./Settings";

export interface SettingControl {
  key: NumericSettingKey | (() => NumericSettingKey);
  label: string | (() => string);
  min: number;
  max: number;
  step: number;
  apply?: (value: number) => void;
}

export interface ValueControl {
  label: string | (() => string);
  min: number;
  max: number;
  step: number;
  get(): number;
  set(value: number): void;
}

export interface ChoiceControl {
  label: string | (() => string);
  choices: readonly string[];
  get(): string;
  set(value: string): void;
  apply?(): void;
}

export type PanelControl = SettingControl | ValueControl | ChoiceControl;

export interface SettingsPanel {
  readonly open: boolean;
  toggle(): void;
}

const TOGGLE_KEY = "Backquote";

export function createSettingsPanel(controls: PanelControl[], game: HTMLElement): SettingsPanel {
  const panel = document.createElement("div");
  panel.id = "settings";
  panel.hidden = true;

  const refreshAll = () => rows.forEach(refresh => refresh());
  const rows = controls.map((c) => {
    if ("choices" in c) {
      const row = document.createElement("div");
      row.className = "settings-choice";
      const name = document.createElement("span");
      const group = document.createElement("span");
      const buttons = c.choices.map(choice => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = choice;
        b.addEventListener("click", () => {
          c.set(choice);
          c.apply?.();
          saveSettings();
          refreshAll();
        });
        group.append(b);
        return { b, choice };
      });
      row.append(name, group);
      panel.append(row);
      return () => {
        name.textContent = typeof c.label === "function" ? c.label() : c.label;
        const current = c.get();
        for (const { b, choice } of buttons) b.classList.toggle("selected", choice === current);
      };
    }
    const row = document.createElement("label");
    const name = document.createElement("span");
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(c.min);
    input.max = String(c.max);
    input.step = String(c.step);
    const readout = document.createElement("output");
    const decimals = (String(c.step).split(".")[1] ?? "").length;
    const keyOf = (s: SettingControl) => (typeof s.key === "function" ? s.key() : s.key);
    const read = () => ("get" in c ? c.get() : settings[keyOf(c)]);

    input.addEventListener("input", () => {
      const value = Number(input.value);
      if ("get" in c) c.set(value);
      else {
        settings[keyOf(c)] = value;
        c.apply?.(value);
        saveSettings();
      }
      refreshAll();
    });

    row.append(name, input, readout);
    panel.append(row);
    return () => {
      name.textContent = typeof c.label === "function" ? c.label() : c.label;
      const value = read();
      input.value = String(value);
      readout.textContent = value.toFixed(decimals);
    };
  });

  const reset = document.createElement("button");
  reset.textContent = "Reset to defaults";
  reset.addEventListener("click", () => {
    Object.assign(settings, DEFAULT_SETTINGS);
    for (const c of controls) {
      if ("choices" in c) c.apply?.();
      else if (!("get" in c)) c.apply?.(settings[typeof c.key === "function" ? c.key() : c.key]);
    }
    saveSettings();
    refreshAll();
  });
  panel.append(reset);
  document.body.append(panel);
  refreshAll();

  const toggle = () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) refreshAll();
    else game.focus();
  };

  window.addEventListener("keydown", (e) => {
    if (e.code !== TOGGLE_KEY) return;
    toggle();
  });

  return { get open() { return !panel.hidden; }, toggle };
}
