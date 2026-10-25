import { stickVector, inStickZone, STICK_RADIUS, type StickVector } from "../core/touchControl";

const TRIM_SETTLE_MS = 120;

export class TouchStick {
  private pad: HTMLDivElement;
  private knob: HTMLDivElement;
  private owner: number | null = null;
  private origin = { x: 0, y: 0 };
  private vector: StickVector = { x: 0, y: 0 };
  private trimming: number | null = null;
  private trimStart = { x: 0, y: 0 };
  private trimIdle = 0;

  constructor(private onStick: (v: StickVector) => void, private onTrim: (rate: number) => void) {
    this.pad = document.createElement("div");
    this.pad.id = "touch-stick";
    this.knob = document.createElement("div");
    this.knob.className = "knob";
    this.pad.append(this.knob);
    document.body.append(this.pad);
    this.reset();
    document.addEventListener("touchstart", e => this.onStart(e), { passive: false });
    document.addEventListener("touchmove", e => this.onMove(e), { passive: false });
    document.addEventListener("touchend", e => this.onEnd(e), { passive: false });
    document.addEventListener("touchcancel", e => this.onEnd(e), { passive: false });
    window.addEventListener("blur", () => this.reset());
  }

  reset() {
    this.owner = null;
    this.trimming = null;
    this.stopTrim();
    this.vector = { x: 0, y: 0 };
    this.knob.style.transform = "translate(0px, 0px)";
    this.pad.style.transform = "";
    this.onStick(this.vector);
  }

  private anchorPad(x: number, y: number) {
    this.pad.style.transform = "";
    const box = this.pad.getBoundingClientRect();
    const cx = Math.min(Math.max(x, box.width / 2), innerWidth - box.width / 2);
    const cy = Math.min(Math.max(y, box.height / 2), innerHeight - box.height / 2);
    this.pad.style.transform = `translate(${cx - box.left - box.width / 2}px, ${cy - box.top - box.height / 2}px)`;
  }

  private onControl(touch: Touch): boolean {
    const el = touch.target as Element | null;
    return !!el?.closest("#touch-stick, #touch-cluster, #touch-sheet, #touch-sheet-toggle, #settings");
  }

  private allOnWorld(e: TouchEvent): boolean {
    for (const touch of e.changedTouches) if (this.onControl(touch)) return false;
    return true;
  }

  private onStart(e: TouchEvent) {
    if (this.allOnWorld(e)) e.preventDefault();
    for (const touch of e.changedTouches) {
      if (this.onControl(touch)) continue;
      if (this.owner === null && inStickZone(touch.clientX, touch.clientY, innerWidth, innerHeight)) {
        this.owner = touch.identifier;
        this.origin = { x: touch.clientX, y: touch.clientY };
        this.knob.style.transform = "translate(0px, 0px)";
        this.anchorPad(touch.clientX, touch.clientY);
      } else if (this.trimming === null) {
        this.trimming = touch.identifier;
        this.trimStart = { x: touch.clientX, y: touch.clientY };
      }
    }
  }

  private onMove(e: TouchEvent) {
    if (this.allOnWorld(e)) e.preventDefault();
    for (const touch of e.changedTouches) {
      if (touch.identifier === this.owner) {
        this.vector = stickVector(touch.clientX - this.origin.x, touch.clientY - this.origin.y);
        this.knob.style.transform =
          `translate(${this.vector.x * STICK_RADIUS}px, ${this.vector.y * STICK_RADIUS}px)`;
        this.onStick(this.vector);
      } else if (touch.identifier === this.trimming) {
        const dy = touch.clientY - this.trimStart.y;
        this.trimStart = { x: touch.clientX, y: touch.clientY };
        this.onTrim(Math.max(-1, Math.min(1, dy / STICK_RADIUS)));
        clearTimeout(this.trimIdle);
        this.trimIdle = window.setTimeout(() => this.onTrim(0), TRIM_SETTLE_MS);
      }
    }
  }

  private onEnd(e: TouchEvent) {
    for (const touch of e.changedTouches) {
      if (touch.identifier === this.owner) this.reset();
      if (touch.identifier === this.trimming) {
        this.trimming = null;
        this.stopTrim();
      }
    }
  }

  private stopTrim() {
    this.onTrim(0);
    clearTimeout(this.trimIdle);
    this.trimIdle = 0;
  }
}
