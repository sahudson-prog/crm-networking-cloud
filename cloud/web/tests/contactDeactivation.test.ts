import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("la mutacion comun desactiva contactos, cierra ToDos y registra auditoria", () => {
  const actions = source("../lib/contactActions.ts");
  const body = between(actions, "export async function deactivateContacts", "export async function saveContactFromEditor");

  assert.match(body, /\.update\(\{ is_active: false \}\)/);
  assert.match(body, /\.eq\("user_id", userId\)/);
  assert.match(body, /\.eq\("is_active", true\)/);
  assert.match(body, /\.in\("id", activeIds\)/);
  assert.match(body, /\.from\("todos"\)[\s\S]*status: "auto_resolved"[\s\S]*\.eq\("object_type", "contact"\)[\s\S]*\.eq\("status", "active"\)/);
  assert.match(body, /action_name: "contact\.deactivate"/);
  assert.match(body, /requires_confirmation: true/);
  assert.match(body, /\.from\("audit_log"\)/);
  assert.doesNotMatch(body, /networking_focus|external_contact_ids|google/i);
});

test("la ficha delega eliminar al editor y no conserva una zona destructiva propia", () => {
  const profile = source("../components/ContactProfile.tsx");
  const editor = source("../components/ContactEditorDialog.tsx");

  assert.doesNotMatch(profile, /contact-danger-zone|contact-delete-dialog|deactivateContacts|Eliminar contacto/);
  assert.match(editor, /contact \? \(/);
  assert.match(editor, /<ContactDeactivationButton/);
  assert.match(editor, /await deactivateContacts\(\[contact\.id\], "contact_profile"\)/);
  assert.match(editor, /router\.replace\("\/contactos"\)/);
  assert.match(editor, /contactName=\{contact\.display_name\}/);
});

test("editor y accion masiva reutilizan boton y confirmacion de desactivacion", () => {
  const editor = source("../components/ContactEditorDialog.tsx");
  const table = source("../components/ContactTable.tsx");
  const button = source("../components/ContactDeactivationButton.tsx");
  const dialog = source("../components/ContactDeactivationConfirmDialog.tsx");
  const styles = source("../styles/components.css");

  assert.match(editor, /import \{ ContactDeactivationButton \} from "\.\/ContactDeactivationButton"/);
  assert.match(editor, /import \{ ContactDeactivationConfirmDialog \} from "\.\/ContactDeactivationConfirmDialog"/);
  assert.match(table, /import \{ ContactDeactivationButton \} from "\.\/ContactDeactivationButton"/);
  assert.match(table, /import \{ ContactDeactivationConfirmDialog \} from "\.\/ContactDeactivationConfirmDialog"/);
  assert.match(table, /Eliminar contactos seleccionados/);
  assert.match(table, /contactCount=\{selectedCount\}/);
  assert.match(table, /deactivateContacts\(Array\.from\(selectedIds\), "contacts_bulk"\)/);
  assert.match(table, /clearSelection\(\)/);
  assert.match(table, /await onReload\?\.\(\)/);
  assert.match(button, /icon="trash"/);
  assert.match(button, /square/);
  assert.match(button, /className="contact-deactivation-button"/);
  assert.match(dialog, /contactName \|\| "este contacto"/);
  assert.match(dialog, /contactCount} contactos/);
  assert.match(styles, /\.button\.contact-deactivation-button \{[\s\S]*border-color: var\(--crm-border-strong\)/);
  assert.match(styles, /\.button\.contact-deactivation-button \.icon,[\s\S]*color: var\(--crm-danger\)/);
  assert.doesNotMatch(styles, /contacts-tool-button\.danger/);
});

test("el editor muestra eliminar solo al editar y lo conserva en el footer con cancelar y guardar", () => {
  const editor = source("../components/ContactEditorDialog.tsx");
  const footer = between(editor, "<footer className=\"modal-actions\">", "</footer>");

  assert.match(footer, /\{contact \? \(/);
  assert.match(footer, /<ContactDeactivationButton/);
  assert.match(footer, /Cancelar/);
  assert.match(footer, /Guardar cambios/);
  assert.ok(footer.indexOf("<ContactDeactivationButton") < footer.indexOf("Cancelar"));
  assert.ok(footer.indexOf("Cancelar") < footer.indexOf("Guardar cambios"));
});

test("las lecturas operativas excluyen contactos inactivos", () => {
  const data = source("../lib/cloudData.ts");
  const byId = between(data, "export async function readContactById", "export async function readContactInteractions");
  const profile = between(data, "export async function readContactProfile", "async function readContactsByIds");
  const todos = between(data, "export async function readActiveTodos", "export async function readAllActiveContacts");

  assert.match(byId, /\.eq\("is_active", true\)/);
  assert.match(profile, /const contact = await readContactById\(contactId\);[\s\S]*if \(!contact\) return null;[\s\S]*Promise\.all/);
  assert.match(todos, /todo\.object_type !== "contact" \|\| \(todo\.object_id && contactsById\.get\(todo\.object_id\)\?\.is_active\)/);
});

test("referidos e historial conservan contexto sin links operativos a inactivos", () => {
  const profile = source("../components/ContactProfile.tsx");
  const referrals = source("../components/ReferralActions.tsx");
  const coachLog = source("../components/CoachActionLogDialog.tsx");
  const coachData = source("../lib/coachLog.ts");

  assert.match(profile, /linkedActive = linked && referral\.linkedContactActive/);
  assert.match(referrals, /row\.linkedContactId && row\.linkedContactActive/);
  assert.match(coachLog, /row\.contactId && row\.contactActive/);
  assert.match(coachData, /\.select\("id,display_name,is_active"\)/);
});

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function between(value: string, start: string, end: string) {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `No se encontro ${start}`);
  assert.ok(endIndex > startIndex, `No se encontro ${end}`);
  return value.slice(startIndex, endIndex);
}
