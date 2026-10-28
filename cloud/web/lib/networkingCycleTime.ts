export type RepeatedTimeChoice = "earlier" | "later";

type WallTime = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function parseWallTime(value: string): WallTime {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error("Selecciona una fecha y hora válidas.");
  const [, year, month, day, hour, minute] = match.map(Number);
  const second = Number(match[6] ?? 0);
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  probe.setUTCHours(hour, minute, second, 0);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month
    || probe.getUTCDate() !== day || probe.getUTCHours() !== hour
    || probe.getUTCMinutes() !== minute || probe.getUTCSeconds() !== second)
    throw new Error("Selecciona una fecha y hora válidas.");
  return { year, month, day, hour, minute, second };
}

function wallAt(instant: number, zone: string): WallTime {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(instant));
  const value = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return { year: value.year, month: value.month, day: value.day,
    hour: value.hour, minute: value.minute, second: value.second };
}

function utcTime(wall: WallTime): number {
  const date = new Date(0);
  date.setUTCFullYear(wall.year, wall.month - 1, wall.day);
  date.setUTCHours(wall.hour, wall.minute, wall.second, 0);
  return date.getTime();
}

function sameTime(left: WallTime, right: WallTime) {
  return left.year === right.year && left.month === right.month && left.day === right.day
    && left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}

export function localDateTimeCandidates(value: string, zone: string): Date[] {
  const requested = parseWallTime(value);
  const naive = utcTime(requested);
  const offsets = new Set([-36, -12, 0, 12, 36].map((hours) => {
    const sample = naive + hours * 3_600_000;
    return utcTime(wallAt(sample, zone)) - sample;
  }));
  return [...new Set([...offsets].map((offset) => naive - offset))]
    .filter((instant) => sameTime(wallAt(instant, zone), requested))
    .sort((left, right) => left - right).map((instant) => new Date(instant));
}

export function localDateTimeValue(value = new Date(), zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC") {
  const wall = wallAt(value.getTime(), zone);
  return `${wall.year.toString().padStart(4, "0")}-${wall.month.toString().padStart(2, "0")}-${wall.day.toString().padStart(2, "0")}`
    + `T${wall.hour.toString().padStart(2, "0")}:${wall.minute.toString().padStart(2, "0")}:${wall.second.toString().padStart(2, "0")}`;
}

export function startIsOnOrAfterClose(value: string, zone: string, closedAt: string,
  choice?: RepeatedTimeChoice): boolean | null {
  const candidates = localDateTimeCandidates(value, zone);
  if (!candidates.length || (candidates.length > 1 && !choice)) return null;
  const selected = choice === "later" ? candidates[candidates.length - 1] : candidates[0];
  return selected.getTime() >= firstSelectableStartInstant(closedAt);
}

// datetime-local with step=1 can represent whole seconds only. Keep the
// persisted close instant untouched and round only the selectable UI bound.
export function firstSelectableStartInstant(closedAt: string): number {
  const instant = Date.parse(closedAt);
  if (!Number.isFinite(instant)) throw new Error("La fecha de cierre anterior no es válida.");
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(closedAt)?.[1] ?? "";
  return Math.floor(instant / 1_000) * 1_000 + (/[1-9]/.test(fraction) ? 1_000 : 0);
}

// A wall-clock min can exclude a valid later instant during a clock rollback.
// Keep the native picker limit only when the nearby offset stays stable.
export function startInputMin(closedAt: string, zone: string): string | undefined {
  const instant = Date.parse(closedAt);
  if (!Number.isFinite(instant)) return undefined;
  const offset = timezoneOffsetLabel(new Date(instant), zone);
  for (let hour = 1; hour <= 48; hour += 1) {
    if (timezoneOffsetLabel(new Date(instant + hour * 3_600_000), zone) !== offset) return undefined;
  }
  return localDateTimeValue(new Date(firstSelectableStartInstant(closedAt)), zone);
}

export function localDateTimeToIso(value: string, zone: string, choice?: RepeatedTimeChoice) {
  const candidates = localDateTimeCandidates(value, zone);
  if (!candidates.length) throw new Error("Esa hora no existe en la zona horaria por el cambio de horario.");
  if (candidates.length > 1 && !choice) throw new Error("Esa hora se repite por el cambio de horario. Elige cuál usar.");
  const date = choice === "later" ? candidates[candidates.length - 1] : candidates[0];
  if (date.getTime() > Date.now()) throw new Error("La fecha y hora no pueden ser futuras.");
  return date.toISOString();
}

export function timezoneOffsetLabel(date: Date, zone: string) {
  const sample = Math.floor(date.getTime() / 1_000) * 1_000;
  const offsetMinutes = Math.round((utcTime(wallAt(sample, zone)) - sample) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  return `UTC${sign}${Math.floor(absolute / 60).toString().padStart(2, "0")}:${(absolute % 60).toString().padStart(2, "0")}`;
}
