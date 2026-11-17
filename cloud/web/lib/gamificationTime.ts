import { localDateTimeCandidates, localDateTimeValue } from "./networkingCycleTime.ts";

// Calendar arithmetic with compatible disambiguation: earlier in a fold,
// forward by the offset gap for a nonexistent wall time. No fixed UTC weeks.
export function shiftLocalDays(instant: number, days: number, zone: string): number {
  const wall = new Date(`${localDateTimeValue(new Date(instant), zone)}Z`);
  wall.setUTCDate(wall.getUTCDate() + days);
  const target = wall.toISOString().slice(0, 19);
  const candidates = localDateTimeCandidates(target, zone);
  const fraction = ((instant % 1000) + 1000) % 1000;
  if (candidates.length) return candidates[0].getTime() + fraction;
  const naive = wall.getTime();
  const offsets = new Set([-36, -12, 12, 36].map(hours => {
    const sample = naive + hours * 3600000;
    return Date.parse(`${localDateTimeValue(new Date(sample), zone)}Z`) - sample;
  }));
  const later = [...offsets].map(offset => naive - offset)
    .filter(value => localDateTimeValue(new Date(value), zone) > target)
    .sort((a, b) => a - b);
  if (!later.length) throw new Error("calendar_boundary_unresolved");
  return later[0] + fraction;
}

export function rollingBoundaries(now: number, zone: string): number[] {
  return [28, 21, 14, 7].map(days => shiftLocalDays(now, -days, zone)).concat(now);
}
