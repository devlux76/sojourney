export interface FishSpec { species: string; share: number; mean: number; spread: number; min: number; max: number }
export interface Fish { species: string; lengthCm: number }

export const BITE_DELAY = [10, 40];

export function catchFish(rand: () => number, table: FishSpec[]): Fish {
  const total = table.reduce((sum, f) => sum + f.share, 0);
  let roll = rand() * total, spec = table[table.length - 1];
  for (const f of table) {
    if (roll < f.share) { spec = f; break; }
    roll -= f.share;
  }
  const bell = (rand() + rand() + rand() - 1.5) / 0.5;
  return { species: spec.species, lengthCm: Math.round(Math.min(spec.max, Math.max(spec.min, spec.mean + bell * spec.spread))) };
}

export function biteDelay(rand: () => number): number {
  return BITE_DELAY[0] + (BITE_DELAY[1] - BITE_DELAY[0]) * rand();
}

export const WIND_UP_SECONDS = 1.2;
export const MIN_CAST = 5;
export const MAX_CAST = 40;

export function castPower(held: number): number {
  const phase = (held / WIND_UP_SECONDS) % 2;
  return phase <= 1 ? phase : 2 - phase;
}

export function castDistance(power: number): number {
  return MIN_CAST + (MAX_CAST - MIN_CAST) * power;
}

export const REEL_SPEED = 3;
export const RUN_SPEED = 0.6;
const TIGHTEN = 0.4;
const EASE = 0.8;
const HOOKED_TENSION = 0.5;
export const SLACK_SECONDS = 2.5;
export const LANDED = 1.5;
const SURGE_SECONDS = [1, 2.5];
const STEADY_LENGTH = 38;

export type FightEnd = "landed" | "snapped" | "lost";

export class Fight {
  tension = HOOKED_TENSION;
  private pull = 1;
  private surgeLeft = 0;
  private slack = 0;

  constructor(public distance: number, readonly fish: Fish) {}

  update(dt: number, reeling: boolean, rand: () => number): FightEnd | null {
    this.surgeLeft -= dt;
    if (this.surgeLeft <= 0) {
      this.pull = (this.fish.lengthCm / STEADY_LENGTH) * (0.6 + rand());
      this.surgeLeft = SURGE_SECONDS[0] + (SURGE_SECONDS[1] - SURGE_SECONDS[0]) * rand();
    }
    if (reeling) {
      this.distance -= REEL_SPEED * dt;
      this.tension += TIGHTEN * this.pull * dt;
    } else {
      this.distance += RUN_SPEED * this.pull * dt;
      this.tension = Math.max(0, this.tension - EASE * dt);
    }
    if (this.tension >= 1) return "snapped";
    this.slack = this.tension <= 0 ? this.slack + dt : 0;
    if (this.slack >= SLACK_SECONDS) return "lost";
    return this.distance <= LANDED ? "landed" : null;
  }
}

export type LineState = { kind: "idle" } | { kind: "waiting"; biteAt: number } | { kind: "hooked"; fight: Fight };

export class FishingLine {
  state: LineState = { kind: "idle" };

  constructor(private table: FishSpec[]) {}

  cast(now: number, rand: () => number) {
    this.state = { kind: "waiting", biteAt: now + biteDelay(rand) };
  }

  // A bite hooks the fish and starts the fight at once: the fish takes the bait and runs with it, and the
  // player answers by reeling. `distance` is how far out the bait lies. Returns "bite" on the frame it happens.
  update(now: number, rand: () => number, distance: number): "bite" | null {
    if (this.state.kind !== "waiting" || now < this.state.biteAt) return null;
    this.state = { kind: "hooked", fight: new Fight(distance, catchFish(rand, this.table)) };
    return "bite";
  }

  reel() {
    this.state = { kind: "idle" };
  }
}
