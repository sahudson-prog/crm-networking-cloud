import { normalizeEmail } from "./googleAuthLoginConfig.ts";

export const GOOGLE_DATA_SESSION_REQUIRED_MESSAGE =
  "Para usar Google, entra a Coffeecito con la misma cuenta Google que quieres sincronizar.";

export const GOOGLE_DATA_PRINCIPAL_MISMATCH_MESSAGE =
  "La cuenta Google seleccionada no coincide con tu sesión de Coffeecito. Cerramos la sesión para proteger tus datos. Vuelve a entrar con la cuenta correcta.";

type GoogleDataIdentity = {
  identity_data?: Record<string, unknown> | null;
  provider?: string | null;
};

export type GoogleDataSessionUser = {
  email?: string | null;
  identities?: GoogleDataIdentity[] | null;
};

export type GoogleDataConnectionPrincipal = {
  email: string;
  userId: string;
};

export function googleDataSessionEligibility(user: GoogleDataSessionUser | null | undefined) {
  const canonicalEmail = normalizeEmail(user?.email ?? "");
  const hasMatchingGoogleIdentity = Boolean(canonicalEmail && user?.identities?.some((identity) => {
    if (identity.provider !== "google") return false;
    const identityEmail = typeof identity.identity_data?.email === "string"
      ? normalizeEmail(identity.identity_data.email)
      : "";
    return Boolean(identityEmail && identityEmail === canonicalEmail);
  }));

  return {
    allowed: hasMatchingGoogleIdentity,
    canonicalEmail
  };
}

export function googleDataConnectionPrincipalsMatch(
  expected: GoogleDataConnectionPrincipal,
  current: GoogleDataConnectionPrincipal
) {
  const expectedEmail = normalizeEmail(expected.email);
  const currentEmail = normalizeEmail(current.email);
  return Boolean(
    expected.userId
    && current.userId
    && expected.userId === current.userId
    && expectedEmail
    && expectedEmail === currentEmail
  );
}
