import type { Action } from "../play/actions";
import { ACTION_ICON, clusterSlot, isHoldAction } from "../play/actions";
import { createHoldButton, type HoldButton } from "../core/touchControl";
import type { PlayerController } from "../engine/player/PlayerController";
import type { Play } from "../play/Play";

const DIVE_SLOT = 2;

interface Satellite {
  button: HTMLButtonElement;
  action: Action | null;
  hold: HoldButton;
}

function button(kind: string, slot?: number): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `touch-btn ${kind}`;
  if (slot !== undefined) b.dataset.slot = String(slot);
  b.addEventListener("touchstart", e => {
    e.preventDefault();
    e.stopPropagation();
    const touch = e.changedTouches[0];
    if (touch) b.dispatchEvent(new CustomEvent("holdpress", { detail: touch.identifier }));
  }, { passive: false });
  b.addEventListener("touchend", e => e.stopPropagation(), { passive: false });
  b.addEventListener("touchcancel", e => e.stopPropagation(), { passive: false });
  b.addEventListener("contextmenu", e => e.preventDefault());
  return b;
}

export class ActionCluster {
  private root: HTMLDivElement;
  private satellites: Satellite[] = [];
  private jump: HTMLButtonElement;
  private dive: HTMLButtonElement;

  constructor(private play: Play, private player: PlayerController) {
    this.root = document.createElement("div");
    this.root.id = "touch-cluster";
    this.jump = button("jump");
    this.jump.textContent = "⤒";
    this.jump.title = "Jump";
    this.dive = button("dive");
    this.dive.textContent = "↓";
    this.dive.title = "Dive";
    this.dive.hidden = true;
    this.root.append(this.jump, this.dive);
    document.body.append(this.root);

    hold(this.jump, () => this.player.setVirtualKey("Space", true),
      () => this.player.setVirtualKey("Space", false), () => !this.play.isBlocked());
    hold(this.dive, () => this.player.setVirtualKey("KeyC", true),
      () => this.player.setVirtualKey("KeyC", false), () => this.play.underwaterView);

    for (let slot = 0; slot < 4; slot++) {
      const b = button("satellite", slot);
      b.hidden = true;
      this.root.append(b);
      const entry: Satellite = { button: b, action: null, hold: null as unknown as HoldButton };
      entry.hold = createHoldButton(
        { down: () => this.pressDown(entry.action), up: () => this.play.letGo() },
        () => !this.play.isBlocked() && entry.action !== null,
      );
      b.addEventListener("holdpress", e => entry.hold.press((e as CustomEvent<number>).detail));
      b.addEventListener("touchend", () => entry.hold.releaseAll(), { passive: false });
      b.addEventListener("touchcancel", () => entry.hold.releaseAll(), { passive: false });
      this.satellites.push(entry);
    }
    window.addEventListener("blur", () => this.satellites.forEach(s => s.hold.releaseAll()));
  }

  render(actions: Action[], resting: boolean) {
    const shown = resting ? (["stand up"] as Action[]) : actions;
    for (let slot = 0; slot < this.satellites.length; slot++) {
      const entry = this.satellites[slot];
      const takenByDive = this.play.underwaterView && slot === DIVE_SLOT;
      const action = takenByDive ? null : shown.find(a => clusterSlot(a) === slot) ?? null;
      entry.action = action;
      entry.button.hidden = action === null;
      if (action === null) {
        entry.hold.releaseAll();
        continue;
      }
      entry.button.textContent = ACTION_ICON[action];
      entry.button.classList.toggle("holding", isHoldAction(action));
    }
    this.dive.hidden = !this.play.underwaterView;
  }

  private pressDown(action: Action | null) {
    if (action) this.play.pressAction(action);
  }
}

function hold(b: HTMLButtonElement, down: () => void, up: () => void, canDown: () => boolean): void {
  const state = createHoldButton({ down, up }, canDown);
  b.addEventListener("holdpress", e => state.press((e as CustomEvent<number>).detail));
  b.addEventListener("touchend", () => state.releaseAll(), { passive: false });
  b.addEventListener("touchcancel", () => state.releaseAll(), { passive: false });
}
