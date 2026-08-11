import { readUserSetting } from "./cloudData";

export async function readNetworkingStartIso() {
  try {
    const value = await readUserSetting("Fecha_Inicio_Networking");
    const parsed = parseDateSetting(value);
    return parsed?.toISOString() ?? null;
  } catch {
    return null;
  }
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
