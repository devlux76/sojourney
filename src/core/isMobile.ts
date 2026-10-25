import { settings, DEFAULT_SETTINGS } from "./Settings";
import { resolveTouchLayout, type TouchMode } from "./touchControl";

function touchSignals() {
  return {
    coarse: matchMedia("(pointer: coarse)").matches,
    maxTouchPoints: navigator.maxTouchPoints,
    hasTouchStart: "ontouchstart" in window,
  };
}

export function touchLayoutActive(): boolean {
  return resolveTouchLayout(settings.touchUI, touchSignals());
}

export function setTouchLayout(mode: TouchMode, fallback: TouchMode = DEFAULT_SETTINGS.touchUI): boolean {
  const on = resolveTouchLayout(mode, touchSignals());
  document.body.classList.toggle("touch", on);
  return on;
}

export function suppressContextMenu() {
  document.addEventListener("contextmenu", e => e.preventDefault());
}
