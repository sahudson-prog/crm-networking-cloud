import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isValidPhone, whatsappPhoneForLink } from "../lib/phoneValidation.ts";

test("telefono opcional y formatos nacionales e internacionales validos", () => {
  for (const value of ["", "  ", "912345678", "2 2618 8346", "+56 9 1234 5678", "0056 2 2618 8346", "00 56 2 2618 8346", "00 123456789012345", "+1 (415) 555-2671", "+51 987-654-321"]) {
    assert.equal(isValidPhone(value), true, value);
  }
});

test("WhatsApp usa solo destinos internacionales verificables", () => {
  assert.equal(whatsappPhoneForLink("+56 9 1234 5678"), "56912345678");
  assert.equal(whatsappPhoneForLink("00 56 9 1234 5678"), "56912345678");
  assert.equal(whatsappPhoneForLink("56912345678"), "56912345678");
  assert.equal(whatsappPhoneForLink("912345678"), "");
  assert.equal(whatsappPhoneForLink("+56 9abc 1234 5678"), "");
});

test("rechaza letras, simbolos, prefijos mal ubicados y longitudes no utilizables", () => {
  for (const value of ["abc56912345678", "+56 9abc 1234 5678", "123456", "12", "00000000", "+56/9/12345678", "56912345678x12", "56+912345678", "(56912345678", "56912345678)", "+1234567890123456"]) {
    assert.equal(isValidPhone(value), false, value);
  }
});

test("los escritores manuales validan antes de autenticacion o escrituras", () => {
  const contact = readFileSync(new URL("../lib/contactActions.ts", import.meta.url), "utf8");
  const referral = readFileSync(new URL("../lib/referralActions.ts", import.meta.url), "utf8");
  const contactSave = contact.slice(contact.indexOf("export async function saveContactFromEditor"));
  const referralSave = referral.slice(referral.indexOf("export async function saveReferralFromEditor"));
  const contactGuard = contactSave.indexOf("normalized.phones.some((phone) => !isValidPhone(phone))");
  const referralGuard = referralSave.indexOf("!isValidPhone(normalized.referredPhone)");
  assert.ok(contactGuard >= 0 && contactGuard < contactSave.indexOf("supabase.auth.getUser()"));
  assert.ok(referralGuard >= 0 && referralGuard < referralSave.indexOf("supabase.auth.getUser()"));
});
