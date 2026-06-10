// Swappable email sender. EMAIL_PROVIDER selects the backend:
//   'console' (default) — logs instead of sending; safe for local dev
//   'gmail'             — SMTP via the user's Gmail app password (~500 sends/day cap;
//                         From is forced to the Gmail address by Google)
//   'resend'            — Resend HTTP API (100/day, 3K/mo free; custom From domain)
// One env-var flip migrates providers; nothing else changes.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

export interface EmailEnv {
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string; // used by resend; gmail always sends from GMAIL_USER
  GMAIL_USER?: string;
  GMAIL_APP_PASSWORD?: string;
  RESEND_API_KEY?: string;
}

/** Returns per-message success flags, aligned with the input array. */
export async function sendEmails(env: EmailEnv, messages: EmailMessage[]): Promise<boolean[]> {
  if (messages.length === 0) return [];
  switch (env.EMAIL_PROVIDER) {
    case "gmail":
      return sendViaGmail(env, messages);
    case "resend":
      return sendViaResend(env, messages);
    default:
      for (const m of messages) {
        console.log(`[email:console] to=${m.to} subject=${JSON.stringify(m.subject)}\n${m.html}`);
      }
      return messages.map(() => true);
  }
}

async function sendViaGmail(env: EmailEnv, messages: EmailMessage[]): Promise<boolean[]> {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
    console.error("[email:gmail] GMAIL_USER / GMAIL_APP_PASSWORD not set");
    return messages.map(() => false);
  }
  const { WorkerMailer } = await import("worker-mailer");
  let mailer;
  try {
    mailer = await WorkerMailer.connect({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      credentials: { username: env.GMAIL_USER, password: env.GMAIL_APP_PASSWORD },
      authType: "plain",
    });
  } catch (e) {
    console.error(`[email:gmail] SMTP connect failed: ${e instanceof Error ? e.message : e}`);
    return messages.map(() => false);
  }
  const results: boolean[] = [];
  for (const m of messages) {
    try {
      await mailer.send({
        from: { name: "TV Nightly", email: env.GMAIL_USER },
        to: m.to,
        subject: m.subject,
        html: m.html,
      });
      results.push(true);
    } catch (e) {
      console.error(`[email:gmail] send to ${m.to} failed: ${e instanceof Error ? e.message : e}`);
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
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(messages.map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html }))),
  });
  if (!res.ok) {
    console.error(`[email:resend] batch failed: ${res.status} ${await res.text()}`);
    return messages.map(() => false);
  }
  return messages.map(() => true);
}
