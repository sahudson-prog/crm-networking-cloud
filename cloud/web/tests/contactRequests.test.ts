import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { verifyContactRequestTurnstile } from "../lib/contactRequestServer.ts";
import { validateContactRequestInput } from "../lib/contactRequests.ts";

test("validacion server-side exige email, motivo y mensaje", () => {
  assert.equal(validateContactRequestInput({ email: "", message: "", reason: "" }).ok, false);
  assert.equal(validateContactRequestInput({ email: "not-an-email", message: "Ayuda", reason: "support" }).ok, false);
  assert.deepEqual(
    validateContactRequestInput({
      email: " PERSONA@EXAMPLE.INVALID ",
      message: " Necesito ayuda ",
      name: " Persona Demo ",
      reason: "support"
    }),
    {
      ok: true,
      value: {
        email: "persona@example.invalid",
        message: "Necesito ayuda",
        name: "Persona Demo",
        privacySubreason: null,
        reason: "support"
      }
    }
  );
});

test("submotivo solo se acepta para privacidad", () => {
  assert.equal(validateContactRequestInput({
    email: "persona@example.invalid",
    message: "Solicitud",
    privacySubreason: "access",
    reason: "support"
  }).ok, false);
  assert.equal(validateContactRequestInput({
    email: "persona@example.invalid",
    message: "Solicitud",
    privacySubreason: "erasure",
    reason: "privacy"
  }).ok, true);
});

test("Turnstile falla cerrado si falta secret, token o verificacion", async () => {
  assert.deepEqual(await verifyContactRequestTurnstile({ secretKey: "", token: "token" }), {
    code: "turnstile_not_configured",
    ok: false
  });
  assert.deepEqual(await verifyContactRequestTurnstile({ secretKey: "secret", token: "" }), {
    code: "turnstile_required",
    ok: false
  });
  assert.deepEqual(await verifyContactRequestTurnstile({
    fetchImpl: async () => new Response(JSON.stringify({ success: false }), { status: 200 }),
    secretKey: "secret",
    token: "token"
  }), { code: "turnstile_rejected", ok: false });
});

test("Turnstile acepta solo una respuesta success real", async () => {
  let body = "";
  const result = await verifyContactRequestTurnstile({
    fetchImpl: async (_url, init) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
    secretKey: "server-secret",
    token: "captcha-token"
  });
  assert.deepEqual(result, { ok: true });
  assert.match(body, /secret=server-secret/);
  assert.match(body, /response=captcha-token/);
});

test("contacto es publico y la administracion permanece detras de AuthGate y capability", () => {
  const publicRoute = source("../app/contacto/page.tsx");
  const adminRoute = source("../app/sistema/solicitudes/page.tsx");
  assert.doesNotMatch(publicRoute, /AuthGate|Shell/);
  assert.match(publicRoute, /<PublicContactPage/);
  assert.match(adminRoute, /<AuthGate>/);
  assert.match(adminRoute, /<SystemCapabilityGate surface="requests">/);
});

test("API no acepta user_id del body ni persiste IP o User-Agent", () => {
  const route = source("../app/api/contact-requests/route.ts");
  assert.match(route, /readOptionalSessionUser/);
  assert.match(route, /userClient\.auth\.getUser\(token\)/);
  assert.match(route, /p_user_id: session\.userId/);
  assert.doesNotMatch(route, /body\?\.user_id|body\?\.userId|x-forwarded-for|user-agent/i);
  assert.match(route, /verifyContactRequestTurnstile[\s\S]*adminClient\.rpc\("submit_contact_request_v1"/);
  assert.match(route, /total > MAX_REQUEST_BYTES/);
  assert.match(route, /reader\.cancel\(\)/);
});

test("formulario muestra campos, advertencia y bloqueo hasta Turnstile", () => {
  const page = source("../components/PublicContactPage.tsx");
  const contract = source("../lib/contactRequests.ts");
  assert.match(page, /Nombre \(opcional\)/);
  assert.match(contract, /Privacidad y datos personales/);
  assert.match(page, /No incluyas contraseñas, tokens, códigos de acceso ni otros secretos\./);
  assert.match(page, /disabled=\{submitting \|\| captchaStatus !== "resolved"\}/);
});

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
