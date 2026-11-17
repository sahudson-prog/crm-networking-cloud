import test from "node:test";
import assert from "node:assert/strict";
import { onboardingPriorityChange, onboardingPriorityCount } from "../lib/onboardingPriorities.ts";
import { beginOnboarding, moveOnboardingToStep, parseProductOnboardingState, serializeProductOnboardingState, INITIAL_ONBOARDING_STATE } from "../lib/onboarding.ts";
import type { ObjectiveRow } from "../lib/readModel.ts";
const row = (id: string, name: string, active = true): ObjectiveRow => ({ id, objective_name: name, objective_type: "INDUSTRY", priority_level: "HIGH", objective_description: "Conservar", is_active: active } as ObjectiveRow);

test("nueva prioridad sugerida o personalizada usa MEDIUM, nunca posición de selección", () => {
  for (const name of ["Tecnología", "Otra industria"]) {
    const change = onboardingPriorityChange([], "INDUSTRY", name, true)!;
    assert.equal(change.priorityLevel, "MEDIUM"); assert.equal(change.objectiveType, "INDUSTRY");
    assert.equal(change.objectiveId, undefined); assert.equal(change.isActive, true);
  }
});
test("reutiliza identidad normalizada; no duplica ni cambia nivel anterior", () => {
  assert.equal(onboardingPriorityChange([row("a", "Tecnología")], "INDUSTRY", " tecnologia ", true), null);
  const change = onboardingPriorityChange([row("a", "Tecnología", false)], "INDUSTRY", " tecnologia ", true)!;
  assert.equal(change.objectiveId, "a"); assert.equal(change.priorityLevel, "HIGH");
  assert.equal(change.objectiveDescription, "Conservar");
});
test("deselección desactiva sin borrar y conserva identidad, nivel y descripción", () => {
  const change = onboardingPriorityChange([row("a", "Tecnología")], "INDUSTRY", "Tecnología", false)!;
  assert.equal(change.isActive, false); assert.equal(change.objectiveId, "a");
  assert.equal(change.priorityLevel, "HIGH"); assert.equal(change.objectiveDescription, "Conservar");
});
test("sin límite artificial; permite más de tres entre categorías y conserva existentes", () => {
  const rows = [row("a", "Uno"), { ...row("b", "Dos"), objective_type: "ROLE" as const }, { ...row("c", "Tres"), objective_type: "COMPANY" as const }];
  assert.equal(onboardingPriorityCount(rows), 3);
  assert.equal(onboardingPriorityChange(rows, "INDUSTRY", "Cuatro", true)?.priorityLevel, "MEDIUM");
  assert.equal(onboardingPriorityChange(rows, "INDUSTRY", "Uno", true), null);
  const four = [...rows, row("d", "Cuatro")];
  assert.equal(onboardingPriorityCount(four), 4); assert.equal(four.length, 4);
  for (let index = 4; index < 30; index++) {
    const next = onboardingPriorityChange(four, "INDUSTRY", `Prioridad ${index}`, true)!;
    assert.equal(next.priorityLevel, "MEDIUM");
    four.push(row(String(index), next.objectiveName));
  }
  assert.equal(onboardingPriorityCount(four), 30);
});
test("identidades ambiguas y nombre vacío fallan sin plan de escritura", () => {
  assert.throws(() => onboardingPriorityChange([row("a", "X", false), row("b", "X", false)], "INDUSTRY", "X", true), /coincidentes/);
  assert.throws(() => onboardingPriorityChange([], "ROLE", " ", true), /Escribe/);
});
test("ejercicio confirmado sobrevive atrás, serialización y recarga en el setting existente", () => {
  const state = { ...beginOnboarding(INITIAL_ONBOARDING_STATE), boardExerciseCompleted: true };
  const back = moveOnboardingToStep(state, "google");
  const restored = parseProductOnboardingState(serializeProductOnboardingState(back))!;
  assert.equal(restored.boardExerciseCompleted, true);
  assert.equal(moveOnboardingToStep(restored, "contacts").boardExerciseCompleted, true);
  assert.equal(parseProductOnboardingState('{"version":1,"status":"in_progress","introSeen":true,"boardExerciseCompleted":"true"}')?.boardExerciseCompleted, undefined);
});
