export type CaptchaStatus = "not_configured" | "pending" | "resolved" | "expired" | "error";

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export function buildPasswordlessEmailCredentials(input: {
  captchaToken: string;
  email: string;
  emailRedirectTo: string;
}) {
  return {
    email: input.email,
    options: {
      captchaToken: input.captchaToken,
      emailRedirectTo: input.emailRedirectTo
    }
  };
}

export function canSubmitPasswordlessEmail(input: {
  captchaStatus: CaptchaStatus;
  captchaToken: string;
  siteKey: string;
}) {
  return Boolean(input.siteKey && input.captchaStatus === "resolved" && input.captchaToken);
}

export function captchaStatusMessage(status: CaptchaStatus) {
  if (status === "not_configured") return "El acceso por email no está configurado en este entorno.";
  if (status === "expired") return "La verificación expiró. Intenta nuevamente.";
  if (status === "error") return "No pudimos verificar la solicitud. Intenta nuevamente.";
  if (status === "pending") return "Completa la verificación para continuar.";
  return "";
}
