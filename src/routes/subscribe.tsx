import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { Bindings, HonoEnv } from "../types";
import { origin } from "../lib/seo";
import { MessagePage } from "../components/Layout";
import { SubscribeWelcome } from "../components/subscribe-welcome";
import { signToken, verifyToken } from "../tokens";
import { materializeShow } from "../lib/tmdb-show";
import { sendEmails } from "../email";
import { EMAIL, emailButton, emailHighlight, emailLinkFallback, emailShell } from "../lib/email-template";

const app = new Hono<HonoEnv>();

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
      <MessagePage title="You're in" body="Subscribed — your first email is on its way." />,
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

  // Single opt-in: the subscription is live immediately. (The /confirm endpoint
  // below stays only so confirmation links from already-sent emails keep working.)
  // Social attribution: the tvn_ref cookie (set by routes/go on a /r/ click) tells
  // us which post referred this signup → surfaced in /admin/studio/insights.
  const [refSource, refCampaign] = (getCookie(c, "tvn_ref") ?? "").split("|");
  await c.env.DB.prepare(
    `INSERT INTO subscriptions (email, show_id, kind, confirmed, created_at, ref_source, ref_campaign)
     VALUES (?,?,?,1,unixepoch(),?,?)
     ON CONFLICT(email, show_id, kind) DO UPDATE SET confirmed = 1`,
  )
    .bind(email, realId, kind, refSource || null, refCampaign || null)
    .run();

  const what =
    kind === "daily" ? "the TV Nightly daily email" : `${show!.name} renewal & schedule alerts`;
  const getsLine =
    kind === "daily"
      ? "what's on tonight, ranked — fresh every evening."
      : `we'll email the moment ${show!.name} has renewal or schedule news.`;

  // Welcome email — best-effort (the subscription is already live either way).
  // Carries the one-tap unsubscribe link, which is what makes single opt-in OK:
  // a mistyped/unwanted address can bail out of the very first email.
  if (c.env.SECRET) {
    const unsubToken = await signToken({ email, showId: realId, kind, action: "unsub" }, c.env.SECRET);
    const target = kind === "daily" ? `${origin(c)}/tonight` : origin(c);
    await sendEmails(c.env, [
      {
        to: email,
        subject: `You're in: ${what}`,
        html: emailShell({
          title: "Welcome to TV Nightly",
          kicker: "You're in",
          heading: "Welcome to TV Nightly",
          preheader: `You're subscribed to ${what}.`,
          contentHtml:
            emailHighlight(
              `You're subscribed to <strong style="color:${EMAIL.text}">${what}</strong> — ${getsLine}`,
            ) + emailButton("Open TV Nightly", target),
          footerNote:
            "You're getting this because this address was subscribed on tvnightly.com. Not you? One tap below and you're out.",
          unsubscribeHref: `${origin(c)}/unsubscribe?token=${unsubToken}`,
        }),
      },
    ]).catch((err) => console.error("welcome email failed", email, err));
  }

  return c.html(<SubscribeWelcome email={email} what={what} getsLine={getsLine} />);
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
async function applyUnsubscribe(c: Context<HonoEnv>): Promise<boolean> {
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
