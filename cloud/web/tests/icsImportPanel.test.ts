import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../components/IcsImportPanel.tsx", import.meta.url), "utf8");
const account = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");
const feature = readFileSync(new URL("../lib/icsImportFeature.ts", import.meta.url), "utf8");

test("Cuenta integra el flujo .ics completo detrás de un gate apagado por defecto", () => {
  assert.match(account, /isIcsImportEnabled\(\)[\s\S]*?<IcsImportPanel \/>[\s\S]*?<SourcePlaceholder icon="file" title="iCalendar \(\.ics\)" \/>/);
  assert.match(feature, /process\.env\.NEXT_PUBLIC_ICS_IMPORT_ENABLED === "true"/);
  assert.doesNotMatch(feature, /development|NODE_ENV/);
});

test("el panel usa parse, review persistido, selección y Apply existentes", () => {
  assert.match(panel, /parseIcsCalendar\(await file\.text\(\)\)/);
  assert.match(panel, /requireNetworkingStartIso\(\)/);
  assert.match(panel, /buildIcsImportReviewFromPersistedData\(\{ minimumStartIso, parsed \}\)/);
  assert.match(panel, /applyIcsImportSelection\(\{ snapshot, selectedChangeIds: changeIds \}\)/);
  assert.match(panel, /<IcsImportPreviewDialog/);
  assert.match(panel, /accept="\.ics,text\/calendar"/);
  assert.match(panel, /Importación histórica puntual; no crea una sincronización continua/);
  assert.match(panel, /Hasta 500 citas, 5 MB de datos normalizados y 5\.000 participantes/);
  assert.doesNotMatch(panel, /Google|Calendar API|fetch\(/);
});

test("errores y resultados se exponen sin reintentos o batching silencioso", () => {
  assert.match(panel, /setPreviewError\(error instanceof Error \? error\.message/);
  assert.match(panel, /createdCount/);
  assert.match(panel, /updatedCount/);
  assert.match(panel, /unchangedCount/);
  assert.doesNotMatch(panel, /chunk|batch|setTimeout|retry/i);
});
