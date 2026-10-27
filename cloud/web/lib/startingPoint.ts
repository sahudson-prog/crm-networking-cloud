import { networkingStartBounds, parseDateSetting } from "./syncDate.ts";

export const PROFESSIONAL_SITUATION_OPTIONS = [
  { code: "employed", label: "Con empleo" },
  { code: "unemployed", label: "Sin empleo" },
  { code: "independent", label: "Independiente / emprendiendo" },
  { code: "studying", label: "Estudiando" },
  { code: "other", label: "Otra situación" },
  { code: "prefer_not_to_say", label: "Prefiero no indicar" }
] as const;

export type ProfessionalSituationCode = (typeof PROFESSIONAL_SITUATION_OPTIONS)[number]["code"];

export type StartingPointValues = {
  fullName: string;
  networkingStartDate: string;
  professionalSituationCode: ProfessionalSituationCode | "";
};

export type StartingPointErrors = Partial<Record<keyof StartingPointValues, string>>;

export const EMPTY_STARTING_POINT: StartingPointValues = {
  fullName: "",
  networkingStartDate: "",
  professionalSituationCode: ""
};

export function isProfessionalSituationCode(value: unknown): value is ProfessionalSituationCode {
  return PROFESSIONAL_SITUATION_OPTIONS.some((option) => option.code === value);
}

export function normalizeStartingPoint(values: StartingPointValues): StartingPointValues {
  return {
    fullName: values.fullName.trim().replace(/\s+/g, " "),
    networkingStartDate: values.networkingStartDate.trim(),
    professionalSituationCode: values.professionalSituationCode
  };
}

export function validateStartingPoint(
  values: StartingPointValues,
  now = new Date()
): StartingPointErrors {
  const normalized = normalizeStartingPoint(values);
  const errors: StartingPointErrors = {};

  if (!normalized.fullName) errors.fullName = "Escribe el nombre que quieres que usemos.";
  else if (normalized.fullName.length > 160) errors.fullName = "El nombre no puede superar 160 caracteres.";

  if (!isProfessionalSituationCode(normalized.professionalSituationCode)) {
    errors.professionalSituationCode = "Selecciona tu situación profesional.";
  }

  const parsedDate = parseDateSetting(normalized.networkingStartDate);
  if (!parsedDate) errors.networkingStartDate = "Selecciona una fecha válida.";
  else if (normalized.networkingStartDate > networkingStartBounds(now).maximumDate) {
    errors.networkingStartDate = "La fecha de inicio no puede ser futura.";
  }

  return errors;
}

export function startingPointIsComplete(values: StartingPointValues, now = new Date()) {
  return Object.keys(validateStartingPoint(values, now)).length === 0;
}
