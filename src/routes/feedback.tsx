import { Hono } from "hono";
import { Bindings } from "../types";
import { Layout, MessagePage } from "../components/Layout";
import { canonical } from "../lib/seo";
import { sendEmails } from "../email";
import { verifyTurnstile } from "../lib/turnstile";

const TURNSTILE_API = "https://challenges.cloudflare.com/turnstile/v0/api.js";

const app = new Hono<{ Bindings: Bindings }>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

app.get("/feedback", (c) =>
  c.html(
    <Layout
      title="Send feedback | TV Nightly"
      description="Found a bug, a wrong air date, or have an idea for TV Nightly? Send us your feedback — it goes straight to the team."
      canonical={canonical(c)}
      scripts={c.env.TURNSTILE_SITE_KEY ? [TURNSTILE_API] : undefined}
    >
      <div class="fb-page">
        <h1>Send feedback</h1>
        <p class="section-lead">
          Found a bug, a wrong air date, or have an idea? Tell us — it goes straight to the team, and
          we read every note.
        </p>
        <form action="/feedback" method="post" class="fb-form">
          {/* honeypot: off-screen, bots fill it, humans never see it */}
          <input
            class="fb-hp"
            type="text"
            name="website"
            tabindex={-1}
            autocomplete="off"
            aria-hidden="true"
          />
          <label class="fb-field">
            <span class="fb-label">Your feedback</span>
            <textarea
              name="message"
              rows={6}
              required
              maxlength={4000}
              placeholder="What's on your mind?"
            ></textarea>
          </label>
          <label class="fb-field">
            <span class="fb-label">
              Email <span class="fb-opt">(optional)</span>
            </span>
            <input type="email" name="email" placeholder="you@email.com" />
            <span class="fb-note">Only if you'd like a reply.</span>
          </label>
          {/* Turnstile auto-injects the cf-turnstile-response token into this form
              on a plain POST — no client JS needed; the server verifies it. */}
          {c.env.TURNSTILE_SITE_KEY ? (
            <div
              class="cf-turnstile fb-turnstile"
              data-sitekey={c.env.TURNSTILE_SITE_KEY}
              data-action="turnstile-spin-v1"
            ></div>
          ) : null}
          <button type="submit">Send feedback</button>
        </form>
      </div>
    </Layout>,
  ),
);

app.post("/feedback", async (c) => {
  const body = await c.req.parseBody();
  // honeypot tripped — pretend success (don't teach the bot), store nothing
  if (String(body.website ?? "").trim()) {
    return c.html(<MessagePage title="Thank you" body="Your feedback has been received." />);
  }

  // Throttle: this endpoint is unauthenticated and every accepted submit both
  // writes to D1 and fires an outbound email — cap it per-IP so it can't be used
  // to flood the inbox or bomb the team's mailbox (best-effort; see wrangler.jsonc).
  if (c.env.FEEDBACK_LIMIT) {
    const ip = c.req.header("cf-connecting-ip") ?? "0.0.0.0";
    const { success } = await c.env.FEEDBACK_LIMIT.limit({ key: ip });
    if (!success) {
      return c.html(
        <MessagePage
          title="One moment"
          body="You've sent a lot of feedback just now — please wait a minute and try again."
        />,
        429,
      );
    }
  }

  // Turnstile: browser → this Worker → siteverify. Only enforced when the secret
  // is configured, so local dev and tests run without it (honeypot + rate limit
  // still apply). The token rides in as the cf-turnstile-response form field.
  if (c.env.TURNSTILE_SECRET_KEY) {
    const token = String(body["cf-turnstile-response"] ?? "");
    const ip = c.req.header("cf-connecting-ip") ?? null;
    if (!(await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, token, ip))) {
      return c.html(
        <MessagePage
          title="Couldn't verify you're human"
          body="The anti-spam check didn't pass. Please go back, complete the challenge, and send again."
        />,
        400,
      );
    }
  }

  const message = String(body.message ?? "").trim();
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  if (message.length < 2 || message.length > 4000) {
    return c.html(
      <MessagePage
        title="Something's off"
        body="Please write a little more (and under 4000 characters), then try again."
      />,
      400,
    );
  }
  if (email && !EMAIL_RE.test(email)) {
    return c.html(
      <MessagePage
        title="Something's off"
        body="That email address doesn't look right — fix it or leave it blank."
      />,
      400,
    );
  }

  const page = c.req.header("Referer") ?? null;
  const ua = c.req.header("User-Agent") ?? null;
  await c.env.DB.prepare(
    "INSERT INTO feedback (message, email, page, ua, created_at) VALUES (?,?,?,?,unixepoch())",
  )
    .bind(message, email || null, page, ua)
    .run();

  // best-effort notify the team — never fail the submit if email isn't configured
  const to = c.env.FEEDBACK_TO ?? c.env.EMAIL_FROM;
  if (to) {
    try {
      await sendEmails(c.env, [
        {
          to,
          subject: "New TV Nightly feedback",
          html:
            `<p><strong>Feedback:</strong></p><p>${escapeHtml(message)}</p>` +
            `<p style="color:#888;font-size:12px">From: ${email ? escapeHtml(email) : "(no email)"}<br>` +
            `Page: ${page ? escapeHtml(page) : "—"}</p>`,
        },
      ]);
    } catch {
      /* the feedback is already saved in D1; an email hiccup shouldn't 500 */
    }
  }

  return c.html(
    <MessagePage
      title="Thank you"
      body="Your feedback has been received — we read every note. Thanks for helping make TV Nightly better."
    />,
  );
});

export default app;
