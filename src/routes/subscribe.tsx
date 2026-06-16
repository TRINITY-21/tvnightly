import { Hono } from "hono";
import { Bindings } from "../types";
import { origin } from "../lib/seo";
import { MessagePage } from "../components/Layout";
import { signToken, verifyToken } from "../tokens";
import { sendEmails } from "../email";
import { EMAIL, emailButton, emailShell } from "../lib/email-template";

const app = new Hono<{ Bindings: Bindings }>();

// ------------------------------------------------- subscribe / confirm

const VALID_KINDS = new Set(["renewal", "premiere", "daily"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post("/subscribe", async (c) => {
  const body = await c.req.parseBody();
  const email = String(body.email ?? "").trim().toLowerCase();
  const kind = String(body.kind ?? "");
  const showId = body.show_id ? Number(body.show_id) : null;

  if (!EMAIL_RE.test(email) || !VALID_KINDS.has(kind) || (kind !== "daily" && !showId)) {
    return c.html(
      <MessagePage title="Something's off" body="Please check the email address and try again." />,
      400,
    );
  }
  const show = showId
    ? await c.env.DB.prepare("SELECT id, name FROM shows WHERE id = ?")
        .bind(showId)
        .first<{ id: number; name: string }>()
    : null;
  if (showId && !show) return c.notFound();

  // Without a SECRET (fresh local dev) skip double opt-in so the flow still works.
  const confirmed = c.env.SECRET ? 0 : 1;
  await c.env.DB.prepare(
    `INSERT INTO subscriptions (email, show_id, kind, confirmed, created_at)
     VALUES (?,?,?,?,unixepoch())
     ON CONFLICT(email, show_id, kind) DO NOTHING`,
  )
    .bind(email, showId, kind, confirmed)
    .run();

  if (c.env.SECRET) {
    const token = await signToken({ email, showId, kind, action: "confirm" }, c.env.SECRET);
    const what =
      kind === "daily" ? "the TV Nightly daily email" : `${show!.name} renewal & schedule alerts`;
    const confirmUrl = `${origin(c)}/confirm?token=${token}`;
    await sendEmails(c.env, [
      {
        to: email,
        subject: `Confirm: ${what}`,
        html: emailShell({
          title: "Confirm your subscription",
          preheader: `One click to start ${what}.`,
          contentHtml:
            `<p style="margin:0 0 22px;color:${EMAIL.soft}">You're one tap away from <strong style="color:${EMAIL.text}">${what}</strong>. Confirm below and you're in.</p>` +
            emailButton("Confirm subscription", confirmUrl) +
            `<p style="margin:20px 0 0;font-size:13px;color:${EMAIL.muted}">Button not working? Paste this into your browser:<br><a href="${confirmUrl}" style="color:${EMAIL.accent};word-break:break-all">${confirmUrl}</a></p>`,
          footerNote:
            "You got this because someone entered this address on tvnightly.com. If that wasn't you, just ignore it — nothing is subscribed until you confirm.",
        }),
      },
    ]);
  }

  return c.html(
    <MessagePage
      title="Almost there"
      body={
        c.env.SECRET
          ? "Check your inbox and click the confirmation link to activate your alerts."
          : "Subscribed (dev mode: auto-confirmed)."
      }
    />,
  );
});

app.get("/confirm", async (c) => {
  const token = c.req.query("token") ?? "";
  const payload = c.env.SECRET ? await verifyToken(token, c.env.SECRET) : null;
  if (!payload || payload.action !== "confirm") {
    return c.html(
      <MessagePage title="Invalid link" body="This confirmation link is invalid or expired." />,
      400,
    );
  }
  await c.env.DB.prepare(
    "UPDATE subscriptions SET confirmed = 1 WHERE email = ? AND kind = ? AND show_id IS ?",
  )
    .bind(payload.email, payload.kind, payload.showId)
    .run();
  return c.html(
    <MessagePage title="You're in" body="Subscription confirmed — we'll email you when there's news." />,
  );
});

app.get("/unsubscribe", async (c) => {
  const token = c.req.query("token") ?? "";
  const payload = c.env.SECRET ? await verifyToken(token, c.env.SECRET) : null;
  if (!payload || payload.action !== "unsub") {
    return c.html(
      <MessagePage title="Invalid link" body="This unsubscribe link is invalid or expired." />,
      400,
    );
  }
  await c.env.DB.prepare(
    "DELETE FROM subscriptions WHERE email = ? AND kind = ? AND show_id IS ?",
  )
    .bind(payload.email, payload.kind, payload.showId)
    .run();
  return c.html(<MessagePage title="Unsubscribed" body="You won't hear from us about this again." />);
});

export default app;
