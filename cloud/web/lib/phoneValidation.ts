import { normalizePhoneDigits, SUPPORTED_PHONE_COUNTRIES } from "./phoneIdentity.ts";

export const INVALID_PHONE_MESSAGE = "Ingresa un número de teléfono válido, incluyendo el código de país.";

export function isValidPhone(phone: string) {
  const value = phone.trim();
  if (!value) return true;
  if (!/^(?:\+\s*|00\s*)?\d[\d\s().-]*$/.test(value)) return false;
  if ((value.match(/\(/g) ?? []).length !== (value.match(/\)/g) ?? []).length) return false;
  if (value.includes(")") && value.indexOf(")") < value.indexOf("(")) return false;
  const digits = normalizePhoneDigits(value);
  return digits.length >= 7 && digits.length <= 15 && /[1-9]/.test(digits);
}

export function whatsappPhoneForLink(phone: string) {
  if (!phone.trim() || !isValidPhone(phone)) return "";
  const digits = normalizePhoneDigits(phone);
  if (phone.trim().startsWith("+") || phone.trim().startsWith("00")) return digits;
  return SUPPORTED_PHONE_COUNTRIES.some((rule) =>
    digits.startsWith(rule.callingCode) && rule.nationalLengths.includes(digits.length - rule.callingCode.length)
  ) ? digits : "";
}
