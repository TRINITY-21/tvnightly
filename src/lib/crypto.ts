// HMAC-style IP hashing for vote/rating dedupe. No raw IPs stored.

export async function ipHash(secret: string, ip: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${secret}:${ip}`));
  return [...new Uint8Array(d)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
