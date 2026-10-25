// The tour ship keeps her own time. Each stop has an hour of the day that shows its sight in its best
// light, and the ship's time runs between those hours with the distance she has covered, so she always
// arrives at the right hour however long the leg took. It is shown only to a player aboard; ashore the
// world's own clock is shown, and that clock is never altered by this.
export interface ShipLeg {
  // Every stop in the order she comes to it, with its distance along the loop and its hour.
  stops: readonly { distance: number; hours: number }[];
  // The loop's length in metres, and the hour she comes back to the first stop at the end of a lap.
  length: number;
  returnHour: number;
  // The stop she lies at or last left, and where she is along the loop.
  stop: number;
  distance: number;
  dwelling: boolean;
  // True from her return to the first stop until she casts off again: the evening holds at the dock,
  // and the new morning begins as she leaves.
  lapDone: boolean;
}

export function shipHours(leg: ShipLeg): number {
  const from = leg.stops[leg.stop];
  if (leg.dwelling) return leg.stop === 0 && leg.lapDone ? leg.returnHour : from.hours;
  const next = (leg.stop + 1) % leg.stops.length;
  const span = (leg.stops[next].distance - from.distance + leg.length) % leg.length || leg.length;
  const covered = (leg.distance - from.distance + leg.length) % leg.length;
  // An hour ahead that reads earlier than the one behind is tomorrow's.
  let to = next === 0 ? leg.returnHour : leg.stops[next].hours;
  if (to < from.hours) to += 24;
  return (from.hours + (to - from.hours) * Math.min(1, covered / span)) % 24;
}

// An hour of the day as a passenger would say it: "3:40 pm".
export function clockTime(hours: number): string {
  const minutes = Math.floor((((hours % 24) + 24) % 24) * 60 + 1e-6);
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
