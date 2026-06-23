import { Hono, type Context } from "hono";
import { Bindings } from "../types";
import { origin } from "../lib/seo";
import { MessagePage } from "../components/Layout";
import { signToken, verifyToken } from "../tokens";
import { materializeShow } from "../lib/tmdb-show";
import { sendEmails } from "../email";
import { EMAIL, emailButton, emailHighlight, emailLinkFallback, emailShell } from "../lib/email-template";

const app = new Hono<{ Bindings: Bindings }>();

// ------------------------------------------------- subscribe / confirm

const VALID_KINDS = new Set(["renewal", "premiere", "daily"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post("/subscribe", async (c) => {
  let body: Awaited<ReturnType<typeof c.req.parseBody>>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.html(
      <MessagePage title="Something's off" body="Please check the email address and try again." />,
      400,
    );
  }

  // Honeypot: real visitors never see/fill this off-screen field; bots fill every
  // input. Pretend success so the bot doesn't learn it was caught — subscribe nobody.
  if (String(body.website ?? "").trim()) {
    return c.html(
      <MessagePage
        title="Almost there"
        body="Check your inbox and click the confirmation link to activate your alerts."
      />,
    );
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const kind = String(body.kind ?? "");
  const showId = body.show_id ? Number(body.show_id) : null;

  if (!EMAIL_RE.test(email) || !VALID_KINDS.has(kind) || (kind !== "daily" && !showId)) {
    return c.html(
      <MessagePage title="Something's off" body="Please check the email address and try again." />,
      400,
    );
  }

  let realId = showId;
  let show = showId
    ? await c.env.DB.prepare("SELECT id, name FROM shows WHERE id = ?")
        .bind(showId)
        .first<{ id: number; name: string }>()
    : null;
  // live-only show: the form carries its tmdb id — materialize it into D1 (the
  // "save on engagement" rule) so the subscription has a real row to hang on.
  if (showId && !show && c.env.TMDB_API_KEY) {
    const mid = await materializeShow(c, showId);
    if (mid) {
      realId = mid;
      show = await c.env.DB.prepare("SELECT id, name FROM shows WHERE id = ?")
        .bind(mid)
        .first<{ id: number; name: string }>();
    }
  }
  if (showId && !show) return c.notFound();

  // Without a SECRET (fresh local dev) skip double opt-in so the flow still works.
  const confirmed = c.env.SECRET ? 0 : 1;
  await c.env.DB.prepare(
    `INSERT INTO subscriptions (email, show_id, kind, confirmed, created_at)
     VALUES (?,?,?,?,unixepoch())
     ON CONFLICT(email, show_id, kind) DO NOTHING`,
  )
    .bind(email, realId, kind, confirmed)
    .run();

  if (c.env.SECRET) {
    const token = await signToken({ email, showId: realId, kind, action: "confirm" }, c.env.SECRET);
    const what =
      kind === "daily" ? "the TV Nightly daily email" : `${show!.name} renewal & schedule alerts`;
    const confirmUrl = `${origin(c)}/confirm?token=${token}`;
    const [sent] = await sendEmails(c.env, [
      {
        to: email,
        subject: `Confirm: ${what}`,
        html: emailShell({
          title: "Confirm your subscription",
          kicker: "One more step",
          heading: "Confirm your subscription",
          preheader: `One click to start ${what}.`,
          contentHtml:
            emailHighlight(
              `You're one tap away from <strong style="color:${EMAIL.text}">${what}</strong>. Confirm below and you're in.`,
            ) +
            emailButton("Confirm subscription", confirmUrl) +
            emailLinkFallback(confirmUrl),
          footerNote:
            "You got this because someone entered this address on tvnightly.com. If that wasn't you, just ignore it — nothing is subscribed until you confirm.",
        }),
      },
    ]);
    // The row is already pending; if the confirm email didn't go out, don't tell
    // the visitor to "check their inbox" for a mail that never sent. A retry POST
    // re-sends (the row stays via ON CONFLICT DO NOTHING).
    if (!sent) {
      return c.html(
        <MessagePage
          title="Couldn't send that email"
          body="We couldn't send your confirmation email just now. Please try again in a moment."
        />,
        502,
      );
    }
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

// Verify an unsubscribe token and remove the matching subscription. Returns true
// if a valid token was processed. Shared by the human GET page and the RFC-8058
// one-click POST.
async function applyUnsubscribe(c: Context<{ Bindings: Bindings }>): Promise<boolean> {
  const token = c.req.query("token") ?? "";
  const payload = c.env.SECRET ? await verifyToken(token, c.env.SECRET) : null;
  if (!payload || payload.action !== "unsub") return false;
  await c.env.DB.prepare(
    "DELETE FROM subscriptions WHERE email = ? AND kind = ? AND show_id IS ?",
  )
    .bind(payload.email, payload.kind, payload.showId)
    .run();
  return true;
}

app.get("/unsubscribe", async (c) => {
  if (!(await applyUnsubscribe(c))) {
    return c.html(
      <MessagePage title="Invalid link" body="This unsubscribe link is invalid or expired." />,
      400,
    );
  }
  return c.html(<MessagePage title="Unsubscribed" body="You won't hear from us about this again." />);
});

// One-click unsubscribe (RFC 8058): Gmail/Apple Mail POST `List-Unsubscribe=One-Click`
// to the List-Unsubscribe URL. No body to render — the mail client shows its own UI.
app.post("/unsubscribe", async (c) => {
  const ok = await applyUnsubscribe(c);
  return c.text(ok ? "Unsubscribed" : "Invalid link", ok ? 200 : 400);
});

export default app;
