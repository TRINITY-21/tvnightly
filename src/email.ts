// Swappable email sender. EMAIL_PROVIDER selects the backend:
//   'console' (default) — logs instead of sending; safe for local dev
//   'gmail' / 'smtp'    — SMTP via worker-mailer. Reads SMTP_HOST/SMTP_PORT/
//                         SMTP_USER/SMTP_PASS (GMAIL_USER/GMAIL_APP_PASSWORD are
//                         accepted as aliases). Gmail's free SMTP caps ~500/day and
//                         rewrites From to the authenticated account.
//   'resend'            — Resend HTTP API (100/day, 3K/mo free; custom From domain)
// One env-var flip migrates providers; nothing else changes.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  // Extra RFC-5322 headers — used to attach List-Unsubscribe / one-click on bulk
  // mail (the daily digest + alerts) so Gmail/Yahoo render a native unsubscribe.
  headers?: Record<string, string>;
}

export interface EmailEnv {
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string; // used by resend; SMTP sends from the authenticated user
  EMAIL_REPLY_TO?: string; // resend Reply-To — a monitored inbox; header omitted if unset
  // SMTP — works for Gmail or any host. SMTP_* are preferred; the GMAIL_* names
  // are kept as aliases so older configs keep working.
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  GMAIL_USER?: string;
  GMAIL_APP_PASSWORD?: string;
  RESEND_API_KEY?: string;
}

/** Returns per-message success flags, aligned with the input array. */
export async function sendEmails(env: EmailEnv, messages: EmailMessage[]): Promise<boolean[]> {
  if (messages.length === 0) return [];
  switch (env.EMAIL_PROVIDER) {
    case "gmail":
    case "smtp":
      return sendViaSmtp(env, messages);
    case "resend":
      return sendViaResend(env, messages);
    default:
      for (const m of messages) {
        console.log(`[email:console] to=${m.to} subject=${JSON.stringify(m.subject)}\n${m.html}`);
      }
      return messages.map(() => true);
  }
}

async function sendViaSmtp(env: EmailEnv, messages: EmailMessage[]): Promise<boolean[]> {
  const user = env.SMTP_USER ?? env.GMAIL_USER;
  const pass = env.SMTP_PASS ?? env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.error("[email:smtp] SMTP_USER/SMTP_PASS (or GMAIL_USER/GMAIL_APP_PASSWORD) not set");
    return messages.map(() => false);
  }
  const host = env.SMTP_HOST ?? "smtp.gmail.com";
  const port = Number(env.SMTP_PORT) || 465;
  // 465 = implicit TLS; anything else (e.g. 587) negotiates STARTTLS.
  const secure = port === 465;
  const { WorkerMailer } = await import("worker-mailer");
  let mailer;
  try {
    mailer = await WorkerMailer.connect({
      host,
      port,
      secure,
      startTls: !secure,
      credentials: { username: user, password: pass },
      authType: "plain",
    });
  } catch (e) {
    console.error(`[email:smtp] connect to ${host}:${port} failed: ${e instanceof Error ? e.message : e}`);
    return messages.map(() => false);
  }
  const results: boolean[] = [];
  for (const m of messages) {
    try {
      await mailer.send({
        from: { name: "TV Nightly", email: user },
        to: m.to,
        subject: m.subject,
        html: m.html,
        ...(m.headers ? { headers: m.headers } : {}),
      });
      results.push(true);
    } catch (e) {
      console.error(`[email:smtp] send to ${m.to} failed: ${e instanceof Error ? e.message : e}`);
      results.push(false);
    }
  }
  return results;
}

async function sendViaResend(env: EmailEnv, messages: EmailMessage[]): Promise<boolean[]> {
  if (!env.RESEND_API_KEY) {
    console.error("[email:resend] RESEND_API_KEY not set");
    return messages.map(() => false);
  }
  const from = env.EMAIL_FROM ?? "TV Nightly <onboarding@resend.dev>";
  const replyTo = env.EMAIL_REPLY_TO;
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(
        messages.map((m) => ({
          from,
          to: [m.to],
          subject: m.subject,
          html: m.html,
          ...(replyTo ? { reply_to: replyTo } : {}),
          ...(m.headers ? { headers: m.headers } : {}),
        })),
      ),
    });
  } catch (e) {
    // A network-level throw (DNS, reset, timeout) must not bubble into the
    // request handler as a 500 — degrade to "all failed" like the SMTP path.
    console.error(`[email:resend] batch threw: ${e instanceof Error ? e.message : e}`);
    return messages.map(() => false);
  }
  if (!res.ok) {
    console.error(`[email:resend] batch failed: ${res.status} ${await res.text()}`);
    return messages.map(() => false);
  }
  return messages.map(() => true);
}
