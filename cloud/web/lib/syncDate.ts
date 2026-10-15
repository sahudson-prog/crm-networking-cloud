export const CALENDAR_FUTURE_LOOKAHEAD_MONTHS = 3;
export const CALENDAR_ROLLING_FUTURE_LOOKAHEAD_DAYS = 30;
export const CALENDAR_RECENT_LOOKBACK_DAYS = 7;
export const NETWORKING_HISTORY_MAX_MONTHS = 12;
export const NETWORKING_START_SETTING_KEY = "Fecha_Inicio_Networking";

export type NetworkingStartStatus = {
  configuredDate: string | null;
  effectiveStartIso: string | null;
  maximumDate: string;
  minimumDate: string;
  reason: "missing" | "invalid" | "future" | "too_old" | null;
  valid: boolean;
};

export async function readNetworkingStartStatus(now = new Date()): Promise<NetworkingStartStatus> {
  try {
    const { readUserSetting } = await import("./cloudData.ts");
    return networkingStartStatus(await readUserSetting(NETWORKING_START_SETTING_KEY), now);
  } catch {
    return networkingStartStatus(null, now);
  }
}

export async function readNetworkingStartIso(now = new Date()) {
  return (await readNetworkingStartStatus(now)).effectiveStartIso;
}

export async function requireNetworkingStartIso(now = new Date()) {
  const status = await readNetworkingStartStatus(now);
  if (!status.valid || !status.effectiveStartIso) {
    throw new Error(networkingStartErrorMessage(status));
  }
  return status.effectiveStartIso;
}

export function networkingStartStatus(value: string | null | undefined, now = new Date()): NetworkingStartStatus {
  const { maximumDate, minimumDate } = networkingStartBounds(now);
  const configuredDate = parseCivilDateSetting(value ?? "");
  if (!value?.trim()) return invalidStatus("missing", null, minimumDate, maximumDate);
  if (!configuredDate) return invalidStatus("invalid", null, minimumDate, maximumDate);
  if (configuredDate > maximumDate) return invalidStatus("future", configuredDate, minimumDate, maximumDate);
  if (configuredDate < minimumDate) return invalidStatus("too_old", configuredDate, minimumDate, maximumDate);
  const effectiveDate = configuredDate < minimumDate ? minimumDate : configuredDate;
  return {
    configuredDate,
    effectiveStartIso: `${effectiveDate}T00:00:00.000Z`,
    maximumDate,
    minimumDate,
    reason: null,
    valid: true
  };
}

export function networkingStartBounds(now = new Date()) {
  if (Number.isNaN(now.getTime())) throw new Error("La fecha de referencia no es válida.");
  const maximumDate = utcCivilDate(now);
  return {
    maximumDate,
    minimumDate: subtractCalendarMonths(maximumDate, NETWORKING_HISTORY_MAX_MONTHS)
  };
}

export function networkingStartErrorMessage(status: NetworkingStartStatus) {
  if (status.reason === "future") return "La fecha de inicio de networking no puede ser futura. Revísala en Cuenta.";
  if (status.reason === "too_old") {
    return `La fecha de inicio de networking debe ser igual o posterior a ${status.minimumDate}. Revísala en Cuenta.`;
  }
  if (status.reason === "invalid") return "La fecha de inicio de networking no es válida. Revísala en Cuenta.";
  return "Define la fecha de inicio de networking en Cuenta antes de importar correos o citas.";
}

export function latestIsoInstant(...values: Array<string | null | undefined>) {
  const valid = values.flatMap((value) => {
    const time = value ? new Date(value).getTime() : Number.NaN;
    return Number.isFinite(time) ? [{ time, value: new Date(time).toISOString() }] : [];
  });
  return valid.sort((left, right) => right.time - left.time)[0]?.value ?? null;
}

export function calendarFutureWindowIso(now = new Date()) {
  const from = new Date(now.getTime());
  const until = addUtcMonths(from, CALENDAR_FUTURE_LOOKAHEAD_MONTHS);
  return {
    from: from.toISOString(),
    until: until.toISOString()
  };
}

export function calendarRollingWindowIso(now = new Date()) {
  const since = new Date(now.getTime() - CALENDAR_RECENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return {
    since: since.toISOString(),
    until: new Date(now.getTime() + CALENDAR_ROLLING_FUTURE_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString()
  };
}

export function parseDateSetting(value: string) {
  const civilDate = parseCivilDateSetting(value);
  return civilDate ? new Date(`${civilDate}T00:00:00.000Z`) : null;
}

function parseCivilDateSetting(value: string) {
  const clean = value.trim();
  if (!clean) return null;
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  if (isoDate) return validCivilDate(isoDate[1], isoDate[2], isoDate[3]);
  const localDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(clean);
  if (localDate) return validCivilDate(localDate[3], localDate[2], localDate[1]);
  return null;
}

function invalidStatus(
  reason: NonNullable<NetworkingStartStatus["reason"]>,
  configuredDate: string | null,
  minimumDate: string,
  maximumDate: string
): NetworkingStartStatus {
  return { configuredDate, effectiveStartIso: null, maximumDate, minimumDate, reason, valid: false };
}

function validCivilDate(yearValue: string, monthValue: string, dayValue: string) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return formatCivilDate(year, month, day);
}

function utcCivilDate(date: Date) {
  return formatCivilDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function subtractCalendarMonths(value: string, months: number) {
  const [year, month, day] = value.split("-").map(Number);
  const monthIndex = year * 12 + month - 1 - months;
  const nextYear = Math.floor(monthIndex / 12);
  const nextMonth = monthIndex - nextYear * 12 + 1;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return formatCivilDate(nextYear, nextMonth, Math.min(day, lastDay));
}

function formatCivilDate(year: number, month: number, day: number) {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function addUtcMonths(date: Date, months: number) {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}
