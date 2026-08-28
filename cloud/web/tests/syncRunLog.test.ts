import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeLogDetail, sanitizeLogMetadata } from "../lib/syncRunLog.ts";

test("sanitizeLogDetail oculta correos, telefonos y tokens", () => {
  const result = sanitizeLogDetail(
    "Error para sergio@example.com con telefono +56 9 9876 5432 y Bearer ya29.token-secreto-largo"
  );

  assert.equal(
    result,
    "Error para [correo] con telefono [telefono] y [token]"
  );
});

test("sanitizeLogDetail recorta detalles demasiado largos", () => {
  const result = sanitizeLogDetail("a".repeat(400));

  assert.equal(result?.length, 280);
  assert.equal(result?.endsWith("..."), true);
});

test("sanitizeLogMetadata oculta claves sensibles y limpia arrays", () => {
  const result = sanitizeLogMetadata({
    count: 3,
    emails: ["persona@empresa.com"],
    nested: {
      source_detail: "contenido privado",
      status: "ok"
    },
    oauth_token: "token privado"
  });

  assert.deepEqual(result, {
    count: 3,
    emails: ["[correo]"],
    nested: {
      source_detail: "[oculto]",
      status: "ok"
    },
    oauth_token: "[oculto]"
  });
});
