import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { legalDocuments, legalDocumentVersions } from "../content/legalDocuments.ts";
import { parseLegalDocument } from "../lib/legalDocumentRenderer.ts";

test("los documentos publicos conservan la versión y fecha aprobadas", () => {
  for (const document of Object.values(legalDocuments)) {
    assert.equal(document.version, "1.1");
    assert.equal(document.effectiveDate, "15 de octubre de 2026");
    assert.match(document.content, /\*\*Versión 1\.1 — 15 de octubre de 2026\*\*/);
  }
  assert.match(legalDocuments.terms.content, /# Términos de Servicio de Coffeecito/);
  assert.match(legalDocuments.privacy.content, /# Política de Privacidad de Coffeecito/);
  assert.match(legalDocuments.privacy.content, /## 8\. Transferencias internacionales/);
});

test("V1.0 permanece reconstruible exactamente y V1.1 solo reubica la identificación", () => {
  const historical = legalDocumentVersions["1.0"];
  assert.equal(sha256(historical.terms.content.trim()), "80323d9b915dd2cb423fe4cfbaed7851675cd070da596117c5bc08214af4cd12");
  assert.equal(sha256(historical.privacy.content.trim()), "f0ec2f6ecf1ca3f262508942a37f2d057b79449bab20fb6729a5861a6a75fd30");
  assert.match(historical.terms.content, /Versión 1\.0[\s\S]*Coffeecito es operado por \*\*Sergio Hudson/);
  assert.match(section(historical.privacy.content, "## 1. Responsable y contacto"), /Sergio Hudson/);

  const currentTermsOpening = legalDocuments.terms.content.slice(0, legalDocuments.terms.content.indexOf("## 1. Aceptación"));
  assert.doesNotMatch(currentTermsOpening, /Sergio Hudson/);
  assert.match(section(legalDocuments.terms.content, "## 16. Contacto"), /Sergio Hudson[\s\S]*\/contacto/);
  assert.doesNotMatch(section(legalDocuments.privacy.content, "## 1. Responsable y contacto"), /Sergio Hudson/);
  assert.match(section(legalDocuments.privacy.content, "## 15. Contacto"), /Sergio Hudson[\s\S]*responsable de datos[\s\S]*\/contacto/);
});

test("los documentos conservan sus secciones y la transferencia internacional aprobada", () => {
  assert.equal(sectionCount(legalDocuments.terms.content), 16);
  assert.equal(sectionCount(legalDocuments.privacy.content), 15);
  assert.equal(
    section(legalDocuments.privacy.content, "## 8. Transferencias internacionales"),
    `## 8. Transferencias internacionales

Coffeecito utiliza proveedores tecnológicos cuya infraestructura puede implicar tratamiento de datos personales fuera de Chile.

El proyecto productivo de **Supabase** utilizado por Coffeecito se encuentra actualmente alojado en **São Paulo, Brasil**. Determinados servicios auxiliares, operacionales o de soporte del proveedor pueden implicar tratamiento en otras jurisdicciones conforme a sus condiciones aplicables.

La aplicación web utiliza **Vercel**. Las funciones productivas de Coffeecito se ejecutan actualmente en **Washington D.C., Estados Unidos**, y determinados servicios de red y distribución pueden utilizar infraestructura internacional.

Cuando el Usuario utiliza las funciones de **Google**, determinada información puede ser procesada mediante la infraestructura internacional de Google.

Cuando estas operaciones constituyan transferencias internacionales de datos personales, Coffeecito aplicará los mecanismos y garantías exigidos por la legislación chilena aplicable. Esta información se actualizará si cambia materialmente la infraestructura o los proveedores utilizados.`
  );
});

test("las rutas legales son públicas y no montan AuthGate ni Shell", () => {
  for (const path of ["../app/terminos/page.tsx", "../app/privacidad/page.tsx"]) {
    const route = source(path);
    assert.match(route, /<LegalDocumentPage document=\{legalDocuments\.(terms|privacy)\}/);
    assert.doesNotMatch(route, /AuthGate|Shell/);
  }
});

test("la navegación pública conecta Términos, Privacidad y Contacto", () => {
  const links = source("../components/PublicSiteLinks.tsx");
  assert.match(links, /href="\/terminos">Términos/);
  assert.match(links, /href="\/privacidad">Privacidad/);
  assert.match(links, /href="\/contacto">Contacto/);
  assert.match(source("../components/AuthGate.tsx"), /<PublicSiteLinks \/>/);
  assert.match(source("../components/PublicContactPage.tsx"), /<PublicSiteLinks \/>/);
});

test("el renderer conserva headings, párrafos y listas desde la fuente versionada", () => {
  const blocks = parseLegalDocument(legalDocuments.privacy.content);
  assert.equal(blocks[0]?.type, "heading");
  assert.equal(blocks.find((block) => block.type === "heading" && block.content === "8. Transferencias internacionales")?.type, "heading");
  assert.ok(blocks.some((block) => block.type === "list"));
});

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function sectionCount(content: string) {
  return [...content.matchAll(/^## \d+\. /gm)].length;
}

function section(content: string, heading: string) {
  const start = content.indexOf(heading);
  const next = content.indexOf("\n## ", start + heading.length);
  return content.slice(start, next === -1 ? undefined : next).trim();
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
