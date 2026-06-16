// Server-side Cloudflare Turnstile verification. Form POST handlers call this
// AFTER the browser widget has produced a token (the `cf-turnstile-response`
// field, which the widget injects into the form). Never call siteverify from the
// browser — the secret must stay server-side. Returns true only for a verified
// human token; any error (network, malformed response, missing token) is a fail.
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string | null,
): Promise<boolean> {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch(SITEVERIFY, { method: "POST", body: form });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
