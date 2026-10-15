const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type FetchLike = typeof fetch;

export async function verifyContactRequestTurnstile(input: {
  fetchImpl?: FetchLike;
  secretKey: string;
  token: string;
}) {
  const secretKey = input.secretKey.trim();
  const token = input.token.trim();
  if (!secretKey) return { code: "turnstile_not_configured", ok: false as const };
  if (!token || token.length > 4096) return { code: "turnstile_required", ok: false as const };

  const body = new URLSearchParams({ response: token, secret: secretKey });
  try {
    const response = await (input.fetchImpl ?? fetch)(TURNSTILE_VERIFY_URL, {
      body,
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return { code: "turnstile_unavailable", ok: false as const };
    const result = await response.json().catch(() => null) as { success?: boolean } | null;
    return result?.success === true
      ? { ok: true as const }
      : { code: "turnstile_rejected", ok: false as const };
  } catch {
    return { code: "turnstile_unavailable", ok: false as const };
  }
}
