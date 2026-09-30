import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tableSource = source("../components/ContactTable.tsx");
const stylesSource = source("../styles/components.css");
const cardSource = tableSource.slice(
  tableSource.indexOf("function ContactStatusCard"),
  tableSource.indexOf("function SortHeader")
);
const statusScrollStyles = stylesSource.match(/\.contacts-status-scroll\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

test("tarjetas normales no muestran el marcador decorativo y los grupos conservan +N", () => {
  assert.doesNotMatch(cardSource, /Hashtags pendientes|: "#"/);
  assert.match(cardSource, /card\.extraCount \? \([\s\S]*\+\{card\.extraCount\}/);
  assert.match(cardSource, /card\.isHeadhunterGroup \? "group"/);
});

test("el tablero mantiene cinco columnas, DnD y encadenamiento vertical nativo", () => {
  assert.match(tableSource, /NETWORKING_STATUSES\.map/);
  assert.match(tableSource, /onDragStart=\{\(event\)/);
  assert.match(tableSource, /onDragOver=\{\(event\)/);
  assert.match(tableSource, /onDrop=\{\(event\)/);
  assert.match(stylesSource, /\.contacts-status-board\s*\{[\s\S]*grid-template-columns: repeat\(5, minmax\(184px, 1fr\)\)[\s\S]*overflow-x: auto/);
  assert.match(stylesSource, /\.contacts-status-column\s*\{[\s\S]*min-width: 184px/);
  assert.match(statusScrollStyles, /max-height: 335px[\s\S]*min-height: 335px[\s\S]*overflow-y: auto[\s\S]*overscroll-behavior-y: auto/);
  assert.doesNotMatch(statusScrollStyles, /overscroll-behavior:\s*contain/);
  assert.doesNotMatch(statusScrollStyles, /overscroll-behavior-y:\s*contain/);
  assert.doesNotMatch(tableSource, /onWheel|onTouch(?:Start|Move|End)/);
});

test("solo las tarjetas agrupadas reservan una tercera columna", () => {
  assert.match(stylesSource, /\.contacts-status-card\s*\{[\s\S]*grid-template-columns: 24px minmax\(0, 1fr\)/);
  assert.match(stylesSource, /\.contacts-status-card\.group\s*\{[\s\S]*grid-template-columns: 24px minmax\(0, 1fr\) 20px/);
});

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
