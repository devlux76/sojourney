export const LOG_BURN_SECONDS = 180;
export const EMBER_SECONDS = 90;
export const MAX_FUEL_LOGS = 5;
export const LOGS_TO_LAY = 3;
export const COOK_SECONDS = 20;

export type FirePhase = "laid" | "burning" | "embers" | "ash";

export class FireState {
  phase: FirePhase = "laid";
  fuel = LOGS_TO_LAY * LOG_BURN_SECONDS;
  readonly strikesNeeded: number;
  private strikes = 0;
  private emberLeft = 0;

  constructor(roll: number) {
    this.strikesNeeded = 1 + Math.min(2, Math.floor(roll * 3));
  }

  strike(): boolean {
    if (this.phase !== "laid") return false;
    if (++this.strikes < this.strikesNeeded) return false;
    this.phase = "burning";
    return true;
  }

  canAddLog(): boolean {
    return this.phase === "embers" || this.phase === "ash"
      || (this.phase === "burning" && this.fuel <= (MAX_FUEL_LOGS - 1) * LOG_BURN_SECONDS);
  }

  addLog() {
    if (!this.canAddLog()) return;
    if (this.phase === "ash") {
      this.phase = "laid";
      this.strikes = 0;
      this.fuel = LOG_BURN_SECONDS;
      return;
    }
    this.fuel = (this.phase === "embers" ? 0 : this.fuel) + LOG_BURN_SECONDS;
    this.phase = "burning";
  }

  tick(dt: number) {
    if (this.phase === "burning") {
      this.fuel -= dt;
      if (this.fuel <= 0) {
        this.fuel = 0;
        this.phase = "embers";
        this.emberLeft = EMBER_SECONDS;
      }
    } else if (this.phase === "embers") {
      this.emberLeft -= dt;
      if (this.emberLeft <= 0) this.phase = "ash";
    }
  }

  flame(): number {
    return this.phase === "burning" ? 0.5 + 0.5 * Math.min(1, this.fuel / (2 * LOG_BURN_SECONDS)) : 0;
  }

  glow(): number {
    return this.phase === "embers" ? this.emberLeft / EMBER_SECONDS : 0;
  }
}
