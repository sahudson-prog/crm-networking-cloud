import test from "node:test";
import assert from "node:assert/strict";

import { phoneIdentitySet, phoneMatchesSet } from "../lib/phoneIdentity.ts";

test("phoneIdentity reconoce equivalencias basicas por pais soportado", () => {
  const cases = [
    ["Chile", "2 2618 8346", "+56 2 2618 8346"],
    ["Peru", "987 654 321", "+51 987 654 321"],
    ["Argentina", "11 1234 5678", "+54 9 11 1234 5678"],
    ["Colombia", "300 123 4567", "+57 300 123 4567"],
    ["Mexico", "55 1234 5678", "+52 1 55 1234 5678"],
    ["Brasil", "11 91234 5678", "+55 11 91234 5678"],
    ["USA", "212 555 0199", "+1 212 555 0199"]
  ];

  for (const [country, localPhone, internationalPhone] of cases) {
    const identities = phoneIdentitySet([localPhone]);
    assert.equal(
      phoneMatchesSet(identities, internationalPhone),
      true,
      `${country}: ${localPhone} debe coincidir con ${internationalPhone}`
    );
  }
});

test("phoneIdentity soporta prefijo internacional 00", () => {
  const identities = phoneIdentitySet(["0056 2 2618 8346"]);
  assert.equal(phoneMatchesSet(identities, "+56 2 2618 8346"), true);
});

test("phoneIdentity reconoce movil chileno con 9 duplicado despues del codigo de pais", () => {
  const identities = phoneIdentitySet(["+56 9 8506 4738"]);
  assert.equal(phoneMatchesSet(identities, "+56 99 8506 4738"), true);
});

test("phoneIdentity no considera match cuando no comparte identidad suficiente", () => {
  const identities = phoneIdentitySet(["+56 2 2618 8346"]);
  assert.equal(phoneMatchesSet(identities, "+56 2 9999 9999"), false);
});
