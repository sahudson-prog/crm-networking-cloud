import { readUserSetting } from "./cloudData";

export const CALENDAR_FUTURE_LOOKAHEAD_MONTHS = 3;

export async function readNetworkingStartIso() {
  try {
    const value = await readUserSetting("Fecha_Inicio_Networking");
    const parsed = parseDateSetting(value);
    return parsed?.toISOString() ?? null;
  } catch {
    return null;
  }
}

export function calendarFutureWindowIso(now = new Date()) {
  const from = new Date(now.getTime());
  const until = addUtcMonths(from, CALENDAR_FUTURE_LOOKAHEAD_MONTHS);
  return {
    from: from.toISOString(),
    until: until.toISOString()
  };
}

export function parseDateSetting(value: string) {
  const clean = value.trim();
  if (!clean) return null;
  const parts = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (parts) {
    const [, day, month, year] = parts;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  }
  const parsed = new Date(clean);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addUtcMonths(date: Date, months: number) {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}
