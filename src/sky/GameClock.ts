export interface Calendar { startMonth: number; startDay: number; stayLengthDays: number; startHour: number }
export const CRATER_LAKE_CALENDAR: Calendar = { startMonth: 6, startDay: 15, stayLengthDays: 60, startHour: 9.5 };
export const STAY_LENGTH_DAYS = CRATER_LAKE_CALENDAR.stayLengthDays;
export const START_HOUR = CRATER_LAKE_CALENDAR.startHour;
const CRATER_LAKE_UTC_OFFSET = -7;
const STAY_KEY = "sojourney.stayDay";

export class GameClock {
  constructor(public day: number, public hours = START_HOUR, private year = new Date().getFullYear(),
    private calendar: Calendar = CRATER_LAKE_CALENDAR, private utcOffsetHours = CRATER_LAKE_UTC_OFFSET) {}

  advance(realSeconds: number, dayLengthMinutes: number): boolean {
    this.hours += (realSeconds * 24) / (dayLengthMinutes * 60);
    let midnight = false;
    while (this.hours >= 24) {
      this.hours -= 24;
      this.day++;
      midnight = true;
    }
    return midnight;
  }

  // The moment the clock stands at, or the same day at another hour (the tour ship's own time).
  date(hours = this.hours): Date {
    const midnightUtc = Date.UTC(this.year, this.calendar.startMonth,
      this.calendar.startDay + (this.day % this.calendar.stayLengthDays));
    return new Date(midnightUtc + (hours - this.utcOffsetHours) * 3600000);
  }
}

export function nextStayDay(): number {
  try {
    const saved = localStorage.getItem(STAY_KEY);
    return saved !== null && Number.isFinite(Number(saved)) ? Number(saved) + 1 : 0;
  } catch {
    return 0;
  }
}

export function saveStayDay(day: number) {
  try {
    localStorage.setItem(STAY_KEY, String(day));
  } catch {
  }
}
