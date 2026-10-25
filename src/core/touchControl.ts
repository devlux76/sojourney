export const WALK_SPEED = 0.1;
export const RUN_SPEED = 0.2;

export const DEAD_ZONE = 0.15;
export const RUN_THRESHOLD = 0.92;

export const TOUCH_TURN_RATE = 1.9;

export const STICK_RADIUS = 62;

const STICK_ZONE_RIGHT = 0.45;
const STICK_ZONE_TOP = 0.3;

export interface StickVector { x: number; y: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function stickVector(dx: number, dy: number): StickVector {
  const length = Math.hypot(dx, dy);
  if (length <= STICK_RADIUS) return { x: dx / STICK_RADIUS, y: dy / STICK_RADIUS };
  return { x: (dx / length) * 1, y: (dy / length) * 1 };
}

export function stickMagnitude(v: StickVector): number {
  return Math.min(1, Math.hypot(v.x, v.y));
}

export function stickWalk(magnitude: number): number {
  return clamp((magnitude - DEAD_ZONE) / (1 - DEAD_ZONE), 0, 1);
}

export function stickRunning(magnitude: number): boolean {
  return magnitude >= RUN_THRESHOLD;
}

export function stickSpeed(magnitude: number): number {
  if (stickRunning(magnitude)) return RUN_SPEED;
  return WALK_SPEED * stickWalk(magnitude);
}

export type StickKey = "KeyW" | "KeyS";

export function moveKey(magnitude: number, y: number): StickKey | null {
  if (!stickWalk(magnitude)) return null;
  return y < 0 ? "KeyW" : y > 0 ? "KeyS" : null;
}

const STICK_KEYCODES: Record<StickKey, number> = { KeyW: 87, KeyS: 83 };

export function stickKeyCode(key: StickKey | null): number | null {
  return key === null ? null : STICK_KEYCODES[key];
}

export function yawDelta(x: number, dt: number): number {
  return x * TOUCH_TURN_RATE * dt;
}

export function pitchDelta(y: number, dt: number): number {
  return y * TOUCH_TURN_RATE * dt;
}

export function inStickZone(x: number, y: number, width: number, height: number): boolean {
  return x <= width * STICK_ZONE_RIGHT && y >= height * STICK_ZONE_TOP;
}

export interface HoldHandlers {
  down(): void;
  up(): void;
}

export interface HoldButton {
  isDown(): boolean;
  press(id: number): void;
  release(id: number): void;
  releaseAll(): void;
}

export function createHoldButton(handlers: HoldHandlers, canDown: () => boolean): HoldButton {
  const held = new Set<number>();
  return {
    isDown: () => held.size > 0,
    press(id: number) {
      if (held.has(id) || !canDown()) return;
      held.add(id);
      handlers.down();
    },
    release(id: number) {
      if (!held.delete(id)) return;
      handlers.up();
    },
    releaseAll() {
      if (held.size === 0) return;
      held.clear();
      handlers.up();
    },
  };
}

export const TOUCH_MODES = ["auto", "on", "off"] as const;
export type TouchMode = (typeof TOUCH_MODES)[number];

export interface TouchSignals { coarse: boolean; maxTouchPoints: number; hasTouchStart: boolean }

export function resolveTouchLayout(mode: string, signals: TouchSignals): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return signals.coarse || signals.maxTouchPoints > 0 || signals.hasTouchStart;
}
