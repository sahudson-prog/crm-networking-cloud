import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPasswordlessEmailCredentials,
  canSubmitPasswordlessEmail,
  captchaStatusMessage
} from "../lib/authCaptcha.ts";
import { buildGoogleAuthLoginRequest } from "../lib/googleAuthLoginConfig.ts";

test("email passwordless pasa captchaToken a signInWithOtp", () => {
  assert.deepEqual(
    buildPasswordlessEmailCredentials({
      captchaToken: "captcha-token",
      email: "user@example.invalid",
      emailRedirectTo: "http://localhost:3000"
    }),
    {
      email: "user@example.invalid",
      options: {
        captchaToken: "captcha-token",
        emailRedirectTo: "http://localhost:3000"
      }
    }
  );
});

test("con CAPTCHA configurado no permite submit sin token resuelto", () => {
  assert.equal(
    canSubmitPasswordlessEmail({
      captchaStatus: "pending",
      captchaToken: "",
      siteKey: "site-key"
    }),
    false
  );
});

test("captcha expirado o con error deja submit bloqueado", () => {
  for (const captchaStatus of ["expired", "error"] as const) {
    assert.equal(
      canSubmitPasswordlessEmail({
        captchaStatus,
        captchaToken: "old-token",
        siteKey: "site-key"
      }),
      false
    );
  }
  assert.equal(captchaStatusMessage("expired"), "La verificación expiró. Intenta nuevamente.");
  assert.equal(captchaStatusMessage("error"), "No pudimos verificar la solicitud. Intenta nuevamente.");
});

test("solo captcha resuelto con site key permite submit", () => {
  assert.equal(
    canSubmitPasswordlessEmail({
      captchaStatus: "resolved",
      captchaToken: "captcha-token",
      siteKey: "site-key"
    }),
    true
  );
});

test("sin site key no hay bypass silencioso del fallback email", () => {
  assert.equal(
    canSubmitPasswordlessEmail({
      captchaStatus: "resolved",
      captchaToken: "captcha-token",
      siteKey: ""
    }),
    false
  );
  assert.equal(captchaStatusMessage("not_configured"), "El acceso por email no está configurado en este entorno.");
});

test("despues de un intento AuthGate invalida token y reinicia Turnstile", () => {
  const source = readFileSync(new URL("../components/AuthGate.tsx", import.meta.url), "utf8");

  assert.match(source, /const captchaTokenForAttempt = captchaToken/);
  assert.match(source, /setCaptchaToken\(""\)/);
  assert.match(source, /finally[\s\S]*setTurnstileResetKey/);
});

test("Google login no recibe captchaToken", () => {
  const request = buildGoogleAuthLoginRequest("http://localhost:3000");

  assert.equal("captchaToken" in request.options, false);
});

test("AuthGate no consulta allowlist directamente", () => {
  const source = readFileSync(new URL("../components/AuthGate.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("app_access_allowlist"), false);
});

test("no hay secret Turnstile hardcodeada en codigo web", () => {
  const source = [
    readFileSync(new URL("../components/AuthGate.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../lib/authCaptcha.ts", import.meta.url), "utf8")
  ].join("\n");

  assert.equal(/TURNSTILE_SECRET|secretKey|secret_key|0x4AAAA/i.test(source), false);
});

test("no queda otra ruta app de signInWithOtp sin captcha", () => {
  const rootPath = fileURLToPath(new URL("..", import.meta.url));
  const matches = ["app", "components", "lib"].flatMap((directory) => findSourceFiles(join(rootPath, directory)))
    .filter((filePath) => readFileSync(filePath, "utf8").includes("signInWithOtp"));

  assert.deepEqual(matches.map((filePath) => filePath.replaceAll("\\", "/")).sort(), [
    join(rootPath, "components", "AuthGate.tsx").replaceAll("\\", "/")
  ]);
});

function findSourceFiles(directory: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      results.push(fullPath);
    }
  }
  return results;
}
